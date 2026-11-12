import { z } from 'zod';
import { VEHICLE_CATEGORIES } from '../enums';
import { coordinatesSchema } from './coordinates';

/**
 * Radius of the "fence" each stop of the running order projects. A co-loaded
 * order's stops must fall inside these circles: its pickups inside the running
 * order's pickup fences, its client inside the client fence.
 *
 * One number countrywide, by decision — generous inside Tashkent, tight between
 * viloyats, but a single radius is a rule a dispatcher can check on a map, and
 * "why was this refused?" has a one-sentence answer.
 *
 * 4 km since 09.11.2026 (owner): both pickups and both clients within 4 km.
 */
export const POPUTI_FENCE_RADIUS_M = 4000;

/** The most a po puti may add to the driver's trip, in minutes (owner, 10.11.2026: 35; 11.11.2026: an hour). */
export const POPUTI_MAX_DETOUR_MIN = 60;

/**
 * The first seller's client gets his goods within this many minutes of the
 * driver setting off for that order — his pickups, the po puti's pickups,
 * then him (owner, 11.11.2026: two hours). Not yet set off: from now.
 */
export const POPUTI_FIRST_CLIENT_WITHIN_MIN = 120;

/** Po puti orders one seller may put on one truck's trip — two clients (owner, 11.11.2026). */
export const POPUTI_MAX_PER_SELLER = 2;

/** What the first seller may allow his client to wait for a po puti (owner, 10.11.2026). */
export const POPUTI_DELAY_CHOICES = [15, 30, 45] as const;

/** Minutes a stop takes when timing a po puti: unloading at a client. */
export const POPUTI_STOP_DWELL_MIN = 15;

/** Minutes loading takes at a pickup (owner, 11.11.2026: 22, not 15). */
export const POPUTI_PICKUP_DWELL_MIN = 22;

/** Seconds spent standing at these stops: loading at each pickup, unloading at each client. */
export function poputiDwellSeconds(stops: readonly { kind: string }[]): number {
  return stops.reduce((a, s) => a + (s.kind === 'pickup' ? POPUTI_PICKUP_DWELL_MIN : POPUTI_STOP_DWELL_MIN) * 60, 0);
}

/** The road time the map gives is without traffic; Tashkent with its lights
 *  and jams is slower. Every po puti road time is taken one and a half times
 *  over, at any hour (owner, 11.11.2026). */
export const POPUTI_TRAFFIC_FACTOR = 1.5;

/** Why a co-load was refused. Each is a different thing to tell the seller. */
export const POPUTI_REJECTIONS = [
  'no_active_order', // the truck is not running anything to ride along with
  'not_allowed', // the running order's seller did not permit a co-load
  'driver_offline',
  'missing_coordinates', // the running order predates map pins
  'no_pickups_left', // rule 3 with nothing left to collect
  'too_many_pickups', // rule 3: more pickups than the running order has left
  'pickup_outside_fences', // rule 1
  'delivery_outside_fence', // rule 1
  'capacity_exceeded', // both loads ride together, so weight is cumulative
  'routing_unavailable', // fences passed, but the detour could not be measured
  'detour_too_long', // the added stops cost the driver more than POPUTI_MAX_DETOUR_MIN
  'poputi_taken', // the truck already carries a po puti: one at a time
  'too_long', // the cargo is longer than the truck's body
] as const;
export type PoputiRejection = (typeof POPUTI_REJECTIONS)[number];

export const poputiStopKindSchema = z.enum(['pickup', 'client']);

/** One stop of the merged trip, in driving order. */
export const poputiSequenceStopSchema = z.object({
  kind: poputiStopKindSchema,
  /** Which order the stop belongs to — the running one or the one being added. */
  belongs_to: z.enum(['running', 'candidate']),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
});
export type PoputiSequenceStop = z.infer<typeof poputiSequenceStopSchema>;

/** What the seller is proposing to add. */
export const poputiProbeSchema = z.object({
  pickups: z.array(coordinatesSchema).min(1).max(10),
  delivery: coordinatesSchema,
  weight_kg: z.number().int().positive().nullish(),
  /** The longest piece, cm (pipe, rebar, profile): must fit the truck's body. */
  length_cm: z.number().int().positive().nullish(),
});
export type PoputiProbe = z.infer<typeof poputiProbeSchema>;

export const poputiFitSchema = z.object({
  eligible: z.boolean(),
  reason: z.enum(POPUTI_REJECTIONS).nullable(),
  /** Extra road distance and time the co-load costs, over the running order
   *  alone. Null when the fences rejected it before any routing was needed. */
  detour_km: z.number().nonnegative().nullable(),
  detour_seconds: z.number().nonnegative().nullable(),
  /** The merged trip, in driving order. Empty when not eligible. */
  sequence: z.array(poputiSequenceStopSchema),
  /** Which order on the truck it rides with, and that order's place in the
   *  truck's queue — 1 = the one it is on now (owner, 10.11.2026). */
  host_order_id: z.string().nullable().optional(),
  reys: z.number().int().positive().nullable().optional(),
  /** How much later the first seller's client gets his goods: the extra road
   *  to him (traffic counted) plus the loading at each added stop before him
   *  (owner, 11.11.2026). */
  host_delay_seconds: z.number().nonnegative().nullable().optional(),
  /** Seconds from now to the latest the first seller's client may get his goods:
   *  when he would without the po puti, plus the delay allowed (owner, 11.11.2026). */
  host_deadline_seconds: z.number().nonnegative().nullable().optional(),
});
export type PoputiFit = z.infer<typeof poputiFitSchema>;

/** Reserving a po puti: the order on the truck the search matched it to. */
export const poputiReserveSchema = z.object({
  host_order_id: z.string().min(1).optional(),
});
export type PoputiReserveInput = z.infer<typeof poputiReserveSchema>;

/**
 * Reasons that mean "this cargo did not fit", as opposed to "this truck was
 * never a candidate". Only these are worth showing the seller: the vehicle
 * cleared every gate and failed on the load itself, so the seller can act on it.
 */
export const POPUTI_NEAR_MISS_REASONS = [
  'too_many_pickups',
  'pickup_outside_fences',
  'delivery_outside_fence',
  'capacity_exceeded',
] as const satisfies readonly PoputiRejection[];

/** Find the trucks that can carry this cargo, rather than testing one truck. */
export const poputiSearchSchema = z.object({
  client_id: z.string().min(1),
  pickup_place_ids: z.array(z.string().min(1)).min(1).max(10),
  // Required (owner, 10.11.2026): without it the truck's load cannot be checked.
  weight_kg: z.number().int().positive(),
  /** Optional: the longest piece, cm — only trucks whose body takes it (owner, 10.11.2026). */
  length_cm: z.number().int().positive().nullish(),
});
export type PoputiSearchInput = z.infer<typeof poputiSearchSchema>;

/** A truck that can take the cargo, with what the ride costs it. */
export const poputiMatchSchema = z.object({
  vehicle_id: z.string(),
  model: z.string(),
  plate_number: z.string(),
  category: z.enum(VEHICLE_CATEGORIES),
  capacity_kg: z.number().int().nullable(),
  driver_name: z.string().nullable(),
  /** Where the truck is already going — the running order's client district. */
  heading_to: z.string().nullable(),
  /** Null when the fences passed but the road could not be measured. */
  detour_km: z.number().nonnegative().nullable(),
  detour_seconds: z.number().nonnegative().nullable(),
  sequence: z.array(poputiSequenceStopSchema),
  /** YYYY-MM-DD when the truck is booked for a later day: the co-load goes that day too. */
  later_day: z.string().nullable().optional(),
  /** The order on the truck it would ride with, and which of the truck's
   *  orders that is (1 = the one it is on now). */
  host_order_id: z.string().nullable().optional(),
  reys: z.number().int().positive().nullable().optional(),
  /** Roughly when the truck reaches the seller's first pickup (today's trips only). */
  pickup_eta: z.string().nullable().optional(),
});
export type PoputiMatch = z.infer<typeof poputiMatchSchema>;

/** A truck that nearly took it, and the number that stopped it. */
export const poputiNearMissSchema = z.object({
  vehicle_id: z.string(),
  model: z.string(),
  plate_number: z.string(),
  driver_name: z.string().nullable(),
  reason: z.enum(POPUTI_NEAR_MISS_REASONS),
  /** How far outside its fence the worst stop landed. */
  over_by_km: z.number().nonnegative().nullable(),
  pickups_allowed: z.number().int().nullable(),
  pickups_offered: z.number().int().nullable(),
  over_capacity_kg: z.number().int().nullable(),
});
export type PoputiNearMiss = z.infer<typeof poputiNearMissSchema>;

export const poputiSearchResultSchema = z.object({
  matches: z.array(poputiMatchSchema),
  /** Closest first, and capped — every truck in the country is not a near miss. */
  near_misses: z.array(poputiNearMissSchema),
});
export type PoputiSearchResult = z.infer<typeof poputiSearchResultSchema>;
