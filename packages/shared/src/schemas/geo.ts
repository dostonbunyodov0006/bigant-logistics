import { z } from 'zod';

/**
 * Region codes that count as in-city (shahar) for driver-pay tariffs:
 * Toshkent shahri (1726) + Toshkent viloyati (1727). Everything else is tashqari.
 */
export const CITY_REGION_CODES = ['1726', '1727'] as const;

/** Whether a region code is in-city (Tashkent city or Tashkent region). */
export function isCityRegionCode(code: string | null | undefined): boolean {
  return code != null && (CITY_REGION_CODES as readonly string[]).includes(code);
}

export const regionPublicSchema = z.object({
  code: z.string(),
  name: z.string(),
  is_city: z.boolean(),
});
export type RegionPublic = z.infer<typeof regionPublicSchema>;

export const geoDistrictPublicSchema = z.object({
  code: z.string(),
  name: z.string(),
  region_code: z.string(),
});
export type GeoDistrictPublic = z.infer<typeof geoDistrictPublicSchema>;
