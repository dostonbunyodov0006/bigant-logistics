-- Both changes below were chosen by measurement, not by theory. Candidate
-- indexes on orders(assigned_driver_id, status) and work_logs(driver_id,
-- clock_in_at) were benchmarked at 50k rows and rejected: Postgres kept
-- preferring the existing single-column indexes and the plans were identical,
-- so they would have cost write throughput for nothing.

-- The outbox is a queue: it only grows, and every row ends up 'processed'. The
-- dispatcher only ever reads the pending ones, so the plain status index spends
-- nearly all its size on a value nothing searches for. Measured at 50k
-- processed / 5 pending: plain index 648 kB and the plan still needs a Sort;
-- partial index 16 kB, already in poll order. This REPLACES the status index.
DROP INDEX IF EXISTS "outbox_events_status_idx";
CREATE INDEX "outbox_events_pending_idx"
  ON "outbox_events"("created_at") WHERE "status" = 'pending';

-- telegram_reports deliberately keeps its plain status index: the admin retry
-- screen queries status = 'failed', and nothing polls it for pending.

-- The org-wide timesheet / work report scans a date range across all drivers,
-- and work_logs had no index on the date at all. Measured over 50k shifts:
-- 12.87 ms (Seq Scan + Sort, 1023 buffers) -> 1.59 ms (Index Scan, 470).
CREATE INDEX "work_logs_clock_in_at_idx" ON "work_logs"("clock_in_at");
