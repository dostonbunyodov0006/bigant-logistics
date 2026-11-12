import { z } from 'zod';
import { TELEGRAM_REPORT_STATUSES } from '../enums';

export const telegramReportPublicSchema = z.object({
  id: z.string(),
  order_id: z.string().nullable(),
  fuel_log_id: z.string().nullable(),
  service_visit_id: z.string().nullable(),
  target: z.string(),
  photo_url: z.string(),
  message_text: z.string(),
  status: z.enum(TELEGRAM_REPORT_STATUSES),
  retry_count: z.number(),
  next_attempt_at: z.string().datetime().nullable(),
  last_error: z.string().nullable(),
  sent_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type TelegramReportPublic = z.infer<typeof telegramReportPublicSchema>;
