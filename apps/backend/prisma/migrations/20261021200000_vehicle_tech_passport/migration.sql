-- The registration certificate number off the tech passport ("AAG 1234567").
-- Kept on the vehicle rather than in vehicle_documents: it does not expire, and
-- every lorry has exactly one.
ALTER TABLE "vehicles" ADD COLUMN "tech_passport" TEXT;
