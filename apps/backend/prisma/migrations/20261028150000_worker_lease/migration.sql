CREATE TABLE "worker_lease" (
    "id" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "worker_lease_pkey" PRIMARY KEY ("id")
);
