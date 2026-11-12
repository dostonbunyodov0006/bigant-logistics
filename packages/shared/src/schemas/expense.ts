import { z } from 'zod';
import { pageSchema, paginationSchema } from './pagination';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

// --- Expense types (rasxod_types) ---

export const createExpenseTypeSchema = z.object({
  name: z.string().min(1),
});
export type CreateExpenseTypeInput = z.infer<typeof createExpenseTypeSchema>;

export const updateExpenseTypeSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
});
export type UpdateExpenseTypeInput = z.infer<typeof updateExpenseTypeSchema>;

export const expenseTypePublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  created_at: z.string().datetime(),
});
export type ExpenseTypePublic = z.infer<typeof expenseTypePublicSchema>;

// --- Expenses (rasxod) ---

export const createExpenseSchema = z.object({
  type_id: z.string().min(1),
  amount: z.number().int().positive(),
  spent_at: dateStr,
  note: z.string().max(500).nullish(),
  vehicle_id: z.string().nullish(),
  driver_id: z.string().nullish(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z.object({
  type_id: z.string().min(1).optional(),
  amount: z.number().int().positive().optional(),
  spent_at: dateStr.optional(),
  note: z.string().max(500).nullish(),
  vehicle_id: z.string().nullish(),
  driver_id: z.string().nullish(),
});
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const expensePublicSchema = z.object({
  id: z.string(),
  type_id: z.string(),
  type_name: z.string().nullable(),
  amount: z.number().int(),
  spent_at: z.string(), // YYYY-MM-DD
  note: z.string().nullable(),
  vehicle_id: z.string().nullable(),
  vehicle_label: z.string().nullable(),
  driver_id: z.string().nullable(),
  driver_name: z.string().nullable(),
  created_by_id: z.string().nullable(),
  created_by_name: z.string().nullable(),
  created_at: z.string().datetime(),
  /** Written by itself from a fuel fill or a service visit; corrected there, not here. */
  source: z.enum(['fuel', 'service']).nullable().optional(),
});
export type ExpensePublic = z.infer<typeof expensePublicSchema>;

export const expenseFilterSchema = z.object({
  ...paginationSchema.shape,
  type_id: z.string().optional(),
  vehicle_id: z.string().optional(),
  driver_id: z.string().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});
export type ExpenseFilterInput = z.infer<typeof expenseFilterSchema>;

// --- Report ---

export const expenseSummarySchema = z.object({
  summary: z.object({
    total: z.number().int(),
    count: z.number().int(),
  }),
  by_type: z.array(
    z.object({
      type_id: z.string(),
      type_name: z.string().nullable(),
      total: z.number().int(),
      count: z.number().int(),
    }),
  ), // descending by total
});
export type ExpenseSummary = z.infer<typeof expenseSummarySchema>;

/** A page of expenses plus the total matching count. */
export const expensePageSchema = pageSchema(expensePublicSchema);
export type ExpensePage = z.infer<typeof expensePageSchema>;
