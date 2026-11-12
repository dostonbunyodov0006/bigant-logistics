-- CreateEnum
CREATE TYPE "BookingKind" AS ENUM ('zanyat', 'bron');

-- CreateEnum
CREATE TYPE "VehicleCategory" AS ENUM ('katta', 'yengil');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'awaiting_details';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "booking_kind" "BookingKind",
ADD COLUMN     "cargo_type_id" TEXT,
ADD COLUMN     "fill_deadline" TIMESTAMP(3),
ADD COLUMN     "full_booking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "height_cm" INTEGER,
ADD COLUMN     "is_backhaul" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "length_cm" INTEGER,
ADD COLUMN     "over_limit_attested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "poputi_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "queue_position" INTEGER,
ADD COLUMN     "waybill_source" TEXT,
ADD COLUMN     "weight_kg" INTEGER,
ADD COLUMN     "width_cm" INTEGER;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "category" "VehicleCategory",
ADD COLUMN     "height_cm" INTEGER,
ADD COLUMN     "length_cm" INTEGER,
ADD COLUMN     "width_cm" INTEGER;

-- CreateTable
CREATE TABLE "order_pickup_sources" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "pickup_place_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_pickup_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargo_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cargo_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_pickup_sources_order_id_idx" ON "order_pickup_sources"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "cargo_types_name_key" ON "cargo_types"("name");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cargo_type_id_fkey" FOREIGN KEY ("cargo_type_id") REFERENCES "cargo_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_pickup_sources" ADD CONSTRAINT "order_pickup_sources_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_pickup_sources" ADD CONSTRAINT "order_pickup_sources_pickup_place_id_fkey" FOREIGN KEY ("pickup_place_id") REFERENCES "pickup_places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_pickup_sources" ADD CONSTRAINT "order_pickup_sources_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
