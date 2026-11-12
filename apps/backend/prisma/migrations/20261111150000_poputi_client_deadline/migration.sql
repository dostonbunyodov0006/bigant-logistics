-- The first seller's client: latest delivery time once a po puti joins, and when he was told it runs late (owner, 11.11.2026).
ALTER TABLE "orders" ADD COLUMN "poputi_client_deadline_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "poputi_late_told_at" TIMESTAMP(3);
