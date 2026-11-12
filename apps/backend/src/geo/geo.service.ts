import { Injectable } from '@nestjs/common';
import type { GeoDistrictPublic, RegionPublic } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GeoService {
  constructor(private readonly prisma: PrismaService) {}

  /** All regions, in-city (Tashkent) first, then alphabetical. */
  async regions(): Promise<RegionPublic[]> {
    const rows = await this.prisma.region.findMany({
      orderBy: [{ isCity: 'desc' }, { name: 'asc' }],
    });
    return rows.map((r) => ({ code: r.code, name: r.name, is_city: r.isCity }));
  }

  /** Districts (tumans), alphabetical. Filtered to one region when `regionCode` is
   *  given; otherwise every district (used by the pickup-zone picker). */
  async districts(regionCode: string): Promise<GeoDistrictPublic[]> {
    const rows = await this.prisma.geoDistrict.findMany({
      where: regionCode ? { regionCode } : undefined,
      orderBy: { name: 'asc' },
    });
    return rows.map((d) => ({ code: d.code, name: d.name, region_code: d.regionCode }));
  }
}
