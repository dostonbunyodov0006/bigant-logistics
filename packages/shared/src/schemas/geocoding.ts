import { z } from 'zod';

export const geocodingLanguageSchema = z.enum(['uz', 'ru', 'en']);

const latitudeSchema = z.coerce.number().finite().min(-90).max(90);
const longitudeSchema = z.coerce.number().finite().min(-180).max(180);

export const geocodingSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(200),
    limit: z.coerce.number().int().min(1).max(10).default(5),
    lang: geocodingLanguageSchema.default('uz'),
    lat: latitudeSchema.optional(),
    lon: longitudeSchema.optional(),
  })
  .refine((value) => (value.lat === undefined) === (value.lon === undefined), {
    message: 'lat_and_lon_must_be_provided_together',
    path: ['lat'],
  });
export type GeocodingSearchQuery = z.infer<typeof geocodingSearchQuerySchema>;

export const reverseGeocodingQuerySchema = z.object({
  lat: latitudeSchema,
  lon: longitudeSchema,
  limit: z.coerce.number().int().min(1).max(10).default(1),
  lang: geocodingLanguageSchema.default('uz'),
});
export type ReverseGeocodingQuery = z.infer<typeof reverseGeocodingQuerySchema>;

export const geocodingResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  name: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string().nullable(),
  country_code: z.string().nullable(),
  state: z.string().nullable(),
  county: z.string().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  street: z.string().nullable(),
  house_number: z.string().nullable(),
  postcode: z.string().nullable(),
  osm_type: z.string().nullable(),
  osm_id: z.union([z.string(), z.number()]).nullable(),
  osm_key: z.string().nullable(),
  osm_value: z.string().nullable(),
});
export type GeocodingResult = z.infer<typeof geocodingResultSchema>;

/** A shortened map share link for the server to follow (GET /geo/resolve-link). */
export const resolveMapLinkQuerySchema = z.object({
  url: z.string().trim().min(8).max(2000),
});
export type ResolveMapLinkQuery = z.infer<typeof resolveMapLinkQuerySchema>;

export const resolvedMapLinkSchema = z.object({
  /** Where the link led, or null when it could not be followed. */
  url: z.string().nullable(),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
      usable: z.boolean(),
    })
    .nullable(),
});
export type ResolvedMapLink = z.infer<typeof resolvedMapLinkSchema>;
