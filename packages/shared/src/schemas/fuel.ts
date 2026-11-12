import { z } from 'zod';
import { isWithinUzbekistan } from './coordinates';

/**
 * Fuel logging.
 *
 * A driver photographs the dispenser after every fill. The server reads the
 * numbers, works out where the truck actually was, and files the fill under
 * the account that pays for it — the station's, when the truck was inside a
 * contracted station's fence, or the driver's, when it was not.
 *
 * The station the driver taps is recorded and never trusted on its own.
 */
export const FUEL_TYPES = ['gaz', 'benzin', 'propan'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export const fuelTypeSchema = z.enum(FUEL_TYPES);

/** What the dispenser measures, per fuel: gas by normal cubic metre, liquids by litre. */
export const FUEL_UNITS = { gaz: 'nm3', benzin: 'l', propan: 'l' } as const satisfies Record<FuelType, string>;
export type FuelUnit = (typeof FUEL_UNITS)[FuelType];

/**
 * A forecourt is 50–100 m across and a phone's fix under a canopy drifts.
 * 150 m covers that; much wider starts matching the station across the road.
 */
export const FUEL_STATION_FENCE_RADIUS_M = 150;
/** "Yaqinimda": the nearest few, and only if they are actually near. */
export const FUEL_NEARBY_LIMIT = 3;
export const FUEL_NEARBY_RADIUS_M = 3_000;
/** A fix older than this says where the phone was, not where it is. */
export const FUEL_GPS_STALE_MS = 5 * 60_000;
/** The phone's fix and the tracked position this far apart is a photo taken elsewhere. */
export const FUEL_TRACKING_DISAGREE_M = 500;
/**
 * What a unit of each fuel can plausibly cost, so'm per Nm³ or per litre —
 * deliberately wide, meant to outlive several years of price changes. A
 * reading outside the band is a misread digit, not a bargain: 562 so'm per
 * Nm³ of methane is what a faded LCD produced when the model dropped a digit
 * of 5 600, self-consistently enough that arithmetic alone did not catch it.
 */
export const FUEL_UNIT_PRICE_BAND: Record<FuelType, readonly [min: number, max: number]> = {
  gaz: [2_000, 15_000],
  benzin: [5_000, 30_000],
  propan: [3_000, 20_000],
};

/**
 * What a reading of the pump is worth, on the model's own 0-100 scale.
 *
 * Under RETAKE the photograph is the problem and the driver is asked for a
 * better one; between that and TRUST it is read but not to be trusted, so the
 * numbers are offered already typed in for him to correct; at TRUST and above
 * the reading stands and he only confirms it.
 */
export const FUEL_READ_CONFIDENCE_RETAKE = 60;
export const FUEL_READ_CONFIDENCE_TRUST = 80;

/** quantity × unit price may differ from the total by this much and still count as agreeing. */
export const FUEL_ARITHMETIC_TOLERANCE_SUM = 1;

/**
 * Where the truck was, against what the driver said.
 *
 * - matched: inside the fence of the station the driver picked.
 * - other_station: inside a different contracted station's fence — the pick
 *   is corrected to that station and flagged.
 * - unlisted: inside no fence (or no station picked) — the driver paid.
 * - mismatch: a contracted station was picked but the truck was inside no
 *   fence — held for a person to look at.
 * - unverified: no usable position at all; the pick stands, flagged.
 */
export const FUEL_LOG_OUTCOMES = ['matched', 'other_station', 'unlisted', 'mismatch', 'unverified'] as const;
export type FuelLogOutcome = (typeof FUEL_LOG_OUTCOMES)[number];

/** Signals that ride along with an outcome without changing it. */
/** `driver_edited`: the photo was read, and the driver confirmed different numbers — held for a person to compare with the photo. */
export const FUEL_LOG_FLAGS = [
  'no_gps',
  'gps_stale',
  'tracking_disagrees',
  'arithmetic_off',
  'unit_mismatch',
  'driver_edited',
  // The reader could not be sure of a digit on this line of the pump.
  'unclear_total',
  'unclear_quantity',
  'unclear_unit_price',
] as const;
export type FuelLogFlag = (typeof FUEL_LOG_FLAGS)[number];

/** Why a photo could not be read, in the terms the driver is told. */
export const FUEL_RETAKE_REASONS = ['blur', 'glare', 'cropped', 'not_dispenser', 'unreadable'] as const;
export type FuelRetakeReason = (typeof FUEL_RETAKE_REASONS)[number];

export const FUEL_LOG_STATUSES = ['draft', 'confirmed'] as const;
export type FuelLogStatus = (typeof FUEL_LOG_STATUSES)[number];

export const FUEL_SETTLEMENTS = ['station_invoice', 'driver_reimbursement'] as const;
export type FuelSettlement = (typeof FUEL_SETTLEMENTS)[number];

// --- Stations ---

export const fuelStationSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  fuel_types: z.array(fuelTypeSchema),
  contracted: z.boolean(),
  active: z.boolean(),
});
export type FuelStation = z.infer<typeof fuelStationSchema>;

/** A station as "Yaqinimda" lists it: with how far away it is. */
export const nearbyFuelStationSchema = fuelStationSchema.extend({
  distance_m: z.number().nonnegative(),
});
export type NearbyFuelStation = z.infer<typeof nearbyFuelStationSchema>;

export const createFuelStationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).nullish(),
  address: z.string().trim().max(240).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  fuel_types: z.array(fuelTypeSchema).min(1),
  contracted: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type CreateFuelStationInput = z.infer<typeof createFuelStationSchema>;

export const updateFuelStationSchema = createFuelStationSchema.partial();
export type UpdateFuelStationInput = z.infer<typeof updateFuelStationSchema>;

export const nearbyFuelStationsQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  fuel_type: fuelTypeSchema,
});
export type NearbyFuelStationsQuery = z.infer<typeof nearbyFuelStationsQuerySchema>;

// --- Logs ---

/**
 * The phone's fix at the moment the shutter was pressed. Bounded to the
 * country like every other coordinate we store: a fix in the sea is a bug,
 * not a position.
 */
export const capturePositionSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().nonnegative().nullish(),
  })
  .refine((c) => isWithinUzbekistan(c.lat, c.lng), {
    message: 'coordinates_outside_service_area',
    path: ['lat'],
  });

/**
 * The photo and everything the phone knew when it was taken. Opens a draft.
 * `station_id` is null on the Ko'cha path — a station not in our list.
 */
export const createFuelLogSchema = z.object({
  fuel_type: fuelTypeSchema,
  station_id: z.string().min(1).nullish(),
  photo_base64: z.string().min(1),
  captured_at: z.string().datetime(),
  /** Null when the phone could not get a fix; the log is then `unverified`. */
  position: capturePositionSchema.nullable(),
});
export type CreateFuelLogInput = z.infer<typeof createFuelLogSchema>;

/** The three numbers off the dispenser, as the driver confirms them. */
export const fuelReadingSchema = z.object({
  total_sum: z.number().positive(),
  quantity: z.number().positive(),
  unit_price_sum: z.number().positive(),
});
export type FuelReading = z.infer<typeof fuelReadingSchema>;

export const confirmFuelLogSchema = fuelReadingSchema;
export type ConfirmFuelLogInput = z.infer<typeof confirmFuelLogSchema>;

/** An admin's correction of the three numbers, with the photo in front of them. */
export const correctFuelReadingSchema = fuelReadingSchema.extend({
  /** Saved through Tahrirlash: a correction, even when the digits came out the same. */
  corrected: z.boolean().optional(),
});
export type CorrectFuelReadingInput = z.infer<typeof correctFuelReadingSchema>;

/**
 * Flags that mean the fill itself is in doubt — the numbers, or where it
 * happened. A log carrying one is not settled automatically even when the
 * fence is happy: a wrong total on a station's invoice, or a fill charged to
 * somebody on a position nothing corroborates, is exactly the mistake the
 * review queue exists for.
 *
 * The position ones matter as much as the arithmetic: the photo's coordinate
 * comes from the phone and the app can be lied to, so when it disagrees with
 * the trail the server kept, or there is no recent fix at all, a person looks
 * before any money moves.
 */
export const FUEL_REVIEW_FLAGS = [
  'arithmetic_off',
  'unit_mismatch',
  'driver_edited',
  'tracking_disagrees',
  'gps_stale',
  'no_gps',
] as const satisfies readonly FuelLogFlag[];

export const fuelLogSchema = z.object({
  id: z.string(),
  status: z.enum(FUEL_LOG_STATUSES),
  fuel_type: fuelTypeSchema,
  unit: z.enum(['nm3', 'l']),
  photo_url: z.string(),
  driver_id: z.string(),
  vehicle_id: z.string().nullable(),
  selected_station: fuelStationSchema.nullable(),
  resolved_station: fuelStationSchema.nullable(),
  outcome: z.enum(FUEL_LOG_OUTCOMES),
  flags: z.array(z.enum(FUEL_LOG_FLAGS)),
  /** Metres from the capture position to the resolved station; null when either is unknown. */
  distance_m: z.number().nonnegative().nullable(),
  captured_at: z.string().datetime(),
  /** What the AI read; null until all three numbers are there and confident. */
  extracted: fuelReadingSchema.nullable(),
  /**
   * What it managed to read even when it was not sure — a figure per field,
   * any of them null. The driver is standing in front of the pump: showing him
   * what the photo was read as, to correct, beats handing him three zeroes.
   */
  read_attempt: z
    .object({
      total_sum: z.number().nullable(),
      quantity: z.number().nullable(),
      unit_price_sum: z.number().nullable(),
    })
    .nullable(),
  /** Null: not attempted (no key, timeout). False: attempted, display not legible — ask for a retake. */
  extracted_readable: z.boolean().nullable(),
  /**
   * How sure the reading is, 0-100. Under 60 the driver is asked for a better
   * photograph, under 80 he is expected to correct what was read, and above
   * that it stands as read.
   */
  extracted_confidence: z.number().int().nullable(),
  extracted_reason: z.enum(FUEL_RETAKE_REASONS).nullable(),
  /** The numbers as they stand: the driver's, or an admin's correction of them. Null while a draft. */
  confirmed: fuelReadingSchema.nullable(),
  /** What the driver entered before an admin corrected it; null when never corrected. */
  original: fuelReadingSchema.nullable(),
  reviewed_by_name: z.string().nullable(),
  /** The reviewer's role: tells an admin's correction from a dispatcher's. */
  reviewed_by_role: z.enum(['admin', 'manager', 'seller', 'driver']).nullable().optional(),
  reviewed_at: z.string().datetime().nullable(),
  settlement: z.enum(FUEL_SETTLEMENTS).nullable(),
  settled_at: z.string().datetime().nullable(),
  // For the people reviewing it: who, which truck, and where the two positions were.
  driver_name: z.string().nullable(),
  vehicle_plate: z.string().nullable(),
  vehicle_model: z.string().nullable(),
  capture: z.object({ lat: z.number(), lng: z.number(), accuracy_m: z.number().nullable() }).nullable(),
  tracked: z.object({ lat: z.number(), lng: z.number(), at: z.string().datetime() }).nullable(),
  tracking_gap_m: z.number().nullable(),
  created_at: z.string().datetime(),
});
export type FuelLog = z.infer<typeof fuelLogSchema>;

/** Admin listing of confirmed logs. Dates are calendar days, `YYYY-MM-DD`. */
/**
 * Where a confirmed log is in its life: `pending` has no settlement yet (the
 * review queue), `unpaid` knows who pays but has not been paid, `paid` is done.
 */
export const FUEL_SETTLEMENT_STATES = ['pending', 'unpaid', 'paid'] as const;
export type FuelSettlementState = (typeof FUEL_SETTLEMENT_STATES)[number];

const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const fuelLogFilterSchema = z.object({
  driver_id: z.string().optional(),
  station_id: z.string().optional(),
  fuel_type: fuelTypeSchema.optional(),
  outcome: z.enum(FUEL_LOG_OUTCOMES).optional(),
  /** Whose hand changed the numbers: the driver's at the pump, or the office's after. */
  edited: z.enum(['driver', 'office', 'dispatcher', 'admin']).optional(),
  settlement_state: z.enum(FUEL_SETTLEMENT_STATES).optional(),
  from: dayStr.optional(),
  to: dayStr.optional(),
  /** Paging for the reports: without it a long month is cut off in silence. */
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(500).optional(),
});
export type FuelLogFilterInput = z.infer<typeof fuelLogFilterSchema>;

export const fuelPeriodSchema = z.object({ from: dayStr.optional(), to: dayStr.optional() });
export type FuelPeriodInput = z.infer<typeof fuelPeriodSchema>;

/** A person's decision on a log the fence could not settle, or a correction. */
export const settleFuelLogSchema = z
  .object({
    settlement: z.enum(FUEL_SETTLEMENTS),
    /** Required when filing under a station: which one. */
    station_id: z.string().min(1).nullish(),
  })
  .refine((v) => v.settlement !== 'station_invoice' || !!v.station_id, {
    message: 'station_required',
    path: ['station_id'],
  });
export type SettleFuelLogInput = z.infer<typeof settleFuelLogSchema>;

export const fuelSummarySchema = z.object({
  total_sum: z.number(),
  volume_nm3: z.number(),
  volume_l: z.number(),
  count: z.number().int(),
  drivers: z.number().int(),
  stations: z.number().int(),
  pending_review: z.number().int(),
});
export type FuelSummary = z.infer<typeof fuelSummarySchema>;

/** One contracted station's month, to hold against the invoice it sends. */
export const fuelStationTotalSchema = z.object({
  station: fuelStationSchema,
  count: z.number().int(),
  volume_nm3: z.number(),
  volume_l: z.number(),
  total_sum: z.number(),
});
export type FuelStationTotal = z.infer<typeof fuelStationTotalSchema>;

/** What one driver is owed for fills they paid for themselves. */
export const fuelDriverDebtSchema = z.object({
  driver_id: z.string(),
  driver_name: z.string().nullable(),
  vehicle_plate: z.string().nullable(),
  count: z.number().int(),
  total_sum: z.number(),
  oldest_at: z.string().datetime(),
});
export type FuelDriverDebt = z.infer<typeof fuelDriverDebtSchema>;

export const payFuelDriverSchema = z.object({
  /** Pay everything captured up to and including this day; default today. */
  to: dayStr.optional(),
});
export type PayFuelDriverInput = z.infer<typeof payFuelDriverSchema>;

export const listFuelStationsQuerySchema = z.object({
  fuel_type: fuelTypeSchema.optional(),
});
export type ListFuelStationsQuery = z.infer<typeof listFuelStationsQuerySchema>;
