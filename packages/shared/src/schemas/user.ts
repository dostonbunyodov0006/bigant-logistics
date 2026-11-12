import { z } from 'zod';
import { titleCase } from '../text';
import { pageSchema, paginationSchema } from './pagination';
import { DEVICE_PLATFORMS, MANAGEABLE_ROLES, ROLES, USER_STATUSES } from '../enums';
import { uzPhoneSchema } from '../phone';

export const roleSchema = z.enum(ROLES);
export const manageableRoleSchema = z.enum(MANAGEABLE_ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);

/** Shape returned by the API — never includes the password hash. */
/** A Telegram user id: digits only. An empty string clears it. */
export const telegramIdSchema = z
  .string()
  .trim()
  .regex(/^\d{0,15}$/, 'telegram_id_digits_only')
  .transform((v) => v || null);

export const userPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone_number: z.string(),
  role: roleSchema,
  status: userStatusSchema,
  // Sellers: their Telegram user id, sent to accounting with each vozvrat.
  telegram_id: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type UserPublic = z.infer<typeof userPublicSchema>;

/** Create a seller or manager account (admins are seeded, not created via API). */
export const createUserSchema = z.object({
  name: z.string().min(1).transform(titleCase),
  phone_number: uzPhoneSchema,
  password: z.string().min(6),
  role: manageableRoleSchema,
  telegram_id: telegramIdSchema.nullish(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Update a managed user. All fields optional; password only when changing it. */
export const updateUserSchema = z.object({
  name: z.string().min(1).transform(titleCase).optional(),
  phone_number: uzPhoneSchema.optional(),
  password: z.string().min(6).optional(),
  status: userStatusSchema.optional(),
  telegram_id: telegramIdSchema.nullish(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const registerPushTokenSchema = z.object({
  fcm_token: z.string().min(1),
  platform: z.enum(DEVICE_PLATFORMS),
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;

/** Search + pagination for the user list. */
export const userFilterSchema = z.object({
  ...paginationSchema.shape,
  search: z.string().optional(),
  /** "inactive" lists the ones let go (Ishdan bo'shatilganlar); default is everyone. */
  status: z.enum(['active', 'inactive']).optional(),
});
export type UserFilterInput = z.infer<typeof userFilterSchema>;

/** A page of users plus the total matching count. */
export const userPageSchema = pageSchema(userPublicSchema);
export type UserPage = z.infer<typeof userPageSchema>;
