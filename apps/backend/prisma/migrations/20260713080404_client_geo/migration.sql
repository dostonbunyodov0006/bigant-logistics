-- Relax clients.address to optional (region/district now carry location).
ALTER TABLE "clients" ALTER COLUMN "address" DROP NOT NULL;

-- Official geo reference tables (seeded from MHOBT data).
CREATE TABLE "regions" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_city" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "regions_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "geo_districts" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region_code" TEXT NOT NULL,
    CONSTRAINT "geo_districts_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "geo_districts_region_code_idx" ON "geo_districts"("region_code");
ALTER TABLE "geo_districts" ADD CONSTRAINT "geo_districts_region_code_fkey"
    FOREIGN KEY ("region_code") REFERENCES "regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Client geo columns.
ALTER TABLE "clients" ADD COLUMN "region_code" TEXT;
ALTER TABLE "clients" ADD COLUMN "district_code" TEXT;
CREATE INDEX "clients_region_code_idx" ON "clients"("region_code");
ALTER TABLE "clients" ADD CONSTRAINT "clients_region_code_fkey"
    FOREIGN KEY ("region_code") REFERENCES "regions"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clients" ADD CONSTRAINT "clients_district_code_fkey"
    FOREIGN KEY ("district_code") REFERENCES "geo_districts"("code") ON DELETE SET NULL ON UPDATE CASCADE;
