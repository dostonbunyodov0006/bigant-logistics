-- The inbox query is "my newest 100": WHERE recipient_user_id = ? ORDER BY
-- created_at DESC LIMIT 100. With only a recipient index that still had to sort
-- every one of that user's rows; the composite makes it a plain index scan.
DROP INDEX IF EXISTS "notifications_recipient_user_id_idx";
CREATE INDEX "notifications_recipient_user_id_created_at_idx"
  ON "notifications"("recipient_user_id", "created_at" DESC);

-- Retention sweeps unread rows by age across all recipients.
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");
