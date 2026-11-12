ALTER TABLE "work_logs" ADD COLUMN "evening_checked_at" TIMESTAMP(3);
-- Shifts closed before this existed are not paid in retrospect.
UPDATE "work_logs" SET "evening_checked_at" = now() WHERE "clock_out_at" IS NOT NULL;
CREATE TABLE "evening_overtimes" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "work_log_id" TEXT NOT NULL,
    "day_end_at" TIMESTAMP(3) NOT NULL,
    "last_photo_at" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "rate_hour_som" INTEGER NOT NULL,
    "amount_som" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evening_overtimes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "evening_overtimes_work_log_id_key" ON "evening_overtimes"("work_log_id");
CREATE INDEX "evening_overtimes_driver_id_last_photo_at_idx" ON "evening_overtimes"("driver_id", "last_photo_at");
ALTER TABLE "evening_overtimes" ADD CONSTRAINT "evening_overtimes_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evening_overtimes" ADD CONSTRAINT "evening_overtimes_work_log_id_fkey" FOREIGN KEY ("work_log_id") REFERENCES "work_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
