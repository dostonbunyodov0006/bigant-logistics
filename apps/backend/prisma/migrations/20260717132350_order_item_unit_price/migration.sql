-- Goods rows pasted from the накладная carry a unit of measure and a unit price (som).
ALTER TABLE "order_items" ADD COLUMN "unit" TEXT;
ALTER TABLE "order_items" ADD COLUMN "unit_price_som" INTEGER;
