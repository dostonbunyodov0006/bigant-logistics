CREATE TABLE "morning_starts" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "order_id" TEXT,
    "action" TEXT NOT NULL,
    "pressed_at" TIMESTAMP(3) NOT NULL,
    "press_lat" DOUBLE PRECISION,
    "press_lng" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'waiting_gps',
    "moved_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "early_minutes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "morning_starts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "morning_starts_driver_id_day_key" ON "morning_starts"("driver_id", "day");
CREATE INDEX "morning_starts_status_idx" ON "morning_starts"("status");
ALTER TABLE "morning_starts" ADD CONSTRAINT "morning_starts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "morning_starts" ADD CONSTRAINT "morning_starts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
