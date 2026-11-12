-- Record pickup/delivery tariff pay when its action happens instead of deriving
-- all pay from the order's final status. event_key makes every action idempotent.
CREATE TYPE "TariffEarningType" AS ENUM (
  'pickup_city',
  'pickup_outside',
  'delivery_city',
  'delivery_outside'
);

CREATE TABLE "driver_tariff_earnings" (
  "id" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "type" "TariffEarningType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "driver_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "pickup_source_id" TEXT,
  "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "driver_tariff_earnings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "driver_tariff_earnings_event_key_key"
  ON "driver_tariff_earnings"("event_key");
CREATE UNIQUE INDEX "driver_tariff_earnings_pickup_source_id_key"
  ON "driver_tariff_earnings"("pickup_source_id");
CREATE INDEX "driver_tariff_earnings_driver_id_earned_at_idx"
  ON "driver_tariff_earnings"("driver_id", "earned_at");
CREATE INDEX "driver_tariff_earnings_order_id_idx"
  ON "driver_tariff_earnings"("order_id");

ALTER TABLE "driver_tariff_earnings"
  ADD CONSTRAINT "driver_tariff_earnings_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_tariff_earnings"
  ADD CONSTRAINT "driver_tariff_earnings_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_tariff_earnings"
  ADD CONSTRAINT "driver_tariff_earnings_pickup_source_id_fkey"
  FOREIGN KEY ("pickup_source_id") REFERENCES "order_pickup_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve existing reports. Historical pickup timestamps were not stored, so
-- completed orders are backfilled at their delivered/returned completion time.
INSERT INTO "driver_tariff_earnings" (
  "id", "event_key", "type", "amount", "driver_id", "order_id",
  "pickup_source_id", "earned_at"
)
SELECT
  gen_random_uuid()::text,
  'pickup:' || ps."id",
  CASE WHEN COALESCE(pr."is_city", pdr."is_city", false)
    THEN 'pickup_city'::"TariffEarningType"
    ELSE 'pickup_outside'::"TariffEarningType"
  END,
  CASE WHEN COALESCE(pr."is_city", pdr."is_city", false)
    THEN COALESCE(vt."pickup_city_som", 0)
    ELSE COALESCE(vt."pickup_outside_som", 0)
  END,
  o."assigned_driver_id",
  o."id",
  ps."id",
  COALESCE(o."delivered_at", o."returned_at", o."updated_at")
FROM "orders" o
JOIN "order_pickup_sources" ps ON ps."order_id" = o."id"
JOIN "drivers" d ON d."id" = o."assigned_driver_id"
LEFT JOIN "vehicles" v ON v."id" = d."vehicle_id"
LEFT JOIN "vehicle_tariffs" vt ON vt."category" = v."category"
LEFT JOIN "regions" pr ON pr."code" = ps."region_code"
LEFT JOIN "geo_districts" pd ON pd."code" = ps."geo_district_code"
LEFT JOIN "regions" pdr ON pdr."code" = pd."region_code"
WHERE o."status" IN ('delivered', 'returned');

INSERT INTO "driver_tariff_earnings" (
  "id", "event_key", "type", "amount", "driver_id", "order_id", "earned_at"
)
SELECT
  gen_random_uuid()::text,
  'delivery:' || o."id",
  CASE WHEN COALESCE(dr."is_city", false)
    THEN 'delivery_city'::"TariffEarningType"
    ELSE 'delivery_outside'::"TariffEarningType"
  END,
  CASE WHEN COALESCE(dr."is_city", false)
    THEN COALESCE(vt."delivery_city_som", 0)
    ELSE COALESCE(vt."delivery_outside_som", 0)
  END,
  o."assigned_driver_id",
  o."id",
  COALESCE(o."delivered_at", o."returned_at", o."updated_at")
FROM "orders" o
JOIN "drivers" d ON d."id" = o."assigned_driver_id"
LEFT JOIN "vehicles" v ON v."id" = d."vehicle_id"
LEFT JOIN "vehicle_tariffs" vt ON vt."category" = v."category"
LEFT JOIN "regions" dr ON dr."code" = o."region_code"
WHERE o."status" IN ('delivered', 'returned');
