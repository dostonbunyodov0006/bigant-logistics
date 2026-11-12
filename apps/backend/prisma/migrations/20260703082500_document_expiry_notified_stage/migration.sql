-- AlterTable
ALTER TABLE "driver_documents" ADD COLUMN     "expiry_notified_stage" TEXT;

-- AlterTable
ALTER TABLE "vehicle_documents" ADD COLUMN     "expiry_notified_stage" TEXT;
