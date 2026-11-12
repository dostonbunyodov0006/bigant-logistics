import { z } from 'zod';
import { NOTIFICATION_CHANNELS } from '../enums';

export const notificationPublicSchema = z.object({
  id: z.string(),
  recipient_user_id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  related_order_id: z.string().nullable(),
  // The client the related order is for — what every screen names instead of a number.
  client_name: z.string().nullable(),
  channel: z.enum(NOTIFICATION_CHANNELS),
  read_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type NotificationPublic = z.infer<typeof notificationPublicSchema>;
