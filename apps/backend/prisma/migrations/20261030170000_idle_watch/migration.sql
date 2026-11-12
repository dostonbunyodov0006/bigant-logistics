-- The stalled-lorry watch: a booked lorry that does not set off is warned at 10 min and its order cancelled at 15.
ALTER TABLE "orders" ADD COLUMN "idle_watch_since" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "idle_start_metres" DOUBLE PRECISION;
ALTER TABLE "orders" ADD COLUMN "idle_state" TEXT;
