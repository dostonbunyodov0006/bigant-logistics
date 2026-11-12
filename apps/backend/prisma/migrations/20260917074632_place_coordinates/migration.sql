-- Coordinates for clients and pickup places, snapshotted onto orders and pickup
-- sources at creation (mirroring how region/district are already snapshotted).
--
-- Nullable on purpose: rows created before the map picker have no coordinates,
-- and the API decides whether new rows must supply them (they must). Double
-- precision holds ~15 significant digits — far beyond GPS accuracy — without the
-- friction Decimal adds in the application layer.

ALTER TABLE "clients"
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION;

ALTER TABLE "pickup_places"
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION;

ALTER TABLE "orders"
  ADD COLUMN "delivery_lat" DOUBLE PRECISION,
  ADD COLUMN "delivery_lng" DOUBLE PRECISION;

ALTER TABLE "order_pickup_sources"
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION;

-- Both-or-neither: a row with only one half of a coordinate is worse than none,
-- because every consumer would have to check both anyway.
ALTER TABLE "clients"
  ADD CONSTRAINT "clients_coords_pair" CHECK (("lat" IS NULL) = ("lng" IS NULL));
ALTER TABLE "pickup_places"
  ADD CONSTRAINT "pickup_places_coords_pair" CHECK (("lat" IS NULL) = ("lng" IS NULL));
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_delivery_coords_pair" CHECK (("delivery_lat" IS NULL) = ("delivery_lng" IS NULL));
ALTER TABLE "order_pickup_sources"
  ADD CONSTRAINT "order_pickup_sources_coords_pair" CHECK (("lat" IS NULL) = ("lng" IS NULL));
