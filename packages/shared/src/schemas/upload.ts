import { z } from 'zod';

/**
 * A photo sent as base64 from a phone. The cap is on the encoded string, so
 * it is roughly 7 MB of image — more than any camera here produces, and far
 * less than an unbounded body. The service re-encodes and watermarks it.
 */
export const uploadPhotoSchema = z.object({
  base64: z.string().min(1).max(10_000_000),
});
export type UploadPhotoInput = z.infer<typeof uploadPhotoSchema>;
