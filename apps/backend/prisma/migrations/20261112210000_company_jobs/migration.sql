-- "Ishxona ishi bilan": a lorry taken for the company's own errands (owner, 12.11.2026).
CREATE TABLE "company_jobs" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "driver_id" TEXT,
    "tasks" TEXT[],
    "minutes" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "until" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "company_jobs_vehicle_id_until_idx" ON "company_jobs"("vehicle_id", "until");
ALTER TABLE "company_jobs" ADD CONSTRAINT "company_jobs_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
