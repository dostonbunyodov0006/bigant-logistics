import { z } from 'zod';
import { ATTENDANCE_STATUSES } from '../enums';

const weekday = z.number().int().min(0).max(6);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

/**
 * One weekday of a work schedule. `driver_id` null = the organisation default;
 * a driver-specific row overrides the org row for that weekday.
 */
export const workScheduleDaySchema = z.object({
  weekday,
  is_day_off: z.boolean(),
  start_time: hhmm,
  end_time: hhmm,
});
export type WorkScheduleDay = z.infer<typeof workScheduleDaySchema>;

/** Full week (may be fewer than 7 rows — missing weekdays fall back). */
export const workScheduleSchema = z.object({
  driver_id: z.string().nullable(),
  /** True when the driver has no override and is following the org schedule. */
  inherited: z.boolean(),
  days: z.array(workScheduleDaySchema),
});
export type WorkSchedule = z.infer<typeof workScheduleSchema>;

export const updateWorkScheduleSchema = z.object({
  /** Send an empty array for a driver to clear the override and re-inherit. */
  days: z
    .array(workScheduleDaySchema)
    .max(7)
    // A shift over midnight (20:00–06:00) is not supported: lateness and early
    // leave would come out wrong. HH:MM strings compare in time order.
    .refine((days) => days.every((d) => d.is_day_off || d.end_time > d.start_time), {
      message: 'overnight_schedule_not_supported',
    }),
});
export type UpdateWorkScheduleInput = z.infer<typeof updateWorkScheduleSchema>;

export const attendanceFilterSchema = z.object({
  from: dateStr,
  to: dateStr,
  driver_id: z.string().optional(),
});
export type AttendanceFilterInput = z.infer<typeof attendanceFilterSchema>;

export const attendanceDaySchema = z.object({
  date: dateStr,
  status: attendanceStatusSchema,
  /** Local HH:MM of the day's first clock-in (null when there was none). */
  first_clock_in: z.string().nullable(),
  /** Local HH:MM of the day's last clock-out (null while open / none). */
  last_clock_out: z.string().nullable(),
  late_minutes: z.number().int(),
  early_minutes: z.number().int(),
  worked_minutes: z.number().int(),
  late_reason: z.string().nullable(),
  early_leave_reason: z.string().nullable(),
  /** The day's last shift was ended by the system (forgotten clock-out). */
  auto_closed: z.boolean(),
  /** The end-of-day check found him outside Tashkent on a shift of this day. */
  viloyat: z.boolean(),
});
export type AttendanceDay = z.infer<typeof attendanceDaySchema>;

export const attendanceRowSchema = z.object({
  driver_id: z.string(),
  name: z.string(),
  days: z.array(attendanceDaySchema),
  days_scheduled: z.number().int(),
  days_present: z.number().int(),
  days_absent: z.number().int(),
  days_on_leave: z.number().int(),
  times_late: z.number().int(),
  total_late_minutes: z.number().int(),
  times_left_early: z.number().int(),
  total_early_minutes: z.number().int(),
  /** Late arrivals with no reason recorded (only possible on legacy rows). */
  unexplained_late: z.number().int(),
});
export type AttendanceRow = z.infer<typeof attendanceRowSchema>;

export const attendanceReportSchema = z.object({
  from: dateStr,
  to: dateStr,
  dates: z.array(dateStr),
  rows: z.array(attendanceRowSchema),
});
export type AttendanceReport = z.infer<typeof attendanceReportSchema>;
