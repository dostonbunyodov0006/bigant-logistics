-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('single', 'double', 'full');

-- AlterEnum
ALTER TYPE "ReservationStatus" ADD VALUE 'queued';

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "group_id" TEXT,
ADD COLUMN     "mode" "BookingMode" NOT NULL DEFAULT 'single',
ADD COLUMN     "sequence_index" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "reservations_group_id_idx" ON "reservations"("group_id");
