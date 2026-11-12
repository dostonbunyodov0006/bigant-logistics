-- "Polniy": the rest of the day off, asked for and given (owner, 12.11.2026).
ALTER TABLE "work_logs" ADD COLUMN "day_off" BOOLEAN NOT NULL DEFAULT false;
