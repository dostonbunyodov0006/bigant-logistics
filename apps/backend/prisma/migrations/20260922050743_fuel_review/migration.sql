-- AlterTable
ALTER TABLE "fuel_logs" ADD COLUMN     "original_quantity" DOUBLE PRECISION,
ADD COLUMN     "original_total_sum" DOUBLE PRECISION,
ADD COLUMN     "original_unit_price_sum" DOUBLE PRECISION,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

