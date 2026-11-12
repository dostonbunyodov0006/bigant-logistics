import { z } from 'zod';

/**
 * Service area. Every pickup place and delivery point this system knows about
 * is in Uzbekistan, so a coordinate outside this box is a data-entry error —
 * almost always latitude and longitude swapped (Tashkent is 41.3 N, 69.2 E;
 * swapped it becomes 69.2 N, 41.3 E, well outside). Rejecting it at the API
 * is far cheaper than a driver discovering it on the road.
 *
 * Generous margins on purpose: the box includes all of Karakalpakstan and
 * the Fergana valley border areas. Tighten only with a reason.
 */
export const UZBEKISTAN_BOUNDS = {
  minLat: 37.0,
  maxLat: 45.7,
  minLng: 55.9,
  maxLng: 73.2,
} as const;

export function isWithinUzbekistan(lat: number, lng: number): boolean {
  return (
    lat >= UZBEKISTAN_BOUNDS.minLat &&
    lat <= UZBEKISTAN_BOUNDS.maxLat &&
    lng >= UZBEKISTAN_BOUNDS.minLng &&
    lng <= UZBEKISTAN_BOUNDS.maxLng
  );
}

const latSchema = z.number().finite().min(-90).max(90);
const lngSchema = z.number().finite().min(-180).max(180);

/** A pinned point. Both halves required — a lone latitude is never useful. */
export const coordinatesSchema = z
  .object({ lat: latSchema, lng: lngSchema })
  .refine((c) => isWithinUzbekistan(c.lat, c.lng), {
    message: 'coordinates_outside_service_area',
    path: ['lat'],
  });
export type Coordinates = z.infer<typeof coordinatesSchema>;

/**
 * Mixin for create/update inputs. `lat`/`lng` travel as two flat fields (the
 * forms post them that way), validated as a pair: both present and inside the
 * service area, or both absent. Whether "absent" is allowed is decided per
 * schema by `.required()` on these two keys.
 */
export const coordinateFields = {
  lat: latSchema.optional(),
  lng: lngSchema.optional(),
};

/** Same fields, mandatory. Used by create schemas once every form ships the picker. */
export const requiredCoordinateFields = {
  lat: latSchema,
  lng: lngSchema,
};

/**
 * Applies the pair rule to any object schema carrying `lat`/`lng` — including a
 * `.partial()` of one, which is why this is a function over the schema rather
 * than a refinement baked into a base object (a refined schema cannot be
 * `.partial()`-ed afterwards).
 */
// The explicit return type matters: calling .superRefine on a generic S resolves
// against ZodTypeAny's constraint, whose Output is `any`, so without it every
// z.infer<> downstream silently became `any` and react-hook-form lost its field
// types. Spelling out output/input keeps the caller's precise object type.
export function refineCoordinatePair<S extends z.ZodTypeAny>(
  schema: S,
): z.ZodEffects<S, z.output<S>, z.input<S>> {
  return schema.superRefine((value: unknown, ctx) => {
    const v = value as { lat?: number; lng?: number };
    const hasLat = v.lat !== undefined;
    const hasLng = v.lng !== undefined;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'coordinates_require_both_lat_and_lng',
        path: [hasLat ? 'lng' : 'lat'],
      });
      return;
    }
    if (hasLat && hasLng && !isWithinUzbekistan(v.lat as number, v.lng as number)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'coordinates_outside_service_area',
        path: ['lat'],
      });
    }
  }) as z.ZodEffects<S, z.output<S>, z.input<S>>;
}
