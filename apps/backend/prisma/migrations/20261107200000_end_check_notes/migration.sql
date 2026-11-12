-- Each "+30 min" answer to the end-of-day check with what the driver said he
-- was still doing, [{ "at": ISO, "note": "..." }], shown to the office
-- (owner, 07.11.2026).
ALTER TABLE "work_logs" ADD COLUMN "end_check_notes" JSONB;
