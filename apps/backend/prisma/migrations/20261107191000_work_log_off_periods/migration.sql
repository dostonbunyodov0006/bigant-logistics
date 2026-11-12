-- The time off between a shift closed and reopened the same day, kept so it is
-- not paid as evening extra (owner, 07.11.2026).
ALTER TABLE "work_logs" ADD COLUMN "off_periods" JSONB;
