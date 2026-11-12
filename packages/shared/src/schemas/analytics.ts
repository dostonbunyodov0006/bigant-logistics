import { z } from 'zod';
import { paginationSchema, pageSchema } from './pagination';
import { VOZVRAT_CONDITIONS, VOZVRAT_CULPRITS, VOZVRAT_REASON_CODES } from './vozvrat';
import { orderStatusSchema } from './order';

/**
 * What the office sees about the drivers' work: every vozvrat with its
 * products and who is to blame, a month of each driver side by side, and
 * where a truck went on a given day.
 */

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM');

// --- Vozvratlar ---

export const vozvratListFilterSchema = z.object({
  ...paginationSchema.shape,
  from: ymd.optional(),
  to: ymd.optional(),
  driver_id: z.string().min(1).optional(),
  culprit: z.enum(VOZVRAT_CULPRITS).optional(),
});
export type VozvratListFilterInput = z.infer<typeof vozvratListFilterSchema>;

export const vozvratListItemSchema = z.object({
  id: z.string(),
  product_id: z.string().nullable(),
  name: z.string(),
  unit: z.string().nullable(),
  quantity: z.number(),
  condition: z.enum(VOZVRAT_CONDITIONS),
  reason: z.enum(VOZVRAT_REASON_CODES),
  other_reason: z.string().nullable(),
  culprit: z.enum(VOZVRAT_CULPRITS).nullable(),
  photo_url: z.string(),
});
export type VozvratListItem = z.infer<typeof vozvratListItemSchema>;

// What the storekeeper found, item by item (/ombor, owner 05.11.2026).
export const vozvratWarehouseItemSchema = z.object({
  name: z.string(),
  quantity: z.number(),
  condition: z.enum(VOZVRAT_CONDITIONS),
  reason: z.string(),
  other_reason: z.string().nullable(),
  culprit: z.enum(VOZVRAT_CULPRITS).nullable(),
  photo_url: z.string().nullable(),
  damage_photo_url: z.string().nullable(),
});
export const vozvratWarehouseSchema = z.object({
  /** The row's id: the office marks it taken in by it (owner, 07.11.2026). */
  id: z.string(),
  /** Taken in at our warehouse (omborchi) or our shop (dokonchi) (owner, 07.11.2026). */
  destination: z.enum(['warehouse', 'store']),
  /** null while the goods are on their way to the warehouse. */
  accepted_at: z.string().nullable(),
  accepted_by: z.string().nullable(),
  comment: z.string().nullable(),
  overall_photo_url: z.string().nullable(),
  items: z.array(vozvratWarehouseItemSchema),
});

// 'held' = written up but not yet checked by the seller, so it has not been
// offered to the accounting app at all.
export const vozvratReportStatusSchema = z.enum(['held', 'pending', 'sent', 'rejected']);

export const vozvratListRowSchema = z.object({
  order_id: z.string(),
  order_number: z.number().int(),
  order_status: orderStatusSchema,
  returned_at: z.string(),
  driver_id: z.string().nullable(),
  driver_name: z.string().nullable(),
  client_name: z.string(),
  seller_name: z.string(),
  destination: z.string().nullable(),
  comment: z.string().nullable(),
  /** Handed to the warehouse page; null when no report was filed. */
  report_status: vozvratReportStatusSchema.nullable(),
  items: z.array(vozvratListItemSchema),
  /**
   * The storekeeper's / shop's count (owner, 05.11.2026), one per place it is
   * taken in at (owner, 07.11.2026: an order with stops to both has two);
   * empty until it reaches them, and for a return to a supplier.
   */
  warehouses: z.array(vozvratWarehouseSchema),
});
export type VozvratListRow = z.infer<typeof vozvratListRowSchema>;

export const vozvratCulpritCountSchema = z.object({
  culprit: z.enum(VOZVRAT_CULPRITS).nullable(),
  items: z.number().int(),
});

export const vozvratDriverCountSchema = z.object({
  driver_id: z.string().nullable(),
  driver_name: z.string().nullable(),
  returns: z.number().int(),
  items: z.number().int(),
});

export const vozvratListSummarySchema = z.object({
  returns: z.number().int(),
  items: z.number().int(),
  by_culprit: z.array(vozvratCulpritCountSchema),
  by_driver: z.array(vozvratDriverCountSchema),
});

export const vozvratListPageSchema = pageSchema(vozvratListRowSchema).extend({
  summary: vozvratListSummarySchema,
});
export type VozvratListPage = z.infer<typeof vozvratListPageSchema>;

// --- Haydovchi tahlili ---

export const driverAnalyticsFilterSchema = z.object({ month: yearMonth });
export type DriverAnalyticsFilterInput = z.infer<typeof driverAnalyticsFilterSchema>;

export const driverAnalyticsRowSchema = z.object({
  driver_id: z.string(),
  driver_name: z.string(),
  /** False for a driver who has left: he is listed only for the months he worked. */
  driver_active: z.boolean(),
  vehicle_plate: z.string().nullable(),
  delivered: z.number().int(),
  returns: z.number().int(),
  return_items: z.number().int(),
  shifts: z.number().int(),
  worked_minutes: z.number().int(),
  late: z.number().int(),
  late_minutes: z.number().int(),
  early_leave: z.number().int(),
  fines: z.number().int(),
  fines_amount: z.number().int(),
});
export type DriverAnalyticsRow = z.infer<typeof driverAnalyticsRowSchema>;

export const driverAnalyticsSchema = z.object({
  month: yearMonth,
  rows: z.array(driverAnalyticsRowSchema),
  totals: driverAnalyticsRowSchema.omit({
    driver_id: true,
    driver_name: true,
    driver_active: true,
    vehicle_plate: true,
  }),
});
export type DriverAnalytics = z.infer<typeof driverAnalyticsSchema>;

// --- Yo'l tarixi ---

export const driverTrackFilterSchema = z.object({ date: ymd });
export type DriverTrackFilterInput = z.infer<typeof driverTrackFilterSchema>;

export const trackPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  at: z.string(),
});
export type TrackPoint = z.infer<typeof trackPointSchema>;

export const driverTrackSchema = z.object({
  driver_id: z.string(),
  driver_name: z.string(),
  date: ymd,
  points: z.array(trackPointSchema),
  distance_km: z.number(),
  first_at: z.string().nullable(),
  last_at: z.string().nullable(),
  /** Stood 10 minutes or more in one place that day. */
  stops: z.array(z.object({ at: z.string(), until: z.string(), minutes: z.number(), lat: z.number(), lng: z.number() })),
});
export type DriverTrack = z.infer<typeof driverTrackSchema>;
