import { z } from 'zod';
import { titleCase } from '../text';
import { uzPhoneSchema } from '../phone';
import { pageSchema, paginationSchema } from './pagination';
import { coordinateFields, refineCoordinatePair } from './coordinates';
import { clientAddressPublicSchema } from './client-address';

const clientFields = z.object({
  // Stored as a name: "akmal aka" and "AKMAL AKA" both become "Akmal Aka".
  name: z.string().min(1).transform(titleCase),
  phone_number: uzPhoneSchema,
  // Region (viloyat) is required going forward; district (tuman) only for Tashkent.
  region_code: z.string().min(1),
  district_code: z.string().nullish(),
  // Free-text landmark / house detail — optional now that region/district are structured.
  address: z.string().optional(),
  location: z.string().optional(),
  // Map pin — see create vs update below.
  ...coordinateFields,
  /**
   * The seller the client belongs to. Staff only: a seller's own clients are
   * always theirs, and this field is ignored when a seller sends it. Null =
   * nobody yet — visible to staff only.
   */
  // Empty string = unassigned too: it is what the form's "nobody" option sends.
  seller_id: z.string().nullish(),
  /**
   * Somebody who orders once. The order still needs a client row, but the
   * seller's address book does not need the name — a one-off stays out of the
   * list and the search.
   */
  one_off: z.boolean().optional(),
});

// The pin is wanted, not demanded. A seller taking a one-off order should not
// have to find the place on a map first: without a pin the order has no ETA and
// no route for the driver, which is a cost the seller can weigh — being unable
// to take the order at all is not. Both halves still travel together.
export const createClientSchema = refineCoordinatePair(clientFields);
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = refineCoordinatePair(clientFields.partial());
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const clientPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone_number: z.string(),
  address: z.string().nullable(),
  location: z.string().nullable(),
  region_code: z.string().nullable(),
  region_name: z.string().nullable(),
  district_code: z.string().nullable(),
  district_name: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  // Derived from the region: Tashkent city + region = true (drives tariff shahar/tashqari).
  is_city: z.boolean(),
  /**
   * Every place this client takes deliveries at, the default first. A client
   * created before addresses existed has exactly one, carried over from the
   * fields above, so the list is never empty.
   */
  addresses: z.array(clientAddressPublicSchema).default([]),
  created_by: z.string(),
  // Whose client it is (null = not assigned to a seller yet).
  seller_id: z.string().nullable(),
  seller_name: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ClientPublic = z.infer<typeof clientPublicSchema>;

/** Search + pagination for the client list. */
export const clientFilterSchema = z.object({
  ...paginationSchema.shape,
  search: z.string().optional(),
  /** Staff filter: one seller's clients, or `none` for the unassigned. Ignored for sellers. */
  seller_id: z.string().min(1).optional(),
});
export type ClientFilterInput = z.infer<typeof clientFilterSchema>;

/** A page of clients plus the total matching count. */
export const clientPageSchema = pageSchema(clientPublicSchema);
export type ClientPage = z.infer<typeof clientPageSchema>;
