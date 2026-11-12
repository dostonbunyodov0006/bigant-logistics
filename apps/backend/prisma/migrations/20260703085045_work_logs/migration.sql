-- CreateTable
CREATE TABLE "work_logs" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "clock_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clock_out_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_logs_driver_id_idx" ON "work_logs"("driver_id");

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
