-- Two more papers the office keeps per lorry, and a picture on every one.
ALTER TYPE "VehicleDocType" ADD VALUE 'power_of_attorney';
ALTER TYPE "VehicleDocType" ADD VALUE 'tint';
ALTER TABLE "vehicle_documents" ADD COLUMN "photo_url" TEXT;
ALTER TABLE "vehicle_documents" ADD COLUMN "holder_name" TEXT;
