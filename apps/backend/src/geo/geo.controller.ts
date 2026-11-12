import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  geocodingSearchQuerySchema,
  mapNearestRequestSchema,
  mapRouteQuerySchema,
  type MapNearestRequest,
  type MapNearestResult,
  type MapRouteQuery,
  type MapRouteResult,
  resolveMapLinkQuerySchema,
  reverseGeocodingQuerySchema,
  type GeocodingSearchQuery,
  type ResolveMapLinkQuery,
  type ResolvedMapLink,
  type ReverseGeocodingQuery,
} from '@bigant/shared';
import { GeoService } from './geo.service';
import { PhotonService } from './photon.service';
import { MapLinkService } from './map-link.service';
import { ValhallaService } from '../routing/valhalla.service';
import { SpeedStatsService } from './speed-stats.service';
import { decodePolyline6 } from './tashkent-city';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@ApiTags('geo')
@ApiBearerAuth()
@Controller('geo')
export class GeoController {
  constructor(
    private readonly geo: GeoService,
    private readonly photon: PhotonService,
    private readonly links: MapLinkService,
    private readonly valhalla: ValhallaService,
    private readonly speed: SpeedStatsService,
  ) {}

  /** A shortened map share link (Yandex, Google, 2GIS) followed to its coordinates. */
  @Roles('admin', 'manager', 'seller')
  @Get('resolve-link')
  resolveLink(
    @Query(new ZodValidationPipe(resolveMapLinkQuerySchema)) query: ResolveMapLinkQuery,
  ): Promise<ResolvedMapLink> {
    return this.links.resolve(query.url);
  }

  @Roles('admin', 'manager', 'seller')
  @Get('search')
  search(
    @Query(new ZodValidationPipe(geocodingSearchQuerySchema)) query: GeocodingSearchQuery,
  ) {
    return this.photon.search(query);
  }

  @Roles('admin', 'manager', 'seller')
  @Get('reverse')
  reverse(
    @Query(new ZodValidationPipe(reverseGeocodingQuerySchema)) query: ReverseGeocodingQuery,
  ) {
    return this.photon.reverse(query);
  }

  @Roles('admin', 'manager', 'seller')
  @Get('regions')
  regions() {
    return this.geo.regions();
  }

  @Roles('admin', 'manager', 'seller')
  @Get('districts')
  districts(@Query('region_code') regionCode?: string) {
    return this.geo.districts(regionCode ?? '');
  }

  /** The road between two points, for drawing on the office map. */
  @Roles('admin', 'manager', 'seller')
  @Get('route')
  async route(@Query(new ZodValidationPipe(mapRouteQuerySchema)) q: MapRouteQuery): Promise<MapRouteResult> {
    const res = await this.valhalla.route({
      locations: [
        { lat: q.from_lat, lon: q.from_lon },
        { lat: q.to_lat, lon: q.to_lon },
      ],
      costing: 'auto',
      language: 'ru-RU',
      shortest: true,
    });
    return {
      length_km: res.summary.length_km,
      time_seconds: Math.round(
        res.summary.time_seconds *
          this.speed.factor(
            [{ lat: q.from_lat, lng: q.from_lon }, { lat: q.to_lat, lng: q.to_lon }],
            res.summary.length_km,
            res.summary.time_seconds,
          ),
      ),
      coordinates: res.legs.flatMap((leg) => decodePolyline6(leg.shape).map((p) => [p.lon, p.lat] as [number, number])),
    };
  }

  /** How far each lorry is from one point by road — the map's nearest-lorry list. */
  @Roles('admin', 'manager', 'seller')
  @Post('nearest')
  @HttpCode(200)
  async nearest(@Body(new ZodValidationPipe(mapNearestRequestSchema)) body: MapNearestRequest): Promise<MapNearestResult> {
    const legs: MapNearestResult['legs'] = [];
    // Valhalla answers at most 100 pairs at a time; one target, so 25 lorries a call is safe.
    for (let i = 0; i < body.from.length; i += 25) {
      const part = body.from.slice(i, i + 25);
      const m = await this.valhalla.matrix({ sources: part, targets: [body.to], costing: 'auto', shortest: true });
      part.forEach((from, j) => {
        const km = m.distances_km[j]?.[0] ?? null;
        const sec = m.times_seconds[j]?.[0] ?? null;
        const factor =
          km != null && sec != null
            ? this.speed.factor([{ lat: from.lat, lng: from.lon }, { lat: body.to.lat, lng: body.to.lon }], km, sec)
            : 1;
        legs.push({ length_km: km, time_seconds: sec == null ? null : Math.round(sec * factor) });
      });
    }
    return { legs };
  }
}
