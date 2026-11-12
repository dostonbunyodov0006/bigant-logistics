-- A driver's position trail, for the office's route-history map.
CREATE TABLE "driver_location_pings" (
  "id"          TEXT NOT NULL,
  "driver_id"   TEXT NOT NULL,
  "lat"         DOUBLE PRECISION NOT NULL,
  "lng"         DOUBLE PRECISION NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "driver_location_pings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "driver_location_pings_driver_id_fkey" FOREIGN KEY ("driver_id")
    REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "driver_location_pings_driver_id_recorded_at_idx" ON "driver_location_pings"("driver_id", "recorded_at");
CREATE INDEX "driver_location_pings_recorded_at_idx" ON "driver_location_pings"("recorded_at");
