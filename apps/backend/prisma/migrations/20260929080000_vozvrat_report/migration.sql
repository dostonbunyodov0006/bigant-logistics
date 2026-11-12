-- Vozvrat report: what was returned and why, product by product, and its
-- delivery to the accounting system.

-- Sellers' Telegram user id, sent as sotuvchi_id with each vozvrat.
ALTER TABLE "users" ADD COLUMN "telegram_id" TEXT;

CREATE TABLE "order_return_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "name" TEXT NOT NULL,
    "xodovoy" BOOLEAN,
    "quantity" INTEGER NOT NULL,
    "condition" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "other_reason" TEXT,
    "culprit" TEXT,
    "storekeeper_id" TEXT,
    "storekeeper_name" TEXT,
    "photo_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_return_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_return_items_order_id_idx" ON "order_return_items"("order_id");
ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "vozvrat_reports" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_status" INTEGER,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vozvrat_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vozvrat_reports_order_id_key" ON "vozvrat_reports"("order_id");
CREATE INDEX "vozvrat_reports_status_next_attempt_at_idx" ON "vozvrat_reports"("status", "next_attempt_at");
ALTER TABLE "vozvrat_reports" ADD CONSTRAINT "vozvrat_reports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- (The company's seller accounts were created here; not published. Create users from the admin console.)
