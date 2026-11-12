-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "current_km" INTEGER;

-- CreateTable
CREATE TABLE "km_records" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "km" INTEGER NOT NULL,
    "recorded_by" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "km_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "km_records_vehicle_id_idx" ON "km_records"("vehicle_id");

-- AddForeignKey
ALTER TABLE "km_records" ADD CONSTRAINT "km_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
