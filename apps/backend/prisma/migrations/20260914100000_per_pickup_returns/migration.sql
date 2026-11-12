-- A cancelled/refused order can contain goods collected from several pickup
-- places. Track each pickup's return destination and journey independently.
ALTER TABLE "order_pickup_sources"
  ADD COLUMN "return_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "return_destination" TEXT,
  ADD COLUMN "return_stage" TEXT,
  ADD COLUMN "return_proof_photo_url" TEXT,
  ADD COLUMN "returned_at" TIMESTAMP(3);

CREATE INDEX "order_pickup_sources_order_id_return_required_idx"
  ON "order_pickup_sources"("order_id", "return_required");

-- Preserve existing single-destination Vozvrat rows. Every pickup that had
-- already been reached inherits the order-level legacy return information.
UPDATE "order_pickup_sources" ps
SET
  "return_required" = true,
  "return_destination" = o."return_destination",
  "return_stage" = o."return_stage",
  "return_proof_photo_url" = CASE
    WHEN o."status" = 'returned' THEN o."return_proof_photo_url"
    ELSE NULL
  END,
  "returned_at" = CASE
    WHEN o."status" = 'returned'
      THEN COALESCE(o."returned_at", o."updated_at")
    ELSE NULL
  END
FROM "orders" o
WHERE ps."order_id" = o."id"
  AND ps."leg_status" = 'arrived'
  AND o."status" IN ('returning', 'returned');
