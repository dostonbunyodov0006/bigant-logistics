-- Vozvrat items as the mini app takes them: the driver no longer names a
-- storekeeper (the warehouse records that on acceptance), quantities are
-- counted in the product's unit (2.5 kg), and the unit travels with the item.
ALTER TABLE "order_return_items"
  DROP COLUMN "storekeeper_id",
  DROP COLUMN "storekeeper_name",
  ADD COLUMN "unit" TEXT,
  ALTER COLUMN "quantity" TYPE DECIMAL(12,3);
