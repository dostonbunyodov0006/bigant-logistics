-- Merged trip ordering for po puti co-loads.
--
-- When two orders ride together, the driver visits their stops interleaved, and
-- something has to say in which order. These columns hold that sequence,
-- computed from the fence assignment when the co-load is accepted.
--
-- Null means "not part of a co-load": an ordinary order is driven on its own,
-- its stops ordered by `position` as before. Keeping it null rather than
-- backfilling every order means single-order behaviour is untouched, and the
-- presence of a value is itself the signal that a trip is in play.

ALTER TABLE "orders" ADD COLUMN "delivery_trip_position" INTEGER;
ALTER TABLE "order_pickup_sources" ADD COLUMN "trip_position" INTEGER;

-- The driver's next stop is the lowest incomplete trip position across their
-- active orders, so this is the lookup on the hot path.
CREATE INDEX "order_pickup_sources_trip_position_idx"
  ON "order_pickup_sources"("order_id", "trip_position");
