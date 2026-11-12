import { z } from 'zod';
import { titleCase } from '../text';
import { uzPhoneSchema } from '../phone';
import { PICKUP_PLACE_TYPES } from '../enums';
import { isCityRegionCode } from './geo';
import { coordinateFields, refineCoordinatePair, requiredCoordinateFields } from './coordinates';

export const pickupPlaceTypeSchema = z.enum(PICKUP_PLACE_TYPES);

/** A pickup place carries its own official geo. Orders copy it onto each pickup
 *  stop, so the city/outside pickup bonus never depends on per-order data entry. */
const pickupPlaceFields = z.object({
  // A place's name is a name: tidied on the way in, like a person's.
  name: z.string().min(1).transform(titleCase),
  address: z.string().optional(),
  /** The person to ring at the place (owner, 11.11.2026); optional. */
  phone_number: uzPhoneSchema.nullish(),
  type: pickupPlaceTypeSchema,
  /** The supplier this yard belongs to; left out for our own shop and warehouse. */
  supplier_id: z.string().min(1).nullish(),
  is_temporary: z.boolean().optional(),
  region_code: z.string().min(1),
  district_code: z.string().nullish(),
  // Map pin — required on create, optional on update (see below).
  ...coordinateFields,
});

/** Districts are only surfaced (and required) for the city regions — same rule
 *  the client form uses. */
const districtRequiredForCity = {
  message: 'district_required_for_city_region',
  path: ['district_code'],
};

// A new place must be pinned: its coordinates are copied onto every order's
// pickup stop, and routing/ETA start there. Update stays optional for legacy rows.
export const createPickupPlaceSchema = refineCoordinatePair(
  pickupPlaceFields.extend(requiredCoordinateFields).extend({
    /** A yard the lorry goes to once: kept off the directory. */
    one_off: z.boolean().optional(),
  }).refine(
    (v) => !isCityRegionCode(v.region_code) || !!v.district_code,
    districtRequiredForCity,
  ),
);
export type CreatePickupPlaceInput = z.infer<typeof createPickupPlaceSchema>;

export const updatePickupPlaceSchema = refineCoordinatePair(
  pickupPlaceFields.partial().refine(
    // Only enforce when the region is actually part of the patch.
    (v) => v.region_code === undefined || !isCityRegionCode(v.region_code) || !!v.district_code,
    districtRequiredForCity,
  ),
);
export type UpdatePickupPlaceInput = z.infer<typeof updatePickupPlaceSchema>;

export const pickupPlacePublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone_number: z.string().nullable().optional(),
  type: pickupPlaceTypeSchema,
  /** The supplier this yard belongs to; null for our own shop and warehouse. */
  supplier_id: z.string().nullable(),
  supplier_name: z.string().nullable(),
  is_temporary: z.boolean(),
  region_code: z.string(),
  region_name: z.string().nullable(),
  district_code: z.string().nullable(),
  district_name: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  created_by: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type PickupPlacePublic = z.infer<typeof pickupPlacePublicSchema>;
