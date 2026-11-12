-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "scheduled_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "fill_deadline" DROP NOT NULL;
