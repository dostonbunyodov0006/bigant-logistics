-- Breaks come off worked time: when the current break began, and the
-- minutes each shift spent on breaks.
ALTER TABLE "drivers" ADD COLUMN "break_started_at" TIMESTAMP(3);

ALTER TABLE "work_logs" ADD COLUMN "break_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "corrected_at" TIMESTAMP(3),
ADD COLUMN "corrected_by_id" TEXT,
ADD COLUMN "corrected_by_name" TEXT,
ADD COLUMN "correction_note" TEXT;

-- At most one open shift per driver. A double tap on clock-in could open two;
-- if that ever happened, keep the newest open and close the others at their
-- own start (zero minutes) so the index can be built.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY driver_id ORDER BY clock_in_at DESC) AS rn
  FROM work_logs
  WHERE clock_out_at IS NULL
)
UPDATE work_logs w
SET clock_out_at = w.clock_in_at, close_source = 'auto_stale', auto_closed = true
FROM ranked r
WHERE w.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX "work_logs_one_open_per_driver" ON "work_logs"("driver_id") WHERE "clock_out_at" IS NULL;
