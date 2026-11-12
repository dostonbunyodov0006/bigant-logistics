-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('car', 'van', 'truck', 'motorcycle', 'other');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('active', 'inactive', 'maintenance');

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "plate_number" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL DEFAULT 'other',
    "capacity_kg" INTEGER,
    "status" "VehicleStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_number_key" ON "vehicles"("plate_number");
