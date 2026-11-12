-- The list "Nima ish bilan?" is picked from (owner, 12.11.2026).
CREATE TABLE "company_job_options" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_job_options_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "company_job_options_name_key" ON "company_job_options"("name");
