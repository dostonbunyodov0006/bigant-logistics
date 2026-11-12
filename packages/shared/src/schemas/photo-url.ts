import { z } from 'zod';

/**
 * A photo's address as a client sends it (06.11.2026): http(s) only. zod's
 * `.url()` alone let `javascript:…` through, and the console renders these
 * as links — a click would run whatever the sender put there.
 */
export const photoUrlSchema = z
  .string()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: 'photo_url must be an http(s) address' });
