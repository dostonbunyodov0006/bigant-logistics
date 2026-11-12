import { z } from 'zod';

/** Live event types pushed over the SSE realtime stream (best-effort, in-memory).
 *  `ping` is a keep-alive the clients ignore. */
export const REALTIME_EVENT_TYPES = [
  'order_status_changed',
  'driver_status_changed',
  'ping',
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

/** One realtime event. Payload is intentionally id/status-only (no order contents),
 *  so clients just re-fetch the scoped query they own on receipt. */
export const realtimeEventSchema = z.object({
  type: z.enum(REALTIME_EVENT_TYPES),
  order_id: z.string().nullable(),
  driver_id: z.string().nullable(),
  status: z.string().nullable(),
  at: z.string().datetime(),
});
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
