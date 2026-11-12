-- CreateTable
CREATE TABLE "fines" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "order_id" TEXT,
    "reason" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "issued_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fines_driver_id_idx" ON "fines"("driver_id");

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
