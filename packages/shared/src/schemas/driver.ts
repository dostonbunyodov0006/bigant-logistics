import { z } from 'zod';
import { titleCase } from '../text';
import { DRIVER_DOC_TYPES, DRIVER_STATUSES, VEHICLE_CATEGORIES, VEHICLE_DOC_TYPES } from '../enums';
import { uzPhoneSchema } from '../phone';
import { vehicleTariffSchema } from './vehicle-tariff';
import { telegramIdSchema } from './user';

export const driverStatusSchema = z.enum(DRIVER_STATUSES);
export const driverDocTypeSchema = z.enum(DRIVER_DOC_TYPES);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

// Profile ("Ma'lumotlarim") fields — settable by admins/managers.
const driverProfileFields = {
  birth_date: dateStr.nullish(),
  license_category: z.string().max(40).nullish(),
  license_issued_at: dateStr.nullish(),
  license_expires_at: dateStr.nullish(),
  home_district_code: z.string().nullish(),
};

export const createDriverSchema = z.object({
  name: z.string().min(1).transform(titleCase),
  phone_number: uzPhoneSchema,
  password: z.string().min(6),
  vehicle_info: z.string().optional(),
  vehicle_id: z.string().optional(),
  ...driverProfileFields,
});
export type CreateDriverInput = z.infer<typeof createDriverSchema>;

export const updateDriverSchema = z.object({
  name: z.string().min(1).transform(titleCase).optional(),
  phone_number: uzPhoneSchema.optional(),
  password: z.string().min(6).optional(),
  /** His Telegram, as a seller's account has it; empty clears it. */
  telegram_id: telegramIdSchema.nullish(),
  vehicle_info: z.string().optional(),
  // string = assign that vehicle, null = unassign, undefined = leave unchanged.
  vehicle_id: z.string().nullable().optional(),
  ...driverProfileFields,
});
export type UpdateDriverInput = z.infer<typeof updateDriverSchema>;

export const updateDriverLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type UpdateDriverLocationInput = z.infer<typeof updateDriverLocationSchema>;

/**
 * Fixes the phone kept while it had no internet (owner, 04.11.2026), each with
 * the moment it was taken, sent together once the internet is back.
 */
export const driverLocationPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  recorded_at: z.string().datetime(),
});
export type DriverLocationPoint = z.infer<typeof driverLocationPointSchema>;

/**
 * Each point is checked on its own and a bad one is left out (owner,
 * 06.11.2026): checking the whole list refused it all for one bad point, and
 * the phone, told "invalid", dropped its whole backlog — hours of road.
 */
export const driverLocationBatchSchema = z.object({
  points: z
    .array(z.unknown())
    .min(1)
    .max(2000)
    .transform((all) =>
      all.flatMap((p) => {
        const r = driverLocationPointSchema.safeParse(p);
        return r.success ? [r.data] : [];
      }),
    ),
  // The phone's own clock when it sent this (owner, 06.11.2026): a clock set
  // wrong by hand shows as the gap to the server's, and every point is moved by it.
  sent_at: z.string().datetime().optional(),
});
export type DriverLocationBatchInput = z.infer<typeof driverLocationBatchSchema>;

export const driverPublicSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  phone_number: z.string(),
  telegram_id: z.string().nullable().optional(),
  current_status: driverStatusSchema,
  vehicle_info: z.string().nullable(),
  vehicle_id: z.string().nullable(),
  vehicle_plate: z.string().nullable(),
  vehicle_model: z.string().nullable(),
  vehicle_current_km: z.number().nullable(),
  vehicle_category: z.enum(VEHICLE_CATEGORIES).nullable(),
  // His lorry's own record, so the app can answer what he is asked on the
  // road: the papers, what it may carry, how big the bay is, what year it is.
  vehicle_tech_passport: z.string().nullable(),
  // The lorry's tech passport scans, for the driver's own Hujjatlar screen.
  vehicle_tech_passport_front_url: z.string().nullable(),
  vehicle_tech_passport_back_url: z.string().nullable(),
  vehicle_capacity_kg: z.number().nullable(),
  vehicle_length_cm: z.number().nullable(),
  vehicle_width_cm: z.number().nullable(),
  vehicle_height_cm: z.number().nullable(),
  vehicle_model_year: z.number().nullable(),
  // The lorry's dated papers, the latest of each kind: what he shows at a
  // checkpoint, and when each runs out.
  vehicle_documents: z.array(
    z.object({
      type: z.enum(VEHICLE_DOC_TYPES),
      issued_at: z.string().nullable(),
      expires_at: z.string(),
      holder_name: z.string().nullable(),
    }),
  ),
  // Profile ("Ma'lumotlarim").
  birth_date: z.string().nullable(), // YYYY-MM-DD
  license_category: z.string().nullable(),
  license_issued_at: z.string().nullable(), // YYYY-MM-DD
  license_expires_at: z.string().nullable(), // YYYY-MM-DD
  // Whole years since the licence was issued — his staj — or null without a date.
  license_years: z.number().int().nullable(),
  license_front_url: z.string().nullable(),
  license_back_url: z.string().nullable(),
  home_district_code: z.string().nullable(),
  home_district_name: z.string().nullable(),
  docs_expiry_alert: z.enum(['expired', 'soon']).nullable(),
  // Clock-in time of the driver's currently open work shift, or null when off-shift.
  shift_started_at: z.string().datetime().nullable(),
  // Short break / temporary excuse end time (Tanaffus), or null when not on break.
  break_until: z.string().datetime().nullable(),
  // When it begins. A break set for 16:30 at 16:12 is planned, not running:
  // until then the switch stays green and the board shows him working.
  break_started_at: z.string().datetime().nullable(),
  /** Why he is away, while the break lasts. */
  break_reason: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  location_updated_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type DriverPublic = z.infer<typeof driverPublicSchema>;

/**
 * Why a driver ends his shift with an order still in hand — "not today, I'll
 * deliver it tomorrow". A pressable reason, plus a comment (required for
 * `other`). The labels live in the apps.
 */
export const CARRY_OVER_REASONS = [
  'customer_not_ready',
  'customer_unreachable',
  'cargo_not_ready',
  'vehicle_problem',
  'out_of_time',
  'other',
] as const;
export type CarryOverReason = (typeof CARRY_OVER_REASONS)[number];

/** What a shift carried over to the next day, when it ended with orders in hand. */
export const shiftCarryOverSchema = z.object({
  order_id: z.string(),
  order_number: z.number().int(),
  client_name: z.string(),
  reason: z.enum(CARRY_OVER_REASONS),
  comment: z.string().nullable(),
});
export type ShiftCarryOver = z.infer<typeof shiftCarryOverSchema>;

export const workLogPublicSchema = z.object({
  id: z.string(),
  driver_id: z.string(),
  clock_in_at: z.string().datetime(),
  // Null while the shift is still open.
  clock_out_at: z.string().datetime().nullable(),
  // Whole minutes worked, breaks excluded; null while the shift is open.
  duration_minutes: z.number().int().nullable(),
  // Reason given for clocking in late / leaving early (null when on time).
  late_reason: z.string().nullable(),
  early_leave_reason: z.string().nullable(),
  // Server-computed against the driver's effective schedule (Tashkent time).
  is_late: z.boolean(),
  late_minutes: z.number().int(),
  is_early_leave: z.boolean(),
  early_minutes: z.number().int(),
  // Snapshot of the expected window, so later schedule edits don't rewrite history.
  expected_start: z.string().nullable(),
  expected_end: z.string().nullable(),
  // How it ended: driver | end_check_stop | auto_no_answer | auto_stale | auto_returned | auto_in_city (null while open).
  close_source: z.string().nullable(),
  // Ended by the system at the driver's last activity — for admin to review.
  auto_closed: z.boolean(),
  // Where the end-of-day check last found him: tashkent | viloyat | unknown.
  end_check_zone: z.string().nullable(),
  // What he said he was still doing with each "+30 min" (owner, 07.11.2026).
  end_check_notes: z.array(z.object({ at: z.string().datetime(), note: z.string() })),
  // Orders he ended the shift with, to deliver the next day (empty if none).
  carry_overs: z.array(shiftCarryOverSchema),
  // Tanaffus minutes taken during the shift; already left out of duration_minutes.
  break_minutes: z.number().int(),
  // Ended with "Polniy": the rest of the day off, asked for (owner, 12.11.2026).
  day_off: z.boolean().optional(),
  // Each break of the shift, with its extensions (owner, 12.11.2026).
  breaks: z.array(z.lazy(() => driverBreakPublicSchema)).optional(),
  // Staff corrected the times: when, who, and why (null if never corrected).
  corrected_at: z.string().datetime().nullable(),
  corrected_by_name: z.string().nullable(),
  correction_note: z.string().nullable(),
});
export type WorkLogPublic = z.infer<typeof workLogPublicSchema>;

/**
 * Staff fixing a shift: a forgotten clock-out, or an auto-close at the wrong
 * time. Sending clock_out_at for an open shift closes it. A note is required —
 * the history shows who changed what and why.
 */
export const correctWorkLogSchema = z
  .object({
    clock_in_at: z.string().datetime().optional(),
    clock_out_at: z.string().datetime().optional(),
    note: z.string().trim().min(1).max(500),
  })
  .refine((v) => v.clock_in_at || v.clock_out_at, { message: 'nothing_to_correct' });
export type CorrectWorkLogInput = z.infer<typeof correctWorkLogSchema>;

/**
 * What the end-of-day check leaves for admin to look at: drivers still on
 * shift outside Tashkent, shifts the system closed, and orders moved to the
 * next day that are not delivered yet.
 */
export const shiftAlertsSchema = z.object({
  viloyat: z.array(
    z.object({
      driver_id: z.string(),
      name: z.string(),
      work_log_id: z.string(),
      clock_in_at: z.string().datetime(),
      checked_at: z.string().datetime().nullable(),
    }),
  ),
  auto_closed: z.array(
    z.object({
      driver_id: z.string(),
      name: z.string(),
      work_log_id: z.string(),
      clock_in_at: z.string().datetime(),
      clock_out_at: z.string().datetime(),
      close_source: z.string().nullable(),
    }),
  ),
  // Shifts today with stretches of no position — GPS or internet off (owner, 04.11.2026).
  silent: z.array(
    z.object({
      driver_id: z.string(),
      name: z.string(),
      work_log_id: z.string(),
      minutes: z.number().int(),
      longest_from: z.string().datetime(),
      longest_to: z.string().datetime(),
    }),
  ),
  carried_over: z.array(
    z.object({
      driver_id: z.string(),
      name: z.string(),
      order_id: z.string(),
      order_number: z.number().int(),
      client_name: z.string(),
      reason: z.enum(CARRY_OVER_REASONS),
      comment: z.string().nullable(),
      at: z.string().datetime(),
    }),
  ),
});
export type ShiftAlerts = z.infer<typeof shiftAlertsSchema>;

// Optional accountability reason sent when starting late / finishing early.
export const clockInSchema = z.object({
  late_reason: z.string().trim().min(1).max(500).optional(),
  /** He was told today is his leave and starts all the same. */
  on_leave_ok: z.boolean().optional(),
});
export type ClockInInput = z.infer<typeof clockInSchema>;


export const carryOverSchema = z
  .object({
    reason: z.enum(CARRY_OVER_REASONS),
    comment: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.reason !== 'other' || !!v.comment, { message: 'carry_over_comment_required', path: ['comment'] });
export type CarryOverInput = z.infer<typeof carryOverSchema>;

export const clockOutSchema = z.object({
  early_leave_reason: z.string().trim().min(1).max(500).optional(),
  /**
   * Sent after the driver answered "not today" to "you have an order — will you
   * deliver it today?". Without it, ending a shift with an order in hand is
   * answered with `driver_has_orders` and the list, so the app can ask.
   */
  carry_over: carryOverSchema.optional(),
  /**
   * "Polniy" (owner, 12.11.2026): he asked for the rest of the day off. The
   * shift ends now, the reason is kept, and sellers cannot book him today.
   */
  day_off: z.boolean().optional(),
});
export type ClockOutInput = z.infer<typeof clockOutSchema>;

/** "+30 min" on the end-of-day check: what work he is still on (owner, 07.11.2026). */
export const extendShiftSchema = z.object({
  note: z.string().trim().max(300).optional(),
});
export type ExtendShiftInput = z.infer<typeof extendShiftSchema>;

/** One order a driver still has in hand, as the clock-out refusal lists it. */
export const orderInHandSchema = z.object({
  id: z.string(),
  order_number: z.number().int(),
  status: z.string(),
  client_name: z.string(),
});
export type OrderInHand = z.infer<typeof orderInHandSchema>;



/** Short break / temporary excuse (Tanaffus) — 1–8 hours; the seller board shows
 *  the driver's vehicle as excused (black) while it is active. */
export const driverBreakSchema = z
  .object({
    /** The old shape, kept so a phone that has not taken the update still works. */
    hours: z.number().int().min(1).max(8).optional(),
    /** When it starts and ends, as the driver set them on the clock. */
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    /** Why he is away, in his words. */
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.hours != null || (v.from != null && v.to != null), {
    message: 'break_time_required',
  })
  .refine((v) => v.from == null || v.to == null || new Date(v.to) > new Date(v.from), {
    message: 'break_end_before_start',
    path: ['to'],
  });
export type DriverBreakInput = z.infer<typeof driverBreakSchema>;

/** A longer break (owner, 12.11.2026): the new end, and why — always said; no limit on how often. */
export const driverBreakExtendSchema = z.object({
  to: z.string().datetime(),
  reason: z.string().trim().min(2).max(200),
});
export type DriverBreakExtendInput = z.infer<typeof driverBreakExtendSchema>;

/** One break as the admin reads it under the shift (owner, 12.11.2026). */
export const driverBreakPublicSchema = z.object({
  started_at: z.string().datetime(),
  planned_until: z.string().datetime(),
  until: z.string().datetime(),
  reason: z.string().nullable(),
  extensions: z.array(z.object({ at: z.string(), from: z.string(), to: z.string(), reason: z.string() })),
  ended_at: z.string().datetime().nullable(),
});
export type DriverBreakPublic = z.infer<typeof driverBreakPublicSchema>;

// Timesheet: aggregated worked days/hours per driver over an inclusive date range.
export const timesheetFilterSchema = z.object({
  from: dateStr,
  to: dateStr,
});
export type TimesheetFilterInput = z.infer<typeof timesheetFilterSchema>;

export const timesheetRowSchema = z.object({
  driver_id: z.string(),
  name: z.string(),
  // Distinct calendar days on which the driver had at least one completed shift.
  days_worked: z.number().int(),
  total_minutes: z.number().int(),
  shift_count: z.number().int(),
});
export type TimesheetRow = z.infer<typeof timesheetRowSchema>;

// Work-time report: analytical roll-up of completed shifts over a period.
export const workReportDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  total_minutes: z.number().int(),
  shift_count: z.number().int(),
});
export type WorkReportDay = z.infer<typeof workReportDaySchema>;

export const workReportSummarySchema = z.object({
  total_minutes: z.number().int(),
  total_shifts: z.number().int(),
  driver_count: z.number().int(),
  avg_minutes_per_driver: z.number().int(),
});
export type WorkReportSummary = z.infer<typeof workReportSummarySchema>;

export const workReportSchema = z.object({
  summary: workReportSummarySchema,
  by_day: z.array(workReportDaySchema), // team-wide, ascending by date
  by_driver: z.array(timesheetRowSchema), // descending by hours
});
export type WorkReport = z.infer<typeof workReportSchema>;

// Ish vaqti (owner, 05.11.2026): per lorry and per driver, each day from
// "Ishni boshlash" to "Ishni tugatish" — hours worked, hours on orders, and
// hours idle with no order in hand, lunch hour taken off.
export const idleRowSchema = z.object({
  id: z.string(), // vehicle id or driver id
  name: z.string(), // plate number, or the driver's name
  sub: z.string().nullable(), // the lorry's model, or the driver's plate
  // Per day, adding up: the shift = on orders + lunch + idle. Ascending.
  days: z.array(
    z.object({
      date: z.string(),
      worked_minutes: z.number().int(),
      busy_minutes: z.number().int(),
      lunch_minutes: z.number().int(),
      minutes: z.number().int(),
    }),
  ),
  worked_minutes: z.number().int(),
  busy_minutes: z.number().int(),
  lunch_minutes: z.number().int(),
  total_minutes: z.number().int(), // idle
});
export type IdleRow = z.infer<typeof idleRowSchema>;
export const idleReportSchema = z.object({
  vehicles: z.array(idleRowSchema),
  drivers: z.array(idleRowSchema),
});
export type IdleReport = z.infer<typeof idleReportSchema>;

export const driverDocumentPublicSchema = z.object({
  id: z.string(),
  driver_id: z.string(),
  type: driverDocTypeSchema,
  number: z.string().nullable(),
  issued_at: z.string().datetime().nullable(),
  expires_at: z.string().datetime(),
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type DriverDocumentPublic = z.infer<typeof driverDocumentPublicSchema>;

export const createDriverDocumentSchema = z.object({
  type: driverDocTypeSchema.default('other'),
  number: z.string().optional(),
  issued_at: dateStr.optional(),
  expires_at: dateStr,
  notes: z.string().optional(),
});
export type CreateDriverDocumentInput = z.infer<typeof createDriverDocumentSchema>;

export const updateDriverDocumentSchema = z.object({
  type: driverDocTypeSchema.optional(),
  number: z.string().nullish(),
  issued_at: dateStr.nullish(),
  expires_at: dateStr.optional(),
  notes: z.string().nullish(),
});
export type UpdateDriverDocumentInput = z.infer<typeof updateDriverDocumentSchema>;

export const driverLocationPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  current_status: driverStatusSchema,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  location_updated_at: z.string().datetime().nullable(),
  /** Speed from his last two fixes; null when they are too far apart in time to say. */
  speed_kmh: z.number().nullable(),
  /** When he last moved more than 50 m: how long he has stood. */
  moved_at: z.string().datetime().nullable(),
  /** His lorry, written beside the pin as the GPS trackers do: "01A000AA Gazel Ali". */
  vehicle_plate: z.string().nullable(),
  vehicle_model: z.string().nullable(),
  /**
   * The station he is standing inside, by name, worked out from his last fix
   * against the fences — null when he is anywhere else or the fix is old.
   * What the office means by "he is at the pump right now".
   */
  at_fuel_station: z.string().nullable(),
  /**
   * Which way he is driving, degrees clockwise from north, from his last two
   * kept fixes within the last half hour; null when standing or unknown. The
   * map turns the lorry's nose to it.
   */
  heading: z.number().nullable(),
});
export type DriverLocationPublic = z.infer<typeof driverLocationPublicSchema>;

// --- Driver self ("Ma'lumotlarim"): profile + the pay tariff for their vehicle class ---
/**
 * The end-of-day check on the open shift, when it has run: whether a reminder
 * is waiting for his answer ("+30 min" / "STOP"), how many in a row went
 * unanswered, and where he was found.
 */
export const shiftEndCheckSchema = z.object({
  awaiting_answer: z.boolean(),
  asked_at: z.string().datetime().nullable(),
  unanswered: z.number().int(),
  zone: z.enum(['tashkent', 'viloyat', 'unknown']).nullable(),
  /** The shift's scheduled end ("HH:MM"), for "your shift ended at 18:00". */
  shift_end: z.string().nullable(),
  // On the last ask only: when the shift closes by itself with no answer (owner, 07.11.2026).
  closes_at: z.string().datetime().nullable().optional(),
});
export type ShiftEndCheck = z.infer<typeof shiftEndCheckSchema>;

export const driverMeSchema = driverPublicSchema.extend({
  tariff: vehicleTariffSchema.nullable(),
  // Null when off shift, or before the check has looked at this shift.
  shift_end_check: shiftEndCheckSchema.nullable(),
  // When GPS must be on (owner, 04.11.2026): the working hours the office set,
  // or for as long as an order or return is in hand. Null: not required now.
  gps_required: z.object({ from: z.string().datetime(), until: z.string().datetime() }).nullable().optional(),
  // On a break: GPS alone must stay on (owner, 12.11.2026).
  gps_only: z.object({ from: z.string().datetime(), until: z.string().datetime() }).nullable().optional(),
});
export type DriverMe = z.infer<typeof driverMeSchema>;

// --- Driver earnings ("Maosh va bonuslar") ---
export const earningsPeriodSchema = z.enum(['today', 'month']);
export type EarningsPeriod = z.infer<typeof earningsPeriodSchema>;

export const earningsFilterSchema = z.object({
  period: earningsPeriodSchema.default('month'),
});
export type EarningsFilterInput = z.infer<typeof earningsFilterSchema>;

/** One line of the salary breakdown; `count` is days (daily_wage) or event count. */
export const earningsLineSchema = z.object({
  type: z.enum([
    'daily_wage',
    'pickup_city',
    'pickup_outside',
    'delivery_city',
    'delivery_outside',
    // Minutes started before 09:00 (count), at the hourly rate (unit_price_som).
    'early_start',
    // Minutes past the end of the day to the last photo (count), at the hourly rate.
    'evening_overtime',
    // Fines for the period (count), taken off: amount_som is negative.
    'fine',
  ]),
  count: z.number().int(),
  unit_price_som: z.number().int(),
  amount_som: z.number().int(),
});
export type EarningsLine = z.infer<typeof earningsLineSchema>;

export const driverEarningsSchema = z.object({
  period: earningsPeriodSchema,
  from: z.string().datetime(),
  to: z.string().datetime(),
  lines: z.array(earningsLineSchema),
  total_som: z.number().int(),
});
export type DriverEarnings = z.infer<typeof driverEarningsSchema>;

/** Admin list filter: a Tashkent calendar month; none = the latest 100. */
export const monthFilterSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM')
    .optional(),
});
export type MonthFilterInput = z.infer<typeof monthFilterSchema>;

/** The morning early start: first "yo'lga chiqdim" before 09:00, confirmed by GPS. */
export const morningStartSchema = z.object({
  id: z.string(),
  driver_id: z.string(),
  /** YYYY-MM-DD, Tashkent. */
  day: z.string(),
  order_id: z.string().nullable(),
  client_name: z.string().nullable(),
  action: z.enum(['pickup', 'customer', 'return']),
  pressed_at: z.string().datetime(),
  /** When the start counts from; null until the lorry has moved. */
  started_at: z.string().datetime().nullable(),
  status: z.enum(['waiting_gps', 'confirmed', 'no_move']),
  /** Minutes before 09:00 — what the bonus is paid on. */
  early_minutes: z.number().int(),
  rate_hour_som: z.number().int().optional(),
  amount_som: z.number().int().optional(),
});
export type MorningStart = z.infer<typeof morningStartSchema>;
