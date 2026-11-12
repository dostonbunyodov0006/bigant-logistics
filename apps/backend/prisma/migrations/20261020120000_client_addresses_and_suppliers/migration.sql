-- A regular customer has more than one place: a shop, a second shop, a yard.
-- The seller should pick it by name, not describe a location again on every
-- order. Same on the other side: one supplier loads from several yards.

CREATE TABLE "client_addresses" (
  "id"            TEXT NOT NULL,
  "client_id"     TEXT NOT NULL,
  "label"         TEXT NOT NULL,
  "address"       TEXT,
  "lat"           DOUBLE PRECISION,
  "lng"           DOUBLE PRECISION,
  "region_code"   TEXT,
  "district_code" TEXT,
  "is_default"    BOOLEAN NOT NULL DEFAULT false,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_addresses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_addresses_client_id_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_addresses_region_code_fkey" FOREIGN KEY ("region_code")
    REFERENCES "regions"("code") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "client_addresses_district_code_fkey" FOREIGN KEY ("district_code")
    REFERENCES "geo_districts"("code") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "client_addresses_client_id_active_idx" ON "client_addresses"("client_id", "active");
-- One default per client: a partial unique index says it once, instead of
-- every write having to remember to clear the old one.
CREATE UNIQUE INDEX "client_addresses_one_default_per_client"
  ON "client_addresses"("client_id") WHERE "is_default";

-- Every client that already has a place keeps it, as its default address.
-- Nothing is asked of the office: the list starts where the client record is.
INSERT INTO "client_addresses" ("id", "client_id", "label", "address", "lat", "lng", "region_code", "district_code", "is_default", "active")
SELECT gen_random_uuid(), c."id", 'Asosiy manzil', c."address", c."lat", c."lng", c."region_code", c."district_code", true, true
  FROM "clients" c;

CREATE TABLE "suppliers" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "phone_number" TEXT,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "created_by"   TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "suppliers_created_by_fkey" FOREIGN KEY ("created_by")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");

-- Our own shop and warehouse belong to no supplier, so this stays null for them.
ALTER TABLE "pickup_places" ADD COLUMN "supplier_id" TEXT;
ALTER TABLE "pickup_places" ADD CONSTRAINT "pickup_places_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "pickup_places_supplier_id_idx" ON "pickup_places"("supplier_id");

-- Which address an order was for. The address text, pin and geo on the order
-- itself remain the authoritative copy; this is only the provenance.
ALTER TABLE "orders" ADD COLUMN "client_address_id" TEXT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_address_id_fkey"
  FOREIGN KEY ("client_address_id") REFERENCES "client_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
