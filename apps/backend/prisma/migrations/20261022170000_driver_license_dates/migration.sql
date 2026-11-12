-- When the licence was issued (his years behind the wheel count from it) and when it runs out.
ALTER TABLE "drivers" ADD COLUMN "license_issued_at" TIMESTAMP(3);
ALTER TABLE "drivers" ADD COLUMN "license_expires_at" TIMESTAMP(3);
