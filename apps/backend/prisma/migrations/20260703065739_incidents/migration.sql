-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('accident', 'breakdown', 'damage', 'other');

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "order_id" TEXT,
    "type" "IncidentType" NOT NULL DEFAULT 'other',
    "description" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "reported_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_vehicle_id_idx" ON "incidents"("vehicle_id");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
