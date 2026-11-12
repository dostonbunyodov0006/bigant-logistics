-- Omborchi moves here from the mini app (owner, 05.11.2026).
CREATE TABLE "warehouse_returns" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_number" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "driver_name" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "seller_name" TEXT NOT NULL,
    "comment" TEXT,
    "items" JSONB NOT NULL,
    "answer" JSONB,
    "answer_comment" TEXT,
    "overall_photo_url" TEXT,
    "accepted_by_telegram_id" TEXT,
    "accepted_by_name" TEXT,
    "accepted_at" TIMESTAMP(3),
    "reminded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "warehouse_returns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warehouse_returns_order_id_key" ON "warehouse_returns"("order_id");
CREATE UNIQUE INDEX "warehouse_returns_order_number_key" ON "warehouse_returns"("order_number");
CREATE INDEX "warehouse_returns_accepted_at_idx" ON "warehouse_returns"("accepted_at");
ALTER TABLE "warehouse_returns" ADD CONSTRAINT "warehouse_returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "vozvrat_products" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "unit" TEXT,
    "hodovoy" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'tasdiq',
    "added_by" TEXT,
    "first_return_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vozvrat_products_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vozvrat_products_key_key" ON "vozvrat_products"("key");
CREATE INDEX "vozvrat_products_status_idx" ON "vozvrat_products"("status");

CREATE TABLE "vozvrat_staff" (
    "id" TEXT NOT NULL,
    "telegram_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vozvrat_staff_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vozvrat_staff_telegram_id_key" ON "vozvrat_staff"("telegram_id");

-- Sample products (the real catalogue is not published).
INSERT INTO "vozvrat_products" ("id", "name", "key", "unit", "hodovoy", "status", "added_by", "created_at") VALUES
(1, 'Sample cement 50kg', 'samplecement50kg', NULL, true, 'tasdiq', 'list', '2026-09-30T00:00:00.000Z'::timestamptz),
(2, 'Sample tile adhesive 25kg', 'sampletileadhesive25kg', NULL, true, 'tasdiq', 'list', '2026-09-30T00:00:00.000Z'::timestamptz),
(3, 'Sample primer 10l', 'sampleprimer10l', NULL, false, 'tasdiq', 'list', '2026-09-30T00:00:00.000Z'::timestamptz),
(4, 'Sample paint 20kg', 'samplepaint20kg', NULL, true, 'tasdiq', 'list', '2026-09-30T00:00:00.000Z'::timestamptz),
(5, 'Sample plaster 30kg', 'sampleplaster30kg', NULL, false, 'tasdiq', 'list', '2026-09-30T00:00:00.000Z'::timestamptz);
SELECT setval(pg_get_serial_sequence('vozvrat_products', 'id'), (SELECT MAX("id") FROM "vozvrat_products"));
