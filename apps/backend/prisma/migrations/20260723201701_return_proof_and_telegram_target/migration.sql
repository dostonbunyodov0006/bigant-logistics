-- Vozrat proof photo on the order + Telegram report target (delivery vs vozrat group).
ALTER TABLE "orders" ADD COLUMN "return_proof_photo_url" TEXT;
ALTER TABLE "telegram_reports" ADD COLUMN "target" TEXT NOT NULL DEFAULT 'delivery';
