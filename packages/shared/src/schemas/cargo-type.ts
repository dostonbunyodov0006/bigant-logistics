import { z } from 'zod';
import { titleCase } from '../text';

export const cargoTypePublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});
export type CargoTypePublic = z.infer<typeof cargoTypePublicSchema>;

export const createCargoTypeSchema = z.object({
  name: z.string().min(1).transform(titleCase),
});
export type CreateCargoTypeInput = z.infer<typeof createCargoTypeSchema>;

export const updateCargoTypeSchema = z.object({
  name: z.string().min(1).transform(titleCase).optional(),
  active: z.boolean().optional(),
});
export type UpdateCargoTypeInput = z.infer<typeof updateCargoTypeSchema>;
