import { z } from 'zod';
import { ASSIGNMENT_STATUSES } from '../enums';

export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);

export const createAssignmentSchema = z.object({
  order_id: z.string().min(1),
  driver_id: z.string().min(1),
  // Binding: the order is the driver's from this moment, with no accept step —
  // how the seller board books. Without it the driver is asked first.
  binding: z.boolean().optional(),
});
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export const conflictQuerySchema = z.object({
  driver_id: z.string().min(1),
  delivery_datetime: z.string().datetime(),
});
export type ConflictQueryInput = z.infer<typeof conflictQuerySchema>;

export const assignmentPublicSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  driver_id: z.string(),
  delivery_datetime: z.string().datetime(),
  assignment_status: assignmentStatusSchema,
  start_time: z.string().datetime().nullable(),
  estimated_finish_time: z.string().datetime().nullable(),
  created_by: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type AssignmentPublic = z.infer<typeof assignmentPublicSchema>;

/** A non-blocking prebooking conflict warning (BR-007). */
export const conflictWarningSchema = z.object({
  assignment_id: z.string(),
  order_id: z.string(),
  order_number: z.number(),
  client_name: z.string(),
  delivery_datetime: z.string().datetime(),
  message: z.string(),
});
export type ConflictWarning = z.infer<typeof conflictWarningSchema>;

export const assignDriverResultSchema = z.object({
  assignment: assignmentPublicSchema,
  warnings: z.array(conflictWarningSchema),
});
export type AssignDriverResult = z.infer<typeof assignDriverResultSchema>;
