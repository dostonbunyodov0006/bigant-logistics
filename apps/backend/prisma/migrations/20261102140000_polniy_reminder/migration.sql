-- A Polniy with one order: the seller is reminded once to put the next one on.
ALTER TABLE "orders" ADD COLUMN "polniy_reminded_at" TIMESTAMP(3);
