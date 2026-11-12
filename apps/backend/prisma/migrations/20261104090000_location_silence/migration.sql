-- A driver on shift is told once per silence that his position stopped coming.
ALTER TABLE "work_logs" ADD COLUMN "silence_warned_at" TIMESTAMP(3);
