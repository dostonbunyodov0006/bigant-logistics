/*
  Warnings:

  - You are about to drop the column `location` on the `drivers` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "drivers" DROP COLUMN "location",
ADD COLUMN     "location_lat" DOUBLE PRECISION,
ADD COLUMN     "location_lng" DOUBLE PRECISION,
ADD COLUMN     "location_updated_at" TIMESTAMP(3);
