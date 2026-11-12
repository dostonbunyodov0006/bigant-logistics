-- Place-based driver journey (Option A).
-- New order status "arrived_at_customer" sits between on_the_way and delivered.
ALTER TYPE "OrderStatus" ADD VALUE 'arrived_at_customer' BEFORE 'delivered';

-- Per-pickup leg status: pending → en_route → arrived.
CREATE TYPE "LegStatus" AS ENUM ('pending', 'en_route', 'arrived');
ALTER TABLE "order_pickup_sources" ADD COLUMN "leg_status" "LegStatus" NOT NULL DEFAULT 'pending';
