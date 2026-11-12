-- AlterEnum: recreate VehicleCategory as katta / orta / kichik.
-- Legacy 'yengil' vehicles are remapped to 'orta' (Gazel) during the column swap.
ALTER TYPE "VehicleCategory" RENAME TO "VehicleCategory_old";
CREATE TYPE "VehicleCategory" AS ENUM ('katta', 'orta', 'kichik');
ALTER TABLE "vehicles"
  ALTER COLUMN "category" TYPE "VehicleCategory"
  USING (
    CASE "category"::text
      WHEN 'yengil' THEN 'orta'
      ELSE "category"::text
    END
  )::"VehicleCategory";
DROP TYPE "VehicleCategory_old";

-- CreateTable: driver-pay tariffs, one row per vehicle class.
CREATE TABLE "vehicle_tariffs" (
    "category" "VehicleCategory" NOT NULL,
    "daily_wage_som" INTEGER NOT NULL DEFAULT 0,
    "pickup_city_som" INTEGER NOT NULL DEFAULT 0,
    "pickup_outside_som" INTEGER NOT NULL DEFAULT 0,
    "delivery_city_som" INTEGER NOT NULL DEFAULT 0,
    "delivery_outside_som" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vehicle_tariffs_pkey" PRIMARY KEY ("category")
);
