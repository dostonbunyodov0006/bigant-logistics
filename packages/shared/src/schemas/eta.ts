import { z } from 'zod';

/**
 * A driver's position is reported only while the app is in the foreground,
 * every 15 s. Older than this and it is more likely to be where the phone was
 * put away than where the truck is now, so the ETA is still computed (the last
 * known position is better than nothing) but flagged, and the UI must say
 * "last seen N min ago" rather than present the number as live.
 */
export const ETA_STALE_AFTER_SECONDS = 180;

export const ETA_STATES = ['ok', 'stale', 'unavailable'] as const;
export type EtaState = (typeof ETA_STATES)[number];

/** Why no ETA could be produced. Each one is a different thing for the UI to say. */
export const ETA_UNAVAILABLE_REASONS = [
  'order_not_active', // not started yet, or already finished
  'returns_not_routable', // return destinations are categories, not places
  'no_driver',
  'no_driver_position', // driver has never reported a location
  'missing_coordinates', // order predates map pins
  'routing_unavailable', // Valhalla down or timed out
] as const;
export type EtaUnavailableReason = (typeof ETA_UNAVAILABLE_REASONS)[number];

export const etaStopKindSchema = z.enum(['pickup', 'client']);
export type EtaStopKind = z.infer<typeof etaStopKindSchema>;

export const etaLegSchema = z.object({
  kind: etaStopKindSchema,
  /** Which order this stop belongs to — on a co-loaded trip the next stop may
   *  not be the order that was asked about. */
  order_id: z.string(),
  /** Pickup source id for pickup stops; null for the client. */
  pickup_source_id: z.string().nullable(),
  name: z.string(),
  distance_km: z.number().nonnegative(),
  eta_seconds: z.number().nonnegative(),
});
export type EtaLeg = z.infer<typeof etaLegSchema>;

export const orderEtaSchema = z.object({
  order_id: z.string(),
  state: z.enum(ETA_STATES),
  reason: z.enum(ETA_UNAVAILABLE_REASONS).nullable(),
  computed_at: z.string().datetime(),
  driver_position: z
    .object({
      lat: z.number(),
      lng: z.number(),
      updated_at: z.string().datetime(),
      age_seconds: z.number().int().nonnegative(),
    })
    .nullable(),
  /** The stop the driver is heading to right now — what the driver card shows. */
  next_stop: etaLegSchema.nullable(),
  /** To *this* order's own client — what the seller's "delivers in ~35 min"
   *  means, even when other stops are interleaved ahead of it. */
  delivery: z.object({ distance_km: z.number().nonnegative(), eta_seconds: z.number().nonnegative() }).nullable(),
  /** To the end of the whole run. Equals `delivery` for an ordinary order; on a
   *  co-load it carries past this order's client to the other order's. */
  trip_total: z
    .object({ distance_km: z.number().nonnegative(), eta_seconds: z.number().nonnegative() })
    .nullable(),
  /** Every remaining leg in driving order, across the whole trip; next_stop is legs[0]. */
  legs: z.array(etaLegSchema),
});
export type OrderEta = z.infer<typeof orderEtaSchema>;
