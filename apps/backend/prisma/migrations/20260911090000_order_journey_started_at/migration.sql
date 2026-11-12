-- Start of the driver's delivery journey: departing for the first pickup place.
ALTER TABLE "orders" ADD COLUMN "journey_started_at" TIMESTAMP(3);
