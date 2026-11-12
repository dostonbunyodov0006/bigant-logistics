-- Driver profile fields (Ma'lumotlarim) + Order.deliveredAt for earnings-by-period.
ALTER TABLE "drivers" ADD COLUMN "birth_date" TIMESTAMP(3);
ALTER TABLE "drivers" ADD COLUMN "license_category" TEXT;
ALTER TABLE "drivers" ADD COLUMN "home_district_code" TEXT;
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_home_district_code_fkey"
  FOREIGN KEY ("home_district_code") REFERENCES "geo_districts"("code") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders" ADD COLUMN "delivered_at" TIMESTAMP(3);
-- Backfill: existing delivered orders get their last-update time as the delivery time.
UPDATE "orders" SET "delivered_at" = "updated_at" WHERE "status" = 'delivered';
