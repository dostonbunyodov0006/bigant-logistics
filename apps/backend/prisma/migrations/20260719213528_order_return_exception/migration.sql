-- Delivery outcomes: Istisno (exception) + Vozrat (return).
-- New terminal-ish statuses: returning (goods going back) → returned (dropped off).
ALTER TYPE "OrderStatus" ADD VALUE 'returned' AFTER 'delivered';
ALTER TYPE "OrderStatus" ADD VALUE 'returning' AFTER 'delivered';

-- Order-level exception reason + return details.
ALTER TABLE "orders" ADD COLUMN "problem_reason" TEXT;
ALTER TABLE "orders" ADD COLUMN "return_reason" TEXT;
ALTER TABLE "orders" ADD COLUMN "return_destination" TEXT;
ALTER TABLE "orders" ADD COLUMN "returned_at" TIMESTAMP(3);
