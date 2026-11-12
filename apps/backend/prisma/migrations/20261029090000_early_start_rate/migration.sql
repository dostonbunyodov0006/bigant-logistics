ALTER TABLE "vehicle_tariffs" ADD COLUMN "early_hour_som" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "morning_starts" ADD COLUMN "rate_hour_som" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "morning_starts" ADD COLUMN "amount_som" INTEGER NOT NULL DEFAULT 0;
-- The owner's rates (29.10.2026): 70 000 so'm/hour for katta and orta, 40 000 for kichik.
INSERT INTO "vehicle_tariffs" ("category", "early_hour_som", "updated_at") VALUES
  ('katta', 70000, now()), ('orta', 70000, now()), ('kichik', 40000, now())
ON CONFLICT ("category") DO UPDATE SET "early_hour_som" = EXCLUDED."early_hour_som", "updated_at" = now();
