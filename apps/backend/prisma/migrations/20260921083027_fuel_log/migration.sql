-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('gaz', 'benzin', 'propan');

-- CreateEnum
CREATE TYPE "FuelLogStatus" AS ENUM ('draft', 'confirmed');

-- CreateEnum
CREATE TYPE "FuelLogOutcome" AS ENUM ('matched', 'other_station', 'unlisted', 'mismatch', 'unverified');

-- CreateEnum
CREATE TYPE "FuelSettlement" AS ENUM ('station_invoice', 'driver_reimbursement');

-- CreateTable
CREATE TABLE "fuel_stations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "fuel_types" "FuelType"[],
    "contracted" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "fuel_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_logs" (
    "id" TEXT NOT NULL,
    "status" "FuelLogStatus" NOT NULL DEFAULT 'draft',
    "driver_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "fuel_type" "FuelType" NOT NULL,
    "photo_url" TEXT NOT NULL,
    "selected_station_id" TEXT,
    "resolved_station_id" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "capture_lat" DOUBLE PRECISION,
    "capture_lng" DOUBLE PRECISION,
    "capture_accuracy_m" DOUBLE PRECISION,
    "tracked_lat" DOUBLE PRECISION,
    "tracked_lng" DOUBLE PRECISION,
    "tracked_at" TIMESTAMP(3),
    "distance_m" DOUBLE PRECISION,
    "tracking_gap_m" DOUBLE PRECISION,
    "outcome" "FuelLogOutcome" NOT NULL,
    "flags" TEXT[],
    "extracted_total_sum" DOUBLE PRECISION,
    "extracted_quantity" DOUBLE PRECISION,
    "extracted_unit_price_sum" DOUBLE PRECISION,
    "extracted_readable" BOOLEAN,
    "total_sum" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION,
    "unit_price_sum" DOUBLE PRECISION,
    "confirmed_at" TIMESTAMP(3),
    "settlement" "FuelSettlement",
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "fuel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fuel_stations_active_contracted_idx" ON "fuel_stations"("active", "contracted");

-- CreateIndex
CREATE INDEX "fuel_logs_driver_id_captured_at_idx" ON "fuel_logs"("driver_id", "captured_at");

-- CreateIndex
CREATE INDEX "fuel_logs_status_idx" ON "fuel_logs"("status");

-- CreateIndex
CREATE INDEX "fuel_logs_outcome_idx" ON "fuel_logs"("outcome");

-- CreateIndex
CREATE INDEX "fuel_logs_resolved_station_id_captured_at_idx" ON "fuel_logs"("resolved_station_id", "captured_at");

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_selected_station_id_fkey" FOREIGN KEY ("selected_station_id") REFERENCES "fuel_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_resolved_station_id_fkey" FOREIGN KEY ("resolved_station_id") REFERENCES "fuel_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
