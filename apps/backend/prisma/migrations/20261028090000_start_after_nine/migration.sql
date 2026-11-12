ALTER TABLE "reservations" ADD COLUMN "start_after_nine" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN "start_after_nine" BOOLEAN NOT NULL DEFAULT false;
