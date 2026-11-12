-- Somebody who ordered once: the order hangs on a client row, but the seller's
-- address book is not filled with names nobody will search for again.
ALTER TABLE "clients" ADD COLUMN "one_off" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pickup_places" ADD COLUMN "one_off" BOOLEAN NOT NULL DEFAULT false;
