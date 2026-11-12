-- The year the lorry was built, off the fleet sheet. Plain data about the
-- vehicle, like its capacity — nothing in the app reasons about it yet.
ALTER TABLE "vehicles" ADD COLUMN "model_year" INTEGER;
