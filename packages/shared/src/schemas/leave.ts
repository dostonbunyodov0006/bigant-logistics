import { z } from 'zod';
import { LEAVE_TYPES, LEAVE_STATUSES } from '../enums';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const leaveTypeSchema = z.enum(LEAVE_TYPES);
export const leaveStatusSchema = z.enum(LEAVE_STATUSES);

const leaveBody = z.object({
  type: leaveTypeSchema.default('other'),
  start_date: dateStr,
  end_date: dateStr,
  reason: z.string().max(500).nullish(),
});
const datesInOrder = {
  message: 'end_date must be on or after start_date',
  path: ['end_date'],
};

/** The office enters a driver's leave itself — he asks in person, the admin
 *  or dispatcher writes it down, and it is approved as written. */
export const grantLeaveSchema = leaveBody
  .extend({ driver_id: z.string().min(1) })
  .refine((v) => v.end_date >= v.start_date, datesInOrder);
export type GrantLeaveInput = z.infer<typeof grantLeaveSchema>;

/** Admin/manager decision on a pending request. */
export const reviewLeaveRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  review_note: z.string().max(500).nullish(),
});
export type ReviewLeaveRequestInput = z.infer<typeof reviewLeaveRequestSchema>;

export const leaveRequestFilterSchema = z.object({
  status: leaveStatusSchema.optional(),
  driver_id: z.string().optional(),
});
export type LeaveRequestFilterInput = z.infer<typeof leaveRequestFilterSchema>;

export const leaveRequestPublicSchema = z.object({
  id: z.string(),
  driver_id: z.string(),
  driver_name: z.string().nullable(),
  type: leaveTypeSchema,
  start_date: z.string(), // YYYY-MM-DD
  end_date: z.string(), // YYYY-MM-DD
  reason: z.string().nullable(),
  status: leaveStatusSchema,
  reviewed_by_id: z.string().nullable(),
  reviewed_by_name: z.string().nullable(),
  review_note: z.string().nullable(),
  reviewed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type LeaveRequestPublic = z.infer<typeof leaveRequestPublicSchema>;
