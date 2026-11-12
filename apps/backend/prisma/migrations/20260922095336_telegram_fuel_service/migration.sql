-- Telegram reports may be about a fuel fill-up or a service visit, not only an order,
-- and may carry an album of photos. The driver may leave a comment when closing a visit.

-- AlterTable
ALTER TABLE "service_visits" ADD COLUMN     "driver_comment" TEXT;

-- AlterTable
ALTER TABLE "telegram_reports" ADD COLUMN     "fuel_log_id" TEXT,
ADD COLUMN     "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "service_visit_id" TEXT,
ALTER COLUMN "order_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "telegram_reports" ADD CONSTRAINT "telegram_reports_fuel_log_id_fkey" FOREIGN KEY ("fuel_log_id") REFERENCES "fuel_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_reports" ADD CONSTRAINT "telegram_reports_service_visit_id_fkey" FOREIGN KEY ("service_visit_id") REFERENCES "service_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
