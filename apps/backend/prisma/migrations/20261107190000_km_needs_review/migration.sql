-- A driver's odometer reading far above the lorry's is kept for the office to
-- check instead of refused (owner, 07.11.2026).
ALTER TABLE "km_records" ADD COLUMN "needs_review" BOOLEAN NOT NULL DEFAULT false;
