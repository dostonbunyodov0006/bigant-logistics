-- Vozrat return-trip stage (heading → arrived), null while carrying.
ALTER TABLE "orders" ADD COLUMN "return_stage" TEXT;
