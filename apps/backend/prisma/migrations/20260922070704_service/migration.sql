-- CreateEnum
CREATE TYPE "ServiceVisitOrigin" AS ENUM ('mileage', 'emergency', 'request', 'assigned');

-- CreateEnum
CREATE TYPE "ServiceVisitStatus" AS ENUM ('requested', 'approved', 'declined', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ServiceReminderKind" AS ENUM ('due_soon', 'overdue', 'repeat');

-- CreateTable
CREATE TABLE "service_reasons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interval_km" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "created_by_driver_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "service_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_centers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "contracted" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "service_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_service_states" (
    "vehicle_id" TEXT NOT NULL,
    "reason_id" TEXT NOT NULL,
    "last_done_km" INTEGER NOT NULL,
    "last_done_at" TIMESTAMP(3) NOT NULL,
    "last_visit_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "vehicle_service_states_pkey" PRIMARY KEY ("vehicle_id","reason_id")
);

-- CreateTable
CREATE TABLE "service_visits" (
    "id" TEXT NOT NULL,
    "status" "ServiceVisitStatus" NOT NULL DEFAULT 'requested',
    "origin" "ServiceVisitOrigin" NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "driver_id" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "note" TEXT,
    "order_id" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "assigned_by_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "selected_center_id" TEXT,
    "resolved_center_id" TEXT,
    "captured_at" TIMESTAMP(3),
    "capture_lat" DOUBLE PRECISION,
    "capture_lng" DOUBLE PRECISION,
    "capture_accuracy_m" DOUBLE PRECISION,
    "tracked_lat" DOUBLE PRECISION,
    "tracked_lng" DOUBLE PRECISION,
    "tracked_at" TIMESTAMP(3),
    "distance_m" DOUBLE PRECISION,
    "tracking_gap_m" DOUBLE PRECISION,
    "outcome" "FuelLogOutcome",
    "flags" TEXT[],
    "odometer_km" INTEGER,
    "total_sum" DOUBLE PRECISION,
    "original_total_sum" DOUBLE PRECISION,
    "receipt_photo_url" TEXT,
    "no_receipt" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "settlement" "FuelSettlement",
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "service_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_visit_items" (
    "id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "reason_id" TEXT,
    "name" TEXT NOT NULL,
    "photo_url" TEXT,
    "cost_sum" DOUBLE PRECISION,
    "position" INTEGER NOT NULL DEFAULT 0,

CONSTRAINT "service_visit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_reminders" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "reason_id" TEXT NOT NULL,
    "kind" "ServiceReminderKind" NOT NULL,
    "km_at_send" INTEGER,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "service_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_reasons_active_approved_idx" ON "service_reasons"("active", "approved");

-- CreateIndex
CREATE INDEX "service_centers_active_contracted_idx" ON "service_centers"("active", "contracted");

-- CreateIndex
CREATE INDEX "service_visits_vehicle_id_status_idx" ON "service_visits"("vehicle_id", "status");

-- CreateIndex
CREATE INDEX "service_visits_driver_id_status_idx" ON "service_visits"("driver_id", "status");

-- CreateIndex
CREATE INDEX "service_visits_status_idx" ON "service_visits"("status");

-- CreateIndex
CREATE INDEX "service_visits_completed_at_idx" ON "service_visits"("completed_at");

-- CreateIndex
CREATE INDEX "service_visit_items_visit_id_idx" ON "service_visit_items"("visit_id");

-- CreateIndex
CREATE INDEX "service_reminders_vehicle_id_reason_id_sent_at_idx" ON "service_reminders"("vehicle_id", "reason_id", "sent_at");

-- AddForeignKey
ALTER TABLE "service_reasons" ADD CONSTRAINT "service_reasons_created_by_driver_id_fkey" FOREIGN KEY ("created_by_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_service_states" ADD CONSTRAINT "vehicle_service_states_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_service_states" ADD CONSTRAINT "vehicle_service_states_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "service_reasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_service_states" ADD CONSTRAINT "vehicle_service_states_last_visit_id_fkey" FOREIGN KEY ("last_visit_id") REFERENCES "service_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_selected_center_id_fkey" FOREIGN KEY ("selected_center_id") REFERENCES "service_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_resolved_center_id_fkey" FOREIGN KEY ("resolved_center_id") REFERENCES "service_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visit_items" ADD CONSTRAINT "service_visit_items_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "service_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visit_items" ADD CONSTRAINT "service_visit_items_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "service_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "service_reasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

