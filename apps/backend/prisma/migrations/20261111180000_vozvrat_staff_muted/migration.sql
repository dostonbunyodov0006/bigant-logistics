-- A vozvrat staff member who gets no Telegram messages but keeps the page (owner, 11.11.2026).
ALTER TABLE "vozvrat_staff" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;
