-- Ending a shift with an order still in hand: "not today", why, and on which shift.

-- CreateTable
CREATE TABLE "order_carry_overs" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "work_log_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_carry_overs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_carry_overs_order_id_idx" ON "order_carry_overs"("order_id");

-- CreateIndex
CREATE INDEX "order_carry_overs_work_log_id_idx" ON "order_carry_overs"("work_log_id");

-- AddForeignKey
ALTER TABLE "order_carry_overs" ADD CONSTRAINT "order_carry_overs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_carry_overs" ADD CONSTRAINT "order_carry_overs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_carry_overs" ADD CONSTRAINT "order_carry_overs_work_log_id_fkey" FOREIGN KEY ("work_log_id") REFERENCES "work_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
