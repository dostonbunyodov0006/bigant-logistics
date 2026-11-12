-- The Monday odometer photo is read by the vision model and compared with the typed km.
ALTER TABLE "km_records" ADD COLUMN "ai_km" INTEGER;
ALTER TABLE "km_records" ADD COLUMN "check_status" TEXT;
