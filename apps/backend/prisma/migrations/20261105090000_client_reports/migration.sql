-- Crash and stuck-start reports from the driver app, kept across deploys.
CREATE TABLE "client_reports" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fatal" BOOLEAN NOT NULL DEFAULT false,
    "version" TEXT,
    "update" TEXT,
    "at" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    CONSTRAINT "client_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "client_reports_created_at_idx" ON "client_reports"("created_at");
