-- Pickup places carry their own official geo, so the city/outside pickup bonus
-- no longer depends on the seller re-picking a district on every order.
ALTER TABLE "pickup_places" ADD COLUMN "region_code" TEXT;
ALTER TABLE "pickup_places" ADD COLUMN "geo_district_code" TEXT;

-- Backfill the existing places from their addresses (all Tashkent city) so the
-- NOT NULL constraint below can be applied. Order history is untouched.
UPDATE "pickup_places" SET "region_code" = '1726', "geo_district_code" = CASE
  WHEN "address" ILIKE '%chilonzor%'                        THEN '1726294'
  WHEN "address" ILIKE '%yunusobod%'                        THEN '1726266'
  WHEN "address" ILIKE '%sergeli%' OR "name" ILIKE '%sergi%' THEN '1726283'
  WHEN "address" ILIKE '%chorsu%'  OR "address" ILIKE '%eski shahar%' THEN '1726277'
  ELSE NULL
END
WHERE "region_code" IS NULL;

-- Any remaining rows (none expected) default to Tashkent city without a district.
UPDATE "pickup_places" SET "region_code" = '1726' WHERE "region_code" IS NULL;

ALTER TABLE "pickup_places" ALTER COLUMN "region_code" SET NOT NULL;

CREATE INDEX "pickup_places_region_code_idx" ON "pickup_places"("region_code");

ALTER TABLE "pickup_places" ADD CONSTRAINT "pickup_places_region_code_fkey"
  FOREIGN KEY ("region_code") REFERENCES "regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_places" ADD CONSTRAINT "pickup_places_geo_district_code_fkey"
  FOREIGN KEY ("geo_district_code") REFERENCES "geo_districts"("code") ON DELETE SET NULL ON UPDATE CASCADE;
