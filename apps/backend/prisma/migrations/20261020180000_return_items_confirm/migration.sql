-- The seller's check on what the driver wrote up, before it reaches the
-- warehouse or the accounting app.
ALTER TABLE "orders"
  ADD COLUMN "return_items_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "return_items_confirmed_by_id" TEXT,
  ADD COLUMN "return_items_rejected_at" TIMESTAMP(3),
  ADD COLUMN "return_items_reject_reason" TEXT;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_return_items_confirmed_by_id_fkey"
  FOREIGN KEY ("return_items_confirmed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
