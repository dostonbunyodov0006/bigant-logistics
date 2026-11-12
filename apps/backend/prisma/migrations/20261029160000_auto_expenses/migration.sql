ALTER TABLE "expenses" ALTER COLUMN "created_by_id" DROP NOT NULL;
ALTER TABLE "expenses" ADD COLUMN "fuel_log_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN "service_visit_id" TEXT;
CREATE UNIQUE INDEX "expenses_fuel_log_id_key" ON "expenses"("fuel_log_id");
CREATE UNIQUE INDEX "expenses_service_visit_id_key" ON "expenses"("service_visit_id");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_fuel_log_id_fkey" FOREIGN KEY ("fuel_log_id") REFERENCES "fuel_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_service_visit_id_fkey" FOREIGN KEY ("service_visit_id") REFERENCES "service_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The fills and visits already on record go in too.
INSERT INTO "expense_types" ("id", "name", "active", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'Yoqilg''i', true, now(), now()), (gen_random_uuid()::text, 'Servis', true, now(), now())
ON CONFLICT ("name") DO NOTHING;
INSERT INTO "expenses" ("id", "type_id", "amount", "spent_at", "note", "vehicle_id", "driver_id", "fuel_log_id", "created_at", "updated_at")
SELECT gen_random_uuid()::text, (SELECT "id" FROM "expense_types" WHERE "name" = 'Yoqilg''i'), ROUND(f."total_sum")::int, f."captured_at",
       st."name", f."vehicle_id", f."driver_id", f."id", now(), now()
FROM "fuel_logs" f LEFT JOIN "fuel_stations" st ON st."id" = f."resolved_station_id"
WHERE f."status" = 'confirmed' AND f."total_sum" IS NOT NULL;
INSERT INTO "expenses" ("id", "type_id", "amount", "spent_at", "note", "vehicle_id", "driver_id", "service_visit_id", "created_at", "updated_at")
SELECT gen_random_uuid()::text, (SELECT "id" FROM "expense_types" WHERE "name" = 'Servis'), ROUND(v."total_sum")::int, v."completed_at",
       c."name", v."vehicle_id", v."driver_id", v."id", now(), now()
FROM "service_visits" v LEFT JOIN "service_centers" c ON c."id" = v."resolved_center_id"
WHERE v."status" = 'completed' AND v."total_sum" IS NOT NULL AND v."completed_at" IS NOT NULL;
