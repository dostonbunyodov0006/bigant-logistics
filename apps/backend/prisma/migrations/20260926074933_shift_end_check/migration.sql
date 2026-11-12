-- End-of-day check for forgotten clock-outs, and how each shift ended.

-- AlterTable
ALTER TABLE "work_logs" ADD COLUMN     "auto_closed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "close_source" TEXT,
ADD COLUMN     "end_check_answered_at" TIMESTAMP(3),
ADD COLUMN     "end_check_ran_at" TIMESTAMP(3),
ADD COLUMN     "end_check_sent_at" TIMESTAMP(3),
ADD COLUMN     "end_check_unanswered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "end_check_zone" TEXT;


-- Shifts already closed were closed by the driver.
UPDATE "work_logs" SET "close_source" = 'driver' WHERE "clock_out_at" IS NOT NULL;

-- Shifts left open from before today (forgotten clock-outs from before this
-- check existed) are closed once, here, at the driver's last activity on the
-- shift's own first day — not his last activity overall, which for these ran
-- to weeks later and would credit one day with weeks of hours. Marked
-- auto-closed for admin to review. From now on the check handles this daily.
WITH open_old AS (
  SELECT w.id, w.driver_id, w.clock_in_at,
         ((date_trunc('day', w.clock_in_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent') + interval '1 day')
            AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'UTC' AS day_end
  FROM "work_logs" w
  WHERE w."clock_out_at" IS NULL
    AND (w."clock_in_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date
        < (now() AT TIME ZONE 'Asia/Tashkent')::date
    -- A driver still carrying an order keeps his shift — the check decides later.
    AND NOT EXISTS (
      SELECT 1 FROM "orders" x WHERE x."assigned_driver_id" = w."driver_id"
        AND x."status" IN ('driver_accepted','collecting_items','items_collected','on_the_way','arrived_at_customer','returning')
    )
),
closing AS (
  SELECT o.id, o.driver_id, GREATEST(
    o.clock_in_at,
    (SELECT CASE WHEN d."location_updated_at" >= o.clock_in_at AND d."location_updated_at" < o.day_end THEN d."location_updated_at" END
       FROM "drivers" d WHERE d."id" = o.driver_id),
    (SELECT max(x."delivered_at") FROM "orders" x WHERE x."assigned_driver_id" = o.driver_id AND x."delivered_at" >= o.clock_in_at AND x."delivered_at" < o.day_end),
    (SELECT max(x."returned_at")  FROM "orders" x WHERE x."assigned_driver_id" = o.driver_id AND x."returned_at"  >= o.clock_in_at AND x."returned_at"  < o.day_end),
    (SELECT max(p."returned_at")  FROM "order_pickup_sources" p JOIN "orders" x ON x."id" = p."order_id"
       WHERE x."assigned_driver_id" = o.driver_id AND p."returned_at" >= o.clock_in_at AND p."returned_at" < o.day_end),
    (SELECT max(f."captured_at")  FROM "fuel_logs" f WHERE f."driver_id" = o.driver_id AND f."captured_at" >= o.clock_in_at AND f."captured_at" < o.day_end),
    (SELECT max(v."completed_at") FROM "service_visits" v WHERE v."driver_id" = o.driver_id AND v."completed_at" >= o.clock_in_at AND v."completed_at" < o.day_end)
  ) AS at
  FROM open_old o
),
closed AS (
  UPDATE "work_logs" w
  SET "clock_out_at" = c.at, "close_source" = 'auto_stale', "auto_closed" = true,
      "is_early_leave" = false, "early_minutes" = 0, "early_leave_reason" = NULL, "updated_at" = now()
  FROM closing c WHERE w."id" = c.id
  RETURNING w."driver_id"
)
UPDATE "drivers" SET "current_status" = 'offline', "break_until" = NULL
WHERE "id" IN (SELECT driver_id FROM closed)
  AND NOT EXISTS (SELECT 1 FROM "work_logs" w2 WHERE w2."driver_id" = "drivers"."id" AND w2."clock_out_at" IS NULL AND w2."id" NOT IN (SELECT id FROM closing));
