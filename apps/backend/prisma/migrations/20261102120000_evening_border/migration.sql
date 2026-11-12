-- A Viloyat evening ends when the lorry enters Tashkent, not at the last photo.
ALTER TABLE "evening_overtimes" ADD COLUMN "border_at" TIMESTAMP(3);
