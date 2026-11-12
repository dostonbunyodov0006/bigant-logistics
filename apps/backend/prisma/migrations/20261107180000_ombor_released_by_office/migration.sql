-- Released by the office (owner, 07.11.2026): "Qabul qilindi deb belgilash
-- (ofis)" marks a return taken in with no count or photos, to free the driver.
-- The storekeeper / shop person may still send the count for it later, once.
ALTER TABLE "warehouse_returns" ADD COLUMN "released_by_office" BOOLEAN NOT NULL DEFAULT false;

-- Rows the office already released (no storekeeper, no count yet) can be counted too.
UPDATE "warehouse_returns" SET "released_by_office" = true
WHERE "accepted_at" IS NOT NULL
  AND "accepted_by_telegram_id" IS NULL
  AND "answer" IS NULL
  AND "accepted_by_name" LIKE '% (ofis)';
