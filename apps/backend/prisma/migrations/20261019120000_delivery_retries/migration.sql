-- Telegram reports and outbox events retry with a backoff instead of giving
-- up after three tries in a row. A report written before the bot or a group
-- was configured is picked up once it is (it used to wait forever).
ALTER TABLE "telegram_reports"
  ADD COLUMN "next_attempt_at" TIMESTAMP(3),
  ADD COLUMN "last_error" TEXT;
UPDATE "telegram_reports" SET "next_attempt_at" = CURRENT_TIMESTAMP WHERE "status" = 'pending';
CREATE INDEX "telegram_reports_status_next_attempt_at_idx" ON "telegram_reports"("status", "next_attempt_at");

ALTER TABLE "outbox_events"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_attempt_at" TIMESTAMP(3),
  ADD COLUMN "last_error" TEXT;
-- Events that failed once were parked for good; give each one more round.
UPDATE "outbox_events" SET "status" = 'pending', "attempts" = 1, "next_attempt_at" = CURRENT_TIMESTAMP
  WHERE "status" = 'failed' AND "created_at" > CURRENT_TIMESTAMP - INTERVAL '7 days';

-- A service reminder belongs to the cycle it was sent in: after the work is
-- done, the next cycle gets its own "due soon" instead of being silenced by
-- the previous one's. Existing rows are stamped with the cycle they were
-- sent in, read from the vehicle's state at the time.
ALTER TABLE "service_reminders" ADD COLUMN "cycle_km" INTEGER;
UPDATE "service_reminders" r
   SET "cycle_km" = s."last_done_km"
  FROM "vehicle_service_states" s
 WHERE s."vehicle_id" = r."vehicle_id" AND s."reason_id" = r."reason_id";
