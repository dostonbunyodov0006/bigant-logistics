-- Vozvrat by destination (owner, 07.11.2026): a store-bound return is taken in
-- by the shop's person (dokonchi), a warehouse-bound one by the storekeeper; a
-- supplier-bound one by no one. An order with stops to both gets one row each.
ALTER TABLE "warehouse_returns" ADD COLUMN "destination" TEXT NOT NULL DEFAULT 'warehouse';
DROP INDEX "warehouse_returns_order_id_key";
DROP INDEX "warehouse_returns_order_number_key";
CREATE UNIQUE INDEX "warehouse_returns_order_id_destination_key" ON "warehouse_returns"("order_id", "destination");
CREATE UNIQUE INDEX "warehouse_returns_order_number_destination_key" ON "warehouse_returns"("order_number", "destination");

-- The driver's "Topshirdim" at a store now waits for the shop's acceptance.
ALTER TABLE "orders" ADD COLUMN "return_store_accepted_at" TIMESTAMP(3);
-- Returns already handed over under the old rule (report sent) were never
-- gated at a store: they stay open, so no driver on the road gets stuck.
UPDATE "orders" SET "return_store_accepted_at" = NOW()
WHERE "return_store_accepted_at" IS NULL
  AND "id" IN (SELECT "order_id" FROM "vozvrat_reports" WHERE "status" = 'sent');
