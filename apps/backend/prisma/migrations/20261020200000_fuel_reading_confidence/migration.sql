-- How sure the reading of the pump is, so the app can ask for a better photo,
-- ask the driver to correct it, or let it stand.
ALTER TABLE "fuel_logs" ADD COLUMN "extracted_confidence" INTEGER;
