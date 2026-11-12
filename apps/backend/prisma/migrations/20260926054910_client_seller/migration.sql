-- Each client belongs to a seller: sellers see only their own, staff see all.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "seller_id" TEXT;

-- CreateIndex
CREATE INDEX "clients_seller_id_idx" ON "clients"("seller_id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: a client a seller added is that seller's. Clients admin added stay
-- unassigned (staff-only) until admin picks a seller for them.
UPDATE "clients" c SET "seller_id" = c."created_by"
FROM "users" u
WHERE u."id" = c."created_by" AND u."role" = 'seller';
