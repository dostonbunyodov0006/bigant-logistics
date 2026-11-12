import { z } from 'zod';

/**
 * A vehicle or driver document that is expired or expiring soon (≤30 days).
 * Powers the dashboard warnings panel and the expiry-reminder notifications.
 */
export const expiringDocumentSchema = z.object({
  id: z.string(),
  // Which entity the document belongs to — drives the detail-page link on the web.
  owner_type: z.enum(['vehicle', 'driver']),
  owner_id: z.string(),
  // Vehicle plate or driver name — a human-readable label for the panel.
  owner_label: z.string(),
  // Raw document `type` enum value (e.g. "texosmotr", "license"); translated client-side.
  doc_type: z.string(),
  doc_number: z.string().nullable(),
  expires_at: z.string().datetime(),
  // Whole days until expiry; negative once expired.
  days_until_expiry: z.number().int(),
  status: z.enum(['expired', 'soon']),
});
export type ExpiringDocument = z.infer<typeof expiringDocumentSchema>;

/** Aggregated compliance snapshot returned by `GET /compliance/expiring`. */
export const documentExpiryStatsSchema = z.object({
  expired_count: z.number().int(),
  soon_count: z.number().int(),
  total: z.number().int(),
  // Most urgent first (expired before expiring-soon, then soonest expiry).
  documents: z.array(expiringDocumentSchema),
});
export type DocumentExpiryStats = z.infer<typeof documentExpiryStatsSchema>;
