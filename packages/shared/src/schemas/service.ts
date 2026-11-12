import { z } from 'zod';
import { isWithinUzbekistan } from './coordinates';
import { FUEL_LOG_FLAGS, FUEL_LOG_OUTCOMES, FUEL_SETTLEMENTS, FUEL_SETTLEMENT_STATES } from './fuel';

/**
 * Vehicle service: maintenance planned by mileage, requested by the driver,
 * assigned by admin, or done on the spot — all ending in the same visit
 * record: which works, a photo per work, the odometer, what was paid, and
 * where the truck actually was (the same fence check the fuel log uses).
 *
 * Intervals are per work and the same for every truck; kilometres only.
 * Time-based intervals and the mid-order question are deliberately later.
 */

/** How a visit came to exist. */
export const SERVICE_VISIT_ORIGINS = ['mileage', 'emergency', 'request', 'assigned'] as const;
export type ServiceVisitOrigin = (typeof SERVICE_VISIT_ORIGINS)[number];

/**
 * requested → approved | declined (a driver's request, admin says yes or no)
 * approved / assigned → in_progress (the driver has arrived) → completed
 * emergency starts at in_progress. cancelled closes anything not completed.
 */
export const SERVICE_VISIT_STATUSES = ['requested', 'approved', 'declined', 'in_progress', 'completed', 'cancelled'] as const;
export type ServiceVisitStatus = (typeof SERVICE_VISIT_STATUSES)[number];

/** From 500 km before it is due, a reminder every day, and every day once overdue (owner, 06.11.2026). */
export const SERVICE_DUE_SOON_KM = 500;

export const SERVICE_REMINDER_KINDS = ['due_soon', 'overdue', 'repeat'] as const;
export type ServiceReminderKind = (typeof SERVICE_REMINDER_KINDS)[number];

// --- Reasons (the works catalogue) ---

export const serviceReasonSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Null: no schedule, the work is only pickable. */
  interval_km: z.number().int().positive().nullable(),
  active: z.boolean(),
  /** False for a reason a driver typed in; admin promotes it to the catalogue. */
  approved: z.boolean(),
  created_by_driver_name: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type ServiceReason = z.infer<typeof serviceReasonSchema>;

export const createServiceReasonSchema = z.object({
  name: z.string().trim().min(1).max(80),
  interval_km: z.number().int().positive().max(1_000_000).nullish(),
  active: z.boolean().default(true),
});
export type CreateServiceReasonInput = z.infer<typeof createServiceReasonSchema>;
export const updateServiceReasonSchema = createServiceReasonSchema.partial().extend({ approved: z.boolean().optional() });
export type UpdateServiceReasonInput = z.infer<typeof updateServiceReasonSchema>;

/** A driver adding a reason that is not on the list. */
export const suggestServiceReasonSchema = z.object({ name: z.string().trim().min(1).max(80) });
export type SuggestServiceReasonInput = z.infer<typeof suggestServiceReasonSchema>;

// --- Centres ---

export const serviceCenterSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  contracted: z.boolean(),
  active: z.boolean(),
});
export type ServiceCenter = z.infer<typeof serviceCenterSchema>;
export const nearbyServiceCenterSchema = serviceCenterSchema.extend({ distance_m: z.number().nonnegative() });
export type NearbyServiceCenter = z.infer<typeof nearbyServiceCenterSchema>;

export const createServiceCenterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).nullish(),
  address: z.string().trim().max(240).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  contracted: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type CreateServiceCenterInput = z.infer<typeof createServiceCenterSchema>;
export const updateServiceCenterSchema = createServiceCenterSchema.partial();
export type UpdateServiceCenterInput = z.infer<typeof updateServiceCenterSchema>;

export const nearbyServiceCentersQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type NearbyServiceCentersQuery = z.infer<typeof nearbyServiceCentersQuerySchema>;

// --- What is due ---

/** One work on one vehicle: where its schedule stands. */
export const serviceDueItemSchema = z.object({
  vehicle_id: z.string(),
  vehicle_plate: z.string(),
  vehicle_model: z.string(),
  driver_id: z.string().nullable(),
  driver_name: z.string().nullable(),
  reason_id: z.string(),
  reason_name: z.string(),
  interval_km: z.number().int(),
  current_km: z.number().int().nullable(),
  last_done_km: z.number().int().nullable(),
  due_km: z.number().int().nullable(),
  /** Negative when overdue. Null when the vehicle has no km or no baseline. */
  remaining_km: z.number().int().nullable(),
  /** How many times the driver has been told, and when last. */
  reminders_sent: z.number().int(),
  last_reminded_at: z.string().datetime().nullable(),
  /** An open visit that already covers this work, if any. */
  open_visit_id: z.string().nullable(),
  open_visit_status: z.enum(SERVICE_VISIT_STATUSES).nullable(),
});
export type ServiceDueItem = z.infer<typeof serviceDueItemSchema>;

/** Admin sets where a vehicle's schedule starts for a work. */
export const setServiceBaselineSchema = z.object({
  reason_id: z.string().min(1),
  last_done_km: z.number().int().nonnegative(),
});
export type SetServiceBaselineInput = z.infer<typeof setServiceBaselineSchema>;

// --- Visits ---

export const serviceVisitItemSchema = z.object({
  id: z.string(),
  reason_id: z.string().nullable(),
  name: z.string(),
  photo_url: z.string().nullable(),
  /** Every photo of the work, in slot order — two are asked for (owner, 11.11.2026). */
  photo_urls: z.array(z.string()).optional(),
  cost_sum: z.number().nullable(),
  /** km left to the work's due point when it was done: + early (could have driven on), − late. */
  remaining_km_at_visit: z.number().int().nullable(),
});
export type ServiceVisitItem = z.infer<typeof serviceVisitItemSchema>;

export const serviceVisitSchema = z.object({
  id: z.string(),
  status: z.enum(SERVICE_VISIT_STATUSES),
  origin: z.enum(SERVICE_VISIT_ORIGINS),
  vehicle_id: z.string(),
  vehicle_plate: z.string().nullable(),
  vehicle_model: z.string().nullable(),
  driver_id: z.string().nullable(),
  driver_name: z.string().nullable(),
  items: z.array(serviceVisitItemSchema),
  scheduled_at: z.string().datetime().nullable(),
  note: z.string().nullable(),
  order_id: z.string().nullable(),
  order_number: z.number().int().nullable(),
  client_name: z.string().nullable(),
  requested_at: z.string().datetime(),
  decided_at: z.string().datetime().nullable(),
  decided_by_name: z.string().nullable(),
  decline_reason: z.string().nullable(),
  assigned_by_name: z.string().nullable(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  // Where the truck was, as the fuel log records it.
  selected_center: serviceCenterSchema.nullable(),
  resolved_center: serviceCenterSchema.nullable(),
  outcome: z.enum(FUEL_LOG_OUTCOMES).nullable(),
  flags: z.array(z.enum(FUEL_LOG_FLAGS)),
  distance_m: z.number().nullable(),
  capture: z.object({ lat: z.number(), lng: z.number(), accuracy_m: z.number().nullable() }).nullable(),
  tracked: z.object({ lat: z.number(), lng: z.number(), at: z.string().datetime() }).nullable(),
  // What it cost.
  odometer_km: z.number().int().nullable(),
  total_sum: z.number().nullable(),
  original_total_sum: z.number().nullable(),
  receipt_photo_url: z.string().nullable(),
  /** The total the AI read off the receipt; null when it could not (owner, 11.11.2026). */
  receipt_read_sum: z.number().nullable().optional(),
  no_receipt: z.boolean(),
  driver_comment: z.string().nullable(),
  reviewed_by_name: z.string().nullable(),
  reviewed_at: z.string().datetime().nullable(),
  settlement: z.enum(FUEL_SETTLEMENTS).nullable(),
  settled_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type ServiceVisit = z.infer<typeof serviceVisitSchema>;

/** A work the driver ticks: a catalogue reason, or one typed in on the spot. */
const visitWorkSchema = z.union([
  z.object({ reason_id: z.string().min(1) }),
  z.object({ custom_name: z.string().trim().min(1).max(80) }),
]);
/** One more work on a visit that is already open — added at the centre when the mechanic finds it. */
export const addServiceVisitItemSchema = visitWorkSchema;
export type AddServiceVisitItemInput = z.infer<typeof addServiceVisitItemSchema>;

/**
 * The driver opens a visit. `emergency` starts at once (and may name the
 * order it interrupts); `request` waits for admin with a date and time.
 */
export const createServiceVisitSchema = z
  .object({
    origin: z.enum(['emergency', 'request']),
    works: z.array(visitWorkSchema).min(1).max(20),
    scheduled_at: z.string().datetime().nullish(),
    center_id: z.string().min(1).nullish(),
    note: z.string().trim().max(500).nullish(),
    order_id: z.string().min(1).nullish(),
  })
  .refine((v) => v.origin !== 'request' || !!v.scheduled_at, { message: 'scheduled_at_required', path: ['scheduled_at'] });
export type CreateServiceVisitInput = z.infer<typeof createServiceVisitSchema>;

/** Admin sends a truck to service: approved from the start. */
export const assignServiceVisitSchema = z.object({
  vehicle_id: z.string().min(1),
  works: z.array(visitWorkSchema).min(1).max(20),
  scheduled_at: z.string().datetime(),
  center_id: z.string().min(1).nullish(),
  note: z.string().trim().max(500).nullish(),
});
export type AssignServiceVisitInput = z.infer<typeof assignServiceVisitSchema>;

export const declineServiceVisitSchema = z.object({ reason: z.string().trim().max(300).nullish() });
export type DeclineServiceVisitInput = z.infer<typeof declineServiceVisitSchema>;

const capturePositionSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy_m: z.number().nonnegative().nullish() })
  .refine((c) => isWithinUzbekistan(c.lat, c.lng), { message: 'coordinates_outside_service_area', path: ['lat'] });

/** The driver has arrived: which centre (null on the Ko'cha path) and where the phone says it is. */
export const startServiceVisitSchema = z.object({
  center_id: z.string().min(1).nullish(),
  captured_at: z.string().datetime(),
  position: capturePositionSchema.nullable(),
});
export type StartServiceVisitInput = z.infer<typeof startServiceVisitSchema>;

/** A receipt photo to read before the visit is closed (owner, 11.11.2026). */
export const serviceReceiptReadSchema = z.object({ photo_base64: z.string().min(1) });
export type ServiceReceiptReadInput = z.infer<typeof serviceReceiptReadSchema>;

/** Photos per work the app asks for (owner, 11.11.2026). */
export const SERVICE_PHOTOS_PER_WORK = 2;
export const serviceItemPhotoSchema = z.object({
  photo_base64: z.string().min(1),
  /** Which of the work's photos this is, from 0; absent (older app) means the first. */
  slot: z.number().int().min(0).max(SERVICE_PHOTOS_PER_WORK - 1).optional(),
});
export type ServiceItemPhotoInput = z.infer<typeof serviceItemPhotoSchema>;

/**
 * Closing the visit. The total is always typed — it is what gets paid and
 * added up. A receipt photo is required unless the driver says there was
 * none; that statement is kept as a fact on the visit.
 */
export const completeServiceVisitSchema = z
  .object({
    // No longer asked (owner, 11.11.2026): the km come from the Monday odometer
    // photo. An older app still sends it, and it is still checked.
    odometer_km: z.number().int().positive().max(2_000_000).optional(), // a typo otherwise (audit, 07.11.2026)
    total_sum: z.number().nonnegative(),
    receipt_photo_base64: z.string().min(1).nullish(),
    no_receipt: z.boolean().default(false),
    /** Whatever the driver wants the office to know — "eski qism ustada qoldi". */
    comment: z.string().trim().max(500).nullish(),
    item_costs: z.array(z.object({ item_id: z.string().min(1), cost_sum: z.number().nonnegative() })).optional(),
  })
  .refine((v) => v.no_receipt || !!v.receipt_photo_base64, { message: 'receipt_or_no_receipt', path: ['receipt_photo_base64'] });
export type CompleteServiceVisitInput = z.infer<typeof completeServiceVisitSchema>;

export const correctServiceTotalSchema = z.object({ total_sum: z.number().nonnegative() });
export type CorrectServiceTotalInput = z.infer<typeof correctServiceTotalSchema>;

/** Filing under a centre falls back to the one the fence resolved at start. */
export const settleServiceVisitSchema = z.object({ settlement: z.enum(FUEL_SETTLEMENTS), center_id: z.string().min(1).nullish() });
export type SettleServiceVisitInput = z.infer<typeof settleServiceVisitSchema>;

const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const serviceVisitFilterSchema = z.object({
  vehicle_id: z.string().optional(),
  driver_id: z.string().optional(),
  center_id: z.string().optional(),
  reason_id: z.string().optional(),
  origin: z.enum(SERVICE_VISIT_ORIGINS).optional(),
  status: z.enum(SERVICE_VISIT_STATUSES).optional(),
  settlement_state: z.enum(FUEL_SETTLEMENT_STATES).optional(),
  from: dayStr.optional(),
  to: dayStr.optional(),
});
export type ServiceVisitFilterInput = z.infer<typeof serviceVisitFilterSchema>;
export const servicePeriodSchema = z.object({ from: dayStr.optional(), to: dayStr.optional() });
export type ServicePeriodInput = z.infer<typeof servicePeriodSchema>;

export const serviceSummarySchema = z.object({
  overdue: z.number().int(),
  due_soon: z.number().int(),
  pending_requests: z.number().int(),
  pending_review: z.number().int(),
  visits: z.number().int(),
  total_sum: z.number(),
});
export type ServiceSummary = z.infer<typeof serviceSummarySchema>;

export const serviceCenterTotalSchema = z.object({
  center: serviceCenterSchema,
  count: z.number().int(),
  total_sum: z.number(),
});
export type ServiceCenterTotal = z.infer<typeof serviceCenterTotalSchema>;

export const serviceDriverDebtSchema = z.object({
  driver_id: z.string(),
  driver_name: z.string().nullable(),
  vehicle_plate: z.string().nullable(),
  count: z.number().int(),
  total_sum: z.number(),
  oldest_at: z.string().datetime(),
});
export type ServiceDriverDebt = z.infer<typeof serviceDriverDebtSchema>;
export const payServiceDriverSchema = z.object({ to: dayStr.optional() });
export type PayServiceDriverInput = z.infer<typeof payServiceDriverSchema>;
