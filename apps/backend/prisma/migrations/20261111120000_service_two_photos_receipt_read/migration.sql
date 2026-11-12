-- Two photos per service work, and the receipt total the AI read (owner, 11.11.2026).
ALTER TABLE "service_visit_items" ADD COLUMN "photo_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "service_visit_items" SET "photo_urls" = ARRAY["photo_url"] WHERE "photo_url" IS NOT NULL;
ALTER TABLE "service_visits" ADD COLUMN "receipt_read_sum" DOUBLE PRECISION;
