-- A vozvrat order: fetching returned goods back from a client days after a
-- delivery. Same table, a kind, and a link to the delivery it comes from.
CREATE TYPE "OrderKind" AS ENUM ('delivery', 'vozvrat');
ALTER TABLE "orders"
  ADD COLUMN "kind" "OrderKind" NOT NULL DEFAULT 'delivery',
  ADD COLUMN "original_order_id" TEXT;
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_original_order_id_fkey" FOREIGN KEY ("original_order_id")
    REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "orders_original_order_id_idx" ON "orders"("original_order_id");
CREATE INDEX "orders_kind_idx" ON "orders"("kind");
