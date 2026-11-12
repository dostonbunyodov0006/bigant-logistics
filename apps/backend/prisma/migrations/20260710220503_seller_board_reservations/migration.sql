/*
  Warnings:

  - You are about to drop the column `fill_deadline` on the `orders` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('awaiting', 'filled', 'cancelled', 'expired');

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "fill_deadline";

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "kind" "BookingKind" NOT NULL,
    "full_booking" BOOLEAN NOT NULL DEFAULT false,
    "is_backhaul" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReservationStatus" NOT NULL DEFAULT 'awaiting',
    "fill_deadline" TIMESTAMP(3) NOT NULL,
    "queue_position" INTEGER NOT NULL DEFAULT 0,
    "order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservations_order_id_key" ON "reservations"("order_id");

-- CreateIndex
CREATE INDEX "reservations_vehicle_id_status_idx" ON "reservations"("vehicle_id", "status");

-- CreateIndex
CREATE INDEX "reservations_seller_id_status_idx" ON "reservations"("seller_id", "status");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
