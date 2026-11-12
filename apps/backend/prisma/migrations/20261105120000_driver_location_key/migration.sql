-- The driver phone's native location service authenticates with this key.
ALTER TABLE "drivers" ADD COLUMN "location_key_hash" TEXT;
CREATE UNIQUE INDEX "drivers_location_key_hash_key" ON "drivers"("location_key_hash");
