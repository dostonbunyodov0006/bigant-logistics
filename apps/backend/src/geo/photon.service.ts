import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type {
  GeocodingResult,
  GeocodingSearchQuery,
  ReverseGeocodingQuery,
} from '@bigant/shared';
import type { Env } from '../config/env.validation';
import { placeInTashkent } from './tashkent-tumans';

/** What counts as an area in this index, and in which order it leads a search. */
const AREA_RANK: Record<string, number> = { district: 0, county: 0, state: 1, region: 1, city: 2, town: 2 };
const AREA_TAGS = ['place:district', 'place:county', 'place:state', 'place:region', 'place:city', 'place:town'];

const photonFeatureCollectionSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({
        type: z.literal('Point'),
        coordinates: z.tuple([z.number(), z.number()]),
      }),
      properties: z
        .object({
          name: z.string().optional(),
          country: z.string().optional(),
          countrycode: z.string().optional(),
          state: z.string().optional(),
          county: z.string().optional(),
          city: z.string().optional(),
          district: z.string().optional(),
          street: z.string().optional(),
          housenumber: z.string().optional(),
          postcode: z.string().optional(),
          osm_type: z.string().optional(),
          osm_id: z.union([z.string(), z.number()]).optional(),
          osm_key: z.string().optional(),
          osm_value: z.string().optional(),
        })
        .passthrough(),
    }),
  ),
});

type PhotonFeature = z.infer<typeof photonFeatureCollectionSchema>['features'][number];

@Injectable()
export class PhotonService {
  private readonly logger = new Logger(PhotonService.name);
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = new URL(config.get('PHOTON_URL', { infer: true }));
    this.timeoutMs = config.get('PHOTON_TIMEOUT_MS', { infer: true });
  }

  /**
   * Two asks of Photon: the places as it ranks them, and the administrative
   * areas (tumanlar, viloyatlar) by themselves. A district typed by name used
   * to come behind a street or a village of the same name (owner, 03.11.2026);
   * an area whose name starts with what he typed now leads the list.
   */
  async search(query: GeocodingSearchQuery): Promise<GeocodingResult[]> {
    const url = this.endpoint('/api');
    url.searchParams.set('q', query.q);
    url.searchParams.set('countrycode', 'UZ');
    url.searchParams.set('lang', query.lang);
    url.searchParams.set('limit', String(query.limit));
    if (query.lat !== undefined && query.lon !== undefined) {
      url.searchParams.set('lat', String(query.lat));
      url.searchParams.set('lon', String(query.lon));
    }
    // Areas are asked without the "near Tashkent" bias: Buxoro is Buxoro
    // wherever the office sits. Ten of them, because mahallas are areas too.
    // In this index a tuman is place:district (or place:county), a viloyat
    // place:state/region, a city place:city — "boundary" only holds mahallas.
    const areas = new URL(url);
    for (const tag of AREA_TAGS) areas.searchParams.append('osm_tag', tag);
    areas.searchParams.set('limit', '10');
    areas.searchParams.delete('lat');
    areas.searchParams.delete('lon');
    const [places, boundaries] = await Promise.all([
      this.request(url),
      this.request(areas).catch(() => [] as GeocodingResult[]),
    ]);
    const squash = (v: string) => v.toLowerCase().replace(/[\s'ʻʼ`’-]/g, '');
    const typed = squash(query.q.trim().replace(/\s+(tumani|viloyati|shahri|rayoni|oblasti)$/i, ''));
    const leading = boundaries
      .filter((r) => r.osm_key === 'place' && AREA_RANK[r.osm_value ?? ''] !== undefined && squash(r.name ?? '').startsWith(typed))
      .sort((a, b) => AREA_RANK[a.osm_value ?? '']! - AREA_RANK[b.osm_value ?? '']! || (a.name ?? '').length - (b.name ?? '').length);
    const seen = new Set(leading.map((r) => r.id));
    return [...leading, ...places.filter((r) => !seen.has(r.id))].slice(0, query.limit);
  }

  reverse(query: ReverseGeocodingQuery): Promise<GeocodingResult[]> {
    const url = this.endpoint('/reverse');
    url.searchParams.set('lat', String(query.lat));
    url.searchParams.set('lon', String(query.lon));
    url.searchParams.set('lang', query.lang);
    url.searchParams.set('limit', String(query.limit));
    return this.request(url);
  }

  private endpoint(path: string): URL {
    return new URL(path, this.baseUrl);
  }

  private async request(url: URL): Promise<GeocodingResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        this.logger.warn('Photon request timed out after ' + this.timeoutMs + 'ms');
        throw new GatewayTimeoutException('geocoding_service_timeout');
      }
      this.logger.error('Photon request failed: ' + (error as Error).message);
      throw new ServiceUnavailableException('geocoding_service_unavailable');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger.warn('Photon returned HTTP ' + response.status);
      throw new BadGatewayException('geocoding_service_error');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BadGatewayException('geocoding_invalid_response');
    }

    const parsed = photonFeatureCollectionSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn('Photon returned an invalid GeoJSON response');
      throw new BadGatewayException('geocoding_invalid_response');
    }

    // Inside Toshkent the tuman comes from the boundary, not from the map's label.
    return parsed.data.features.map((feature, index) => placeInTashkent(this.toResult(feature, index)));
  }

  private toResult(feature: PhotonFeature, index: number): GeocodingResult {
    const [longitude, latitude] = feature.geometry.coordinates;
    const properties = feature.properties;
    const osmType = properties.osm_type ?? null;
    const osmId = properties.osm_id ?? null;

    return {
      id: osmType !== null && osmId !== null
        ? [osmType, osmId].join(':')
        : [longitude, latitude, index].join(':'),
      label: this.buildLabel(properties, latitude, longitude),
      name: properties.name ?? null,
      latitude,
      longitude,
      country: properties.country ?? null,
      country_code: properties.countrycode?.toUpperCase() ?? null,
      state: properties.state ?? null,
      county: properties.county ?? null,
      city: properties.city ?? null,
      district: properties.district ?? null,
      street: properties.street ?? null,
      house_number: properties.housenumber ?? null,
      postcode: properties.postcode ?? null,
      osm_type: osmType,
      osm_id: osmId,
      osm_key: properties.osm_key ?? null,
      osm_value: properties.osm_value ?? null,
    };
  }

  private buildLabel(
    properties: PhotonFeature['properties'],
    latitude: number,
    longitude: number,
  ): string {
    const streetAddress = [properties.street, properties.housenumber]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    const candidates = [
      properties.name,
      streetAddress || undefined,
      properties.district,
      properties.city,
      properties.state,
      properties.country,
    ];
    const seen = new Set<string>();
    const parts = candidates.filter((value): value is string => {
      if (!value) return false;
      const key = value.trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return parts.length > 0 ? parts.join(', ') : [latitude, longitude].join(', ');
  }
}
