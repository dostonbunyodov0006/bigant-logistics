-- When the driver app itself (its JS, signed in) last reached the server, and
-- the office alert when it goes quiet during an open shift (owner, 09.11.2026).
-- The phone's native location service does not count: it kept sending while a
-- bad app update had stopped every request from the app.
ALTER TABLE "drivers" ADD COLUMN "last_app_seen_at" TIMESTAMP(3);
ALTER TABLE "work_logs" ADD COLUMN "app_silent_since" TIMESTAMP(3);
ALTER TABLE "work_logs" ADD COLUMN "app_silent_alert_at" TIMESTAMP(3);
