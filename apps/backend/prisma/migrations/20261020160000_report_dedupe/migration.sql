-- One Telegram report per thing reported. The 19-Oct retry made the outbox
-- at-least-once, and the report creators were not idempotent: an event whose
-- handler threw part-way re-posted the same proof photo to the group.
ALTER TABLE "telegram_reports" ADD COLUMN "dedupe_key" TEXT;
CREATE UNIQUE INDEX "telegram_reports_dedupe_key_key" ON "telegram_reports"("dedupe_key");

-- Read when a client address is removed and its orders are detached from it.
CREATE INDEX "orders_client_address_id_idx" ON "orders"("client_address_id");
