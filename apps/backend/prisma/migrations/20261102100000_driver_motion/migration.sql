-- How a driver is moving, from his fixes: speed now, and since when he has stood.
ALTER TABLE "drivers" ADD COLUMN "location_speed_kmh" DOUBLE PRECISION;
ALTER TABLE "drivers" ADD COLUMN "anchor_lat" DOUBLE PRECISION;
ALTER TABLE "drivers" ADD COLUMN "anchor_lng" DOUBLE PRECISION;
ALTER TABLE "drivers" ADD COLUMN "moved_at" TIMESTAMP(3);
