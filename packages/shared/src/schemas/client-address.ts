import { z } from 'zod';
import { titleCase } from '../text';
import { coordinateFields, refineCoordinatePair } from './coordinates';

/**
 * One of a client's places. A regular customer has a shop, a second shop and a
 * yard, and the seller picks between them by name — the pin comes with it, so
 * nobody is asked for a location twice.
 */
const addressFields = z.object({
  /** What the seller sees in the list: "Chilonzor filiali", "Ombor". */
  /** What the seller sees in the list, as a name: "Chilonzor Filiali". */
  label: z.string().trim().min(1).max(80).transform(titleCase),
  /** Street, landmark, house — the words the driver reads. */
  address: z.string().trim().max(240).optional(),
  region_code: z.string().min(1),
  district_code: z.string().nullish(),
  ...coordinateFields,
});

/** A pin is wanted — without one there is no ETA and no route — but a place
 *  nobody can find on a map is still a place the driver must deliver to. */
export const createClientAddressSchema = refineCoordinatePair(
  addressFields.extend({
    /** Make this the one offered first. The previous default steps aside. */
    is_default: z.boolean().optional(),
  }),
);
export type CreateClientAddressInput = z.infer<typeof createClientAddressSchema>;

export const updateClientAddressSchema = refineCoordinatePair(
  addressFields.partial().extend({
    is_default: z.boolean().optional(),
    /** A closed branch stays on its old orders and leaves the picker. */
    active: z.boolean().optional(),
  }),
);
export type UpdateClientAddressInput = z.infer<typeof updateClientAddressSchema>;

export const clientAddressPublicSchema = z.object({
  id: z.string(),
  client_id: z.string(),
  label: z.string(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  region_code: z.string().nullable(),
  region_name: z.string().nullable(),
  district_code: z.string().nullable(),
  district_name: z.string().nullable(),
  is_default: z.boolean(),
  active: z.boolean(),
});
export type ClientAddressPublic = z.infer<typeof clientAddressPublicSchema>;

// --- Suppliers ------------------------------------------------------------

/**
 * A supplier whose goods the drivers collect. Its yards are pickup places that
 * point at it, so one name can stand for three gates.
 */
export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(120).transform(titleCase),
  phone_number: z.string().trim().max(32).nullish(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const supplierPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone_number: z.string().nullable(),
  active: z.boolean(),
  /** How many pickup places load from this supplier. */
  places_count: z.number().int(),
});
export type SupplierPublic = z.infer<typeof supplierPublicSchema>;
