import { z } from 'zod';
import { pageSchema, paginationSchema } from './pagination';

export const createFineSchema = z.object({
  driver_id: z.string().min(1),
  amount: z.number().int().positive(),
  reason: z.string().min(1),
  // Optionally tie the fine to a specific order.
  order_id: z.string().nullish(),
});
export type CreateFineInput = z.infer<typeof createFineSchema>;

export const updateFineSchema = z.object({
  amount: z.number().int().positive().optional(),
  reason: z.string().min(1).optional(),
  order_id: z.string().nullish(),
});
export type UpdateFineInput = z.infer<typeof updateFineSchema>;

export const finePublicSchema = z.object({
  id: z.string(),
  driver_id: z.string(),
  driver_name: z.string().nullable(),
  order_id: z.string().nullable(),
  order_number: z.number().nullable(),
  client_name: z.string().nullable(),
  reason: z.string(),
  amount: z.number().int(),
  issued_by_id: z.string(),
  issued_by_name: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type FinePublic = z.infer<typeof finePublicSchema>;

/** Query filters for the fines list / report. */
export const fineFilterSchema = z.object({
  ...paginationSchema.shape,
  driver_id: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional(),
});
export type FineFilterInput = z.infer<typeof fineFilterSchema>;

/** A page of fines, the total matching count, and the summed amount across the
 *  whole match — not just this page, so the money figure stays truthful when
 *  the table is paginated. */
export const finePageSchema = pageSchema(finePublicSchema).extend({
  total_amount: z.number().int(),
});
export type FinePage = z.infer<typeof finePageSchema>;
