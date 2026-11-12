-- CreateEnum
CREATE TYPE "DriverDocType" AS ENUM ('license', 'power_of_attorney', 'insurance', 'other');

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "type" "DriverDocType" NOT NULL DEFAULT 'other',
    "number" TEXT,
    "issued_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_documents_driver_id_idx" ON "driver_documents"("driver_id");

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
