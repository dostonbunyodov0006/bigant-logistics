import { z } from 'zod';
import type { Role } from '../enums';
import { uzPhoneLoginSchema } from '../phone';

export const loginSchema = z.object({
  phone_number: uzPhoneLoginSchema,
  password: z.string().min(6),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const authTokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

/** Payload encoded inside the JWT access token. */
export interface JwtPayload {
  sub: string;
  role: Role;
}
