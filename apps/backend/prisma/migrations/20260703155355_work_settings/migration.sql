-- CreateTable
CREATE TABLE "work_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "expected_hours_per_day" INTEGER NOT NULL DEFAULT 8,
    "workdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "shift_start" TEXT NOT NULL DEFAULT '09:00',
    "shift_end" TEXT NOT NULL DEFAULT '18:00',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_settings_pkey" PRIMARY KEY ("id")
);
