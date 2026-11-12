-- Viloyat trips past the end of the work day are paid by road kilometre.

-- Per-km price per vehicle class: hourly overtime ÷ the fastest realistic
-- average speed (routing estimate, no stops), rounded down —
-- Damas 40,000 ÷ 70.6 km/h, Gazel/Isuzu 70,000 ÷ 64.7 km/h.
ALTER TABLE "vehicle_tariffs" ADD COLUMN "overtime_km_som" INTEGER NOT NULL DEFAULT 0;
UPDATE "vehicle_tariffs" SET "overtime_km_som" = CASE "category" WHEN 'kichik' THEN 560 ELSE 1080 END;

-- When the shift-end check ran for a shift. Every shift that exists now counts
-- as checked: the rule starts with the next shift end, nothing is paid back.
ALTER TABLE "work_logs" ADD COLUMN "overtime_checked_at" TIMESTAMP(3);
UPDATE "work_logs" SET "overtime_checked_at" = NOW();

CREATE TABLE "viloyat_overtimes" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "work_log_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "from_lat" DOUBLE PRECISION NOT NULL,
    "from_lng" DOUBLE PRECISION NOT NULL,
    "gps_at" TIMESTAMP(3) NOT NULL,
    "gps_stale" BOOLEAN NOT NULL DEFAULT false,
    "to_dropoff_km" DOUBLE PRECISION NOT NULL,
    "to_border_km" DOUBLE PRECISION NOT NULL,
    "total_km" DOUBLE PRECISION NOT NULL,
    "category" TEXT,
    "rate_per_km_som" INTEGER NOT NULL,
    "amount_som" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viloyat_overtimes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "viloyat_overtimes_work_log_id_key" ON "viloyat_overtimes"("work_log_id");
CREATE INDEX "viloyat_overtimes_driver_id_created_at_idx" ON "viloyat_overtimes"("driver_id", "created_at");

ALTER TABLE "viloyat_overtimes" ADD CONSTRAINT "viloyat_overtimes_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viloyat_overtimes" ADD CONSTRAINT "viloyat_overtimes_work_log_id_fkey" FOREIGN KEY ("work_log_id") REFERENCES "work_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viloyat_overtimes" ADD CONSTRAINT "viloyat_overtimes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
