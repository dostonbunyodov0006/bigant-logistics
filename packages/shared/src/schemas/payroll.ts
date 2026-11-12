import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Bounded period (+ optional single driver) for the payroll summary. */
export const payrollFilterSchema = z.object({
  from: dateStr,
  to: dateStr,
  driver_id: z.string().optional(),
});
export type PayrollFilterInput = z.infer<typeof payrollFilterSchema>;

/**
 * Ish haqi, the drivers' bonuses (owner, 29.10.2026): for each pickup, each
 * delivery, and each minute worked before 09:00 or after 18:00. Counted from
 * the 16th of one month to the 15th of the next.
 */
export const payrollDriverRowSchema = z.object({
  driver_id: z.string(),
  driver_name: z.string().nullable(),
  vehicle: z.string().nullable(),
  /** The lorry's plate and its make, apart, for the list's own columns. */
  plate_number: z.string().nullable().optional(),
  vehicle_model: z.string().nullable().optional(),
  pickup_total: z.number().int(),
  pickup_count: z.number().int(),
  delivery_total: z.number().int(),
  delivery_count: z.number().int(),
  overtime_total: z.number().int(),
  overtime_minutes: z.number().int(),
  total: z.number().int(),
});
export type PayrollDriverRow = z.infer<typeof payrollDriverRowSchema>;

export const payrollDriversSchema = z.object({ rows: z.array(payrollDriverRowSchema) });
export type PayrollDrivers = z.infer<typeof payrollDriversSchema>;

/** One bonus: a pickup, a delivery, or one morning's or evening's extra minutes. */
export const payrollEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['pickup_city', 'pickup_outside', 'delivery_city', 'delivery_outside', 'early', 'evening']),
  at: z.string().datetime(),
  /** The pickup place or the client. */
  place: z.string().nullable(),
  /** Extra hours only: from when to when, and how many minutes. */
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  minutes: z.number().int().nullable(),
  /** What the tariff sets today: per pickup/delivery, or per hour. */
  tariff_som: z.number().int().nullable(),
  /** What was paid for it. */
  amount_som: z.number().int(),
});
export type PayrollEntry = z.infer<typeof payrollEntrySchema>;

export const payrollDriverDetailSchema = z.object({
  driver_id: z.string(),
  driver_name: z.string().nullable(),
  vehicle: z.string().nullable(),
  pickups: z.array(payrollEntrySchema),
  deliveries: z.array(payrollEntrySchema),
  overtime: z.array(payrollEntrySchema),
});
export type PayrollDriverDetail = z.infer<typeof payrollDriverDetailSchema>;
