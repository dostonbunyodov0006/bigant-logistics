-- CreateEnum
CREATE TYPE "BonusAppliesTo" AS ENUM ('all', 'urgent', 'normal');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "district_id" TEXT;

-- CreateTable
CREATE TABLE "bonus_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "amount" INTEGER NOT NULL,
    "applies_to" "BonusAppliesTo" NOT NULL DEFAULT 'all',
    "district_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bonus_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_logs" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "rule_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "accrued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonus_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bonus_logs_driver_id_idx" ON "bonus_logs"("driver_id");

-- CreateIndex
CREATE UNIQUE INDEX "bonus_logs_order_id_rule_id_key" ON "bonus_logs"("order_id", "rule_id");

-- AddForeignKey
ALTER TABLE "bonus_rules" ADD CONSTRAINT "bonus_rules_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_logs" ADD CONSTRAINT "bonus_logs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_logs" ADD CONSTRAINT "bonus_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_logs" ADD CONSTRAINT "bonus_logs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "bonus_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
