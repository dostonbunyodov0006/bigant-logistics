-- The papers a seller is asked to forward: both sides of the lorry's tech
-- passport and both sides of the driver's licence. Stored like proof photos.
ALTER TABLE "vehicles" ADD COLUMN "tech_passport_front_url" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "tech_passport_back_url" TEXT;
ALTER TABLE "drivers" ADD COLUMN "license_front_url" TEXT;
ALTER TABLE "drivers" ADD COLUMN "license_back_url" TEXT;
