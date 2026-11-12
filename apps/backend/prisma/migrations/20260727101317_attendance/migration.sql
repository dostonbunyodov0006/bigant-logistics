-- Attendance: server-computed lateness, a per-weekday/per-driver schedule, and a
-- configurable grace period. Existing work logs default to on-time, so history
-- is unchanged.
ALTER TABLE "work_logs" ADD COLUMN "is_late" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "work_logs" ADD COLUMN "late_minutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "work_logs" ADD COLUMN "is_early_leave" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "work_logs" ADD COLUMN "early_minutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "work_logs" ADD COLUMN "expected_start" TEXT;
ALTER TABLE "work_logs" ADD COLUMN "expected_end" TEXT;

ALTER TABLE "work_settings" ADD COLUMN "late_grace_minutes" INTEGER NOT NULL DEFAULT 10;

CREATE TABLE "work_schedules" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT,
    "weekday" INTEGER NOT NULL,
    "is_day_off" BOOLEAN NOT NULL DEFAULT false,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "work_schedules_driver_id_idx" ON "work_schedules"("driver_id");

-- Partial uniques: a plain composite unique would allow duplicate org rows,
-- because SQL treats NULL driver_id values as distinct from one another.
CREATE UNIQUE INDEX "work_schedules_org_weekday_key"
  ON "work_schedules"("weekday") WHERE "driver_id" IS NULL;
CREATE UNIQUE INDEX "work_schedules_driver_weekday_key"
  ON "work_schedules"("driver_id", "weekday") WHERE "driver_id" IS NOT NULL;

ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
