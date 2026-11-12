import { z } from 'zod';

// Weekday numbers, 0 = Sunday .. 6 = Saturday.
const weekday = z.number().int().min(0).max(6);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

export const workSettingsSchema = z.object({
  expected_hours_per_day: z.number().int().min(1).max(24),
  // Distinct weekdays counted as working days.
  workdays: z.array(weekday),
  shift_start: hhmm,
  shift_end: hhmm,
  // Minutes past the shift start still counted as on time.
  late_grace_minutes: z.number().int().min(0).max(180),
  updated_at: z.string().datetime(),
});
export type WorkSettings = z.infer<typeof workSettingsSchema>;

export const updateWorkSettingsSchema = z.object({
  expected_hours_per_day: z.number().int().min(1).max(24).optional(),
  workdays: z.array(weekday).optional(),
  shift_start: hhmm.optional(),
  shift_end: hhmm.optional(),
  late_grace_minutes: z.number().int().min(0).max(180).optional(),
});
export type UpdateWorkSettingsInput = z.infer<typeof updateWorkSettingsSchema>;
