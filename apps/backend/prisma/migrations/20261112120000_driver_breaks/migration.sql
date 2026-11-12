-- Every break kept for the office, with its extensions (owner, 12.11.2026).
CREATE TABLE "driver_breaks" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "work_log_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "planned_until" TIMESTAMP(3) NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "extensions" JSONB NOT NULL DEFAULT '[]',
    "ended_at" TIMESTAMP(3),
    "reminded_for" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "driver_breaks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "driver_breaks_driver_id_started_at_idx" ON "driver_breaks"("driver_id", "started_at");
CREATE INDEX "driver_breaks_work_log_id_idx" ON "driver_breaks"("work_log_id");
ALTER TABLE "driver_breaks" ADD CONSTRAINT "driver_breaks_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_breaks" ADD CONSTRAINT "driver_breaks_work_log_id_fkey" FOREIGN KEY ("work_log_id") REFERENCES "work_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
