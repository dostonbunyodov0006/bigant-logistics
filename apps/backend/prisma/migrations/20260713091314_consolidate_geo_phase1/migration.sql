-- Phase 1 of District -> official geo consolidation (non-breaking, additive).
-- Add region_code / geo_district_code to orders, bonus_rules, order_pickup_sources.
-- Old district_id columns + the districts panel stay untouched.

ALTER TABLE "orders" ADD COLUMN "region_code" TEXT;
ALTER TABLE "orders" ADD COLUMN "geo_district_code" TEXT;
ALTER TABLE "bonus_rules" ADD COLUMN "region_code" TEXT;
ALTER TABLE "bonus_rules" ADD COLUMN "geo_district_code" TEXT;
ALTER TABLE "order_pickup_sources" ADD COLUMN "region_code" TEXT;
ALTER TABLE "order_pickup_sources" ADD COLUMN "geo_district_code" TEXT;

ALTER TABLE "orders" ADD CONSTRAINT "orders_region_code_fkey"
  FOREIGN KEY ("region_code") REFERENCES "regions"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_geo_district_code_fkey"
  FOREIGN KEY ("geo_district_code") REFERENCES "geo_districts"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bonus_rules" ADD CONSTRAINT "bonus_rules_region_code_fkey"
  FOREIGN KEY ("region_code") REFERENCES "regions"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bonus_rules" ADD CONSTRAINT "bonus_rules_geo_district_code_fkey"
  FOREIGN KEY ("geo_district_code") REFERENCES "geo_districts"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_pickup_sources" ADD CONSTRAINT "order_pickup_sources_region_code_fkey"
  FOREIGN KEY ("region_code") REFERENCES "regions"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_pickup_sources" ADD CONSTRAINT "order_pickup_sources_geo_district_code_fkey"
  FOREIGN KEY ("geo_district_code") REFERENCES "geo_districts"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the legacy districts table by name (prefix match avoids apostrophe variance).
-- 6 Tashkent tumans map to region 1726; 'Fargona' maps to Farg'ona region (1730), no district.
CREATE TEMP TABLE _geo_map (pattern TEXT, region_code TEXT, geo_district_code TEXT) ON COMMIT DROP;
INSERT INTO _geo_map VALUES
  ('Chilonzor%',    '1726', '1726294'),
  ('Yunusobod%',    '1726', '1726266'),
  ('Mirzo Ulug%',   '1726', '1726269'),
  ('Yakkasaroy%',   '1726', '1726287'),
  ('Sergeli%',      '1726', '1726283'),
  ('Uchtepa%',      '1726', '1726262'),
  ('Fargona%',      '1730', NULL);

UPDATE "orders" o
SET "region_code" = m.region_code, "geo_district_code" = m.geo_district_code
FROM "districts" d, "_geo_map" m
WHERE o."district_id" = d."id" AND d."name" LIKE m."pattern";

UPDATE "bonus_rules" b
SET "region_code" = m.region_code, "geo_district_code" = m.geo_district_code
FROM "districts" d, "_geo_map" m
WHERE b."district_id" = d."id" AND d."name" LIKE m."pattern";

UPDATE "order_pickup_sources" p
SET "region_code" = m.region_code, "geo_district_code" = m.geo_district_code
FROM "districts" d, "_geo_map" m
WHERE p."district_id" = d."id" AND d."name" LIKE m."pattern";
