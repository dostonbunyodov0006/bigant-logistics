-- Ta'minotchi return: the supplier place picked by the seller (owner, 12.11.2026).
ALTER TABLE "order_pickup_sources" ADD COLUMN "return_place_id" TEXT;
ALTER TABLE "order_pickup_sources" ADD CONSTRAINT "order_pickup_sources_return_place_id_fkey" FOREIGN KEY ("return_place_id") REFERENCES "pickup_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;
