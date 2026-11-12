import { z } from 'zod';
import { BONUS_APPLIES_TO } from '../enums';

export const bonusAppliesToSchema = z.enum(BONUS_APPLIES_TO);

export const createBonusRuleSchema = z.object({
  name: z.string().min(1),
  amount: z.number().int().positive(),
  applies_to: bonusAppliesToSchema.default('all'),
  // Scope by official geo: region (viloyat), optionally narrowed to a Tashkent district.
  // Both omitted / null = applies everywhere.
  region_code: z.string().nullish(),
  district_code: z.string().nullish(),
});
export type CreateBonusRuleInput = z.infer<typeof createBonusRuleSchema>;

export const updateBonusRuleSchema = z.object({
  name: z.string().min(1).optional(),
  amount: z.number().int().positive().optional(),
  applies_to: bonusAppliesToSchema.optional(),
  region_code: z.string().nullish(),
  district_code: z.string().nullish(),
  active: z.boolean().optional(),
});
export type UpdateBonusRuleInput = z.infer<typeof updateBonusRuleSchema>;

export const bonusRulePublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  amount: z.number().int(),
  applies_to: bonusAppliesToSchema,
  region_code: z.string().nullable(),
  region_name: z.string().nullable(),
  district_code: z.string().nullable(),
  district_name: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type BonusRulePublic = z.infer<typeof bonusRulePublicSchema>;

export const bonusLogPublicSchema = z.object({
  id: z.string(),
  driver_id: z.string(),
  driver_name: z.string().nullable(),
  order_id: z.string(),
  order_number: z.number().nullable(),
  client_name: z.string().nullable(),
  rule_id: z.string().nullable(),
  rule_name: z.string(),
  amount: z.number().int(),
  accrued_at: z.string().datetime(),
});
export type BonusLogPublic = z.infer<typeof bonusLogPublicSchema>;

/** Query filters for the bonus-logs report. */
export const bonusLogFilterSchema = z.object({
  driver_id: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional(),
});
export type BonusLogFilterInput = z.infer<typeof bonusLogFilterSchema>;
