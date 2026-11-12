import { z } from 'zod';
import { CARRY_OVER_REASONS } from './driver';
import { legStatusSchema } from './order';
import {
  BOOKING_KINDS,
  BOOKING_MODES,
  BOARD_STATUSES,
  ORDER_STATUSES,
  RETURN_DESTINATIONS,
  RETURN_STAGES,
  VEHICLE_BLOCK_REASONS,
  VEHICLE_CARD_STATES,
  VEHICLE_DOC_TYPES,
  VEHICLE_REQUIRED_FIELDS,
  VEHICLE_CATEGORIES,
} from '../enums';

export const boardViewSchema = z.enum(['free', 'mine', 'busy', 'tomorrow']);
export type BoardView = z.infer<typeof boardViewSchema>;

export const boardQuerySchema = z.object({ view: boardViewSchema.default('free') });
export type BoardQueryInput = z.infer<typeof boardQuerySchema>;

/** One pickup stop on a booked order. The stop's official geo (region + district)
 *  is copied from the pickup place itself — never re-entered per order. */
export const pickupSourceInputSchema = z.object({
  pickup_place_id: z.string().min(1),
});
export type PickupSourceInput = z.infer<typeof pickupSourceInputSchema>;

/** Reserve a vehicle: `kind` = zanyat (occupy now) | bron (pre-book); `mode` = 1x / 2x / full.
 *  `scheduled_date` (YYYY-MM-DD) defaults to today; a future date pre-books (Ertangi) — no fill-timer. */
export const reserveSchema = z.object({
  kind: z.enum(BOOKING_KINDS),
  mode: z.enum(BOOKING_MODES),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional(),
  /** Ertangi: the work starts at 09:00 (true) or first thing in the morning. */
  start_after_nine: z.boolean().optional(),
});
export type ReserveInput = z.infer<typeof reserveSchema>;

/** Fill an `awaiting_details` slot and commit it (Band qilish). */
export const fillOrderSchema = z.object({
  client_id: z.string().min(1),
  /** Which of the client's places it goes to; its default when left out. */
  client_address_id: z.string().min(1).nullish(),
  cargo_type_id: z.string().min(1),
  weight_kg: z.number().int().positive().nullish(),
  pickup_sources: z.array(pickupSourceInputSchema).min(1).max(10),
  length_cm: z.number().int().positive().nullish(),
  width_cm: z.number().int().positive().nullish(),
  height_cm: z.number().int().positive().nullish(),
  over_limit_attested: z.boolean().default(false),
  waybill_source: z.string().max(120).nullish(),
  poputi_allowed: z.boolean().default(false),
  /** With po puti allowed: at most this many minutes added for his client (15 / 30 / 45). */
  poputi_max_delay_min: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullish(),
  comment: z.string().max(500).nullish(),
  /** A po puti slot: the order on the truck the seller picked it to ride with. */
  poputi_host_order_id: z.string().min(1).nullish(),
});
export type FillOrderInput = z.infer<typeof fillOrderSchema>;

// --- Public shapes ---

export const boardVehicleSchema = z.object({
  id: z.string(),
  model: z.string(),
  plate_number: z.string(),
  category: z.enum(VEHICLE_CATEGORIES),
  capacity_kg: z.number().int().nullable(),
  length_cm: z.number().int().nullable(),
  width_cm: z.number().int().nullable(),
  height_cm: z.number().int().nullable(),
  driver_id: z.string().nullable(),
  driver_name: z.string().nullable(),
  board_status: z.enum(BOARD_STATUSES),
  // Seven-colour card state (booking + shift + leave/break + repair/docs).
  card_state: z.enum(VEHICLE_CARD_STATES),
  // The driver is on leave that day: not for hire, listed among the busy.
  on_leave: z.boolean(),
  /** He has not pressed Ish boshlandi yet — said on the Ertangi card too. */
  driver_not_started: z.boolean().optional(),
  // The leave the driver is on, as YYYY-MM-DD, so the card can say from when to when.
  leave_from: z.string().nullable(),
  leave_to: z.string().nullable(),
  // Why the card is red, spelled out on it; null unless card_state is 'blocked'.
  blocked_reason: z.enum(VEHICLE_BLOCK_REASONS).nullable(),
  // Which papers have run out, so the card can name them rather than hint.
  expired_docs: z.array(z.enum(VEHICLE_DOC_TYPES)),
  // Which required papers the lorry has none of at all.
  missing_docs: z.array(z.enum(VEHICLE_DOC_TYPES)),
  // What is missing from the lorry's own record, named the same way.
  missing_fields: z.array(z.enum(VEHICLE_REQUIRED_FIELDS)),
  // The vehicle's current order status — the furthest-along active order — so the
  // seller can see where their order is in its journey; null when the truck is idle.
  order_status: z.enum(ORDER_STATUSES).nullable(),
  // True if the driver is carrying an undelivered return (Vozrat) → show a "!".
  has_pending_return: z.boolean(),
  // The truck could take a co-load: running order that permits one, driver
  // online, collecting still left. Whether *your* cargo fits is the search's
  // answer, not this one.
  poputi_open: z.boolean(),
  // Return-trip stage + destination, for the place-aware "{joy}ga qaytmoqda" label.
  return_stage: z.enum(RETURN_STAGES).nullable(),
  return_destination: z.enum(RETURN_DESTINATIONS).nullable(),
  // How many fully saved orders the requesting seller has on this truck.
  my_slots: z.number().int(),
  // How many of the truck's committed orders are returns (vozvrat).
  vozvrat_slots: z.number().int(),
  // The order the driver is actually working on (lowest queue position among
  // the truck's committed orders); null when idle. An ETA is only truthful for
  // this one — anything queued behind it would be an "if he left now" number.
  current_order_id: z.string().nullable(),
  // This seller's committed orders on the truck, in queue order.
  my_order_ids: z.array(z.string()),
  // Distinct sellers on the truck: saved orders and holds being filled.
  seller_count: z.number().int(),
  // Only fully saved orders contribute to the visible 1x / 2x / Polniy label.
  confirmed_slots: z.number().int(),
  confirmed_full_booking: z.boolean(),
  // Pending form reservations still hold capacity, but are shown as "being filled".
  has_pending_hold: z.boolean(),
  // How many slots are still being filled, so the chip can count them.
  pending_holds: z.number().int(),
  has_my_pending_hold: z.boolean(),
  // Earliest fill-deadline of an unfilled slot on this truck (ISO), else null.
  awaiting_until: z.string().datetime().nullable(),
  // The break's end while he is on one or has not come back from it (owner,
  // 12.11.2026): the card counts down to it, then counts the lateness in red.
  break_until: z.string().datetime().nullable().optional(),
  // When that break began, for how long it was set (owner, 12.11.2026).
  break_from: z.string().datetime().nullable().optional(),
  // "Polniy" today: he asked for the day off; not bookable today.
  day_off: z.boolean().optional(),
  // "Ishxona ishi bilan" running on this lorry (owner, 12.11.2026).
  company_job: z
    .object({ id: z.string(), tasks: z.array(z.string()), until: z.string().datetime(), created_by_name: z.string() })
    .nullable()
    .optional(),
});
export type BoardVehicle = z.infer<typeof boardVehicleSchema>;

export const boardResponseSchema = z.object({
  katta: z.array(boardVehicleSchema),
  yengil: z.array(boardVehicleSchema),
});
export type BoardResponse = z.infer<typeof boardResponseSchema>;

/** A booked order as shown in the vehicle's queue / "Mening zakazlarim". */
export const sellerOrderSchema = z.object({
  id: z.string(),
  order_number: z.number(),
  status: z.string(),
  booking_kind: z.enum(BOOKING_KINDS).nullable(),
  /** Ertangi booked for after 09:00. */
  start_after_nine: z.boolean().optional(),
  /** Ertangi: when the driver may start it; null once it is open. */
  actions_available_at: z.string().datetime().nullable().optional(),
  // A vozvrat is fetched from the client, not delivered to them; the card says so.
  is_vozvrat: z.boolean(),
  is_backhaul: z.boolean(),
  full_booking: z.boolean(),
  poputi_allowed: z.boolean(),
  /** A po puti order: minutes it added to the truck's trip (shown to the seller it rides with). */
  poputi_detour_min: z.number().int().nullable().optional(),
  cargo_type_name: z.string().nullable(),
  weight_kg: z.number().int().nullable(),
  client_name: z.string().nullable(),
  district_name: z.string().nullable(),
  waybill_source: z.string().nullable(),
  booked_by_name: z.string().nullable(),
  mine: z.boolean(),
  problem_reason: z.string().nullable(),
  problem_comment: z.string().nullable(),
  /**
   * The driver's write-up of what came back, waiting on this seller. The goods
   * are his, so the return legs stop here until he has looked at the list:
   * `return_items_written` is how many lines there are, and
   * `return_items_confirmed` whether he has already said yes.
   */
  return_items_written: z.number().int(),
  return_items_confirmed: z.boolean(),
  /** The driver ended his shift with it and gave this reason; it goes out the next day. */
  carried_over: z
    .object({
      reason: z.enum(CARRY_OVER_REASONS),
      comment: z.string().nullable(),
      at: z.string().datetime(),
    })
    .nullable(),
  // `leg_status` lets the queue show how far through its stops the order being
  // driven has got, without a second request.
  pickup_sources: z.array(
    z.object({
      name: z.string(),
      district_name: z.string().nullable(),
      leg_status: legStatusSchema,
      /** Place in the driver's merged trip. Null unless a co-load shares it. */
      trip_position: z.number().int().nullable(),
    }),
  ),
  /** As above, for this order's client stop. */
  delivery_trip_position: z.number().int().nullable(),
  /**
   * The order this one rides with, when a po puti co-load put both on one trip.
   *
   * A co-load is not waiting its turn — it is aboard already, its stops woven
   * into the host's route. Without this the queue can only order rows by
   * `queue_position`, which shows a co-load as "2nd in line" and tells the
   * seller the opposite of what is happening.
   */
  rides_with_order_id: z.string().nullable(),
  fill_deadline: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type SellerOrder = z.infer<typeof sellerOrderSchema>;

export const reservationSlotStatusSchema = z.enum([
  'awaiting',
  'queued',
  'filled',
  'cancelled',
  'expired',
]);

/** One order-slot within a booking session (1-zakaz / 2-zakaz / …). */
export const bookingSlotSchema = z.object({
  reservation_id: z.string(),
  sequence_index: z.number().int(),
  status: reservationSlotStatusSchema,
  /** A po puti slot: riding with another seller's order, it cannot host one itself. */
  is_backhaul: z.boolean().optional(),
  // Only the active (awaiting) slot runs a timer; null for queued / pre-booked.
  fill_deadline: z.string().datetime().nullable(),
  // The committed order once this slot is filled.
  order: sellerOrderSchema.nullable(),
});
export type BookingSlot = z.infer<typeof bookingSlotSchema>;

/** A booking session: the tabbed multi-order fill (single / 2x / full). */
export const bookingSessionSchema = z.object({
  group_id: z.string(),
  mode: z.enum(BOOKING_MODES),
  vehicle_id: z.string(),
  slots: z.array(bookingSlotSchema), // ordered by sequence_index
});
export type BookingSession = z.infer<typeof bookingSessionSchema>;

/** Reserve result = the created booking session. */
export const reserveResultSchema = bookingSessionSchema;
export type ReserveResult = BookingSession;

/** An awaiting hold (unfilled slot) shown in a vehicle's queue. */
export const pendingHoldSchema = z.object({
  reservation_id: z.string(),
  group_id: z.string().nullable(),
  kind: z.enum(BOOKING_KINDS),
  full_booking: z.boolean(),
  is_backhaul: z.boolean(),
  booked_by_name: z.string().nullable(),
  fill_deadline: z.string().datetime().nullable(),
  mine: z.boolean(),
});
export type PendingHold = z.infer<typeof pendingHoldSchema>;

/** A vehicle's queue: committed booking orders + awaiting holds. */
export const vehicleQueueSchema = z.object({
  // The seller's own Polniy booking on this lorry, if any: the next order is added to it.
  my_full_group_id: z.string().nullable(),
  orders: z.array(sellerOrderSchema),
  holds: z.array(pendingHoldSchema),
});
export type VehicleQueue = z.infer<typeof vehicleQueueSchema>;

/**
 * One line of the fleet reference the seller keeps open: whose lorry, its
 * plate, and the tech-passport number clients and warehouses ask him for.
 */
export const techPassportRowSchema = z.object({
  // Null for a driver with no lorry of his own yet: his licence is still a paper the office keeps.
  vehicle_id: z.string().nullable(),
  driver_id: z.string().nullable(),
  plate_number: z.string().nullable(),
  model: z.string().nullable(),
  driver_name: z.string().nullable(),
  tech_passport: z.string().nullable(),
  owner: z.string().nullable(),
  capacity_kg: z.number().nullable(),
  length_cm: z.number().nullable(),
  width_cm: z.number().nullable(),
  height_cm: z.number().nullable(),
  license_category: z.string().nullable(),
  license_years: z.number().int().nullable(),
  license_expires_at: z.string().nullable(),
  // The papers themselves, when the office has photographed them.
  tech_passport_front_url: z.string().nullable(),
  tech_passport_back_url: z.string().nullable(),
  license_front_url: z.string().nullable(),
  license_back_url: z.string().nullable(),
});
export type TechPassportRow = z.infer<typeof techPassportRowSchema>;

/** PATCH /seller/orders/:id/start-time — Ertangi before or after 09:00. */
export const startTimeSchema = z.object({ start_after_nine: z.boolean() });
export type StartTimeInput = z.infer<typeof startTimeSchema>;

/** "Ishxona ishi bilan" (owner, 12.11.2026): what for, and for how long. */
export const companyJobSchema = z.object({
  tasks: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  // Minutes, half an hour to twelve hours.
  minutes: z.number().int().min(30).max(12 * 60),
});
export type CompanyJobInput = z.infer<typeof companyJobSchema>;

/** An entry of the "Nima ish bilan?" list (owner, 12.11.2026). */
export const companyJobOptionSchema = z.object({ name: z.string().trim().min(1).max(200) });
export type CompanyJobOptionInput = z.infer<typeof companyJobOptionSchema>;
export type CompanyJobOption = { id: string; name: string };
