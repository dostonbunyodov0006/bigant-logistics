-- How early or late a scheduled work was done (owner, 06.11.2026).
ALTER TABLE "service_visit_items" ADD COLUMN "remaining_km_at_visit" INTEGER;
