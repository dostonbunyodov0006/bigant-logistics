-- Phase 3: retire the legacy District table now that orders/bonus rules/pickup
-- sources carry official geo (region_code / geo_district_code, backfilled earlier).

ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_district_id_fkey";
ALTER TABLE "bonus_rules" DROP CONSTRAINT IF EXISTS "bonus_rules_district_id_fkey";
ALTER TABLE "order_pickup_sources" DROP CONSTRAINT IF EXISTS "order_pickup_sources_district_id_fkey";
ALTER TABLE "districts" DROP CONSTRAINT IF EXISTS "districts_created_by_fkey";

ALTER TABLE "orders" DROP COLUMN "district_id";
ALTER TABLE "bonus_rules" DROP COLUMN "district_id";
ALTER TABLE "order_pickup_sources" DROP COLUMN "district_id";

DROP TABLE "districts";
