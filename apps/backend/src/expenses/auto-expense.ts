import type { PrismaService } from '../prisma/prisma.service';

/**
 * Fuel and service cost the company money, so they belong in Xarajatlar
 * beside what the office types in by hand (owner, 29.10.2026). Each confirmed
 * fill and each completed service visit keeps exactly one expense row, linked
 * to it: written when the cost is known, rewritten when the office corrects
 * it, removed when the visit is cancelled. The office does not edit these
 * rows by hand — the fill or the visit is where the number is corrected.
 */
export const FUEL_EXPENSE_TYPE = "Yoqilg'i";
export const SERVICE_EXPENSE_TYPE = 'Servis';

async function typeId(prisma: PrismaService, name: string): Promise<string> {
  const row = await prisma.expenseType.upsert({ where: { name }, update: {}, create: { name } });
  return row.id;
}

export async function syncFuelExpense(prisma: PrismaService, fuelLogId: string): Promise<void> {
  const log = await prisma.fuelLog.findUnique({
    where: { id: fuelLogId },
    select: {
      status: true,
      totalSum: true,
      capturedAt: true,
      vehicleId: true,
      driverId: true,
      resolvedStation: { select: { name: true } },
    },
  });
  if (!log || log.status === 'draft' || log.totalSum == null) {
    await prisma.expense.deleteMany({ where: { fuelLogId } });
    return;
  }
  const data = {
    typeId: await typeId(prisma, FUEL_EXPENSE_TYPE),
    amount: Math.round(log.totalSum),
    spentAt: log.capturedAt,
    note: log.resolvedStation?.name ?? null,
    vehicleId: log.vehicleId,
    driverId: log.driverId,
  };
  await prisma.expense.upsert({ where: { fuelLogId }, update: data, create: { ...data, fuelLogId } });
}

export async function syncServiceExpense(prisma: PrismaService, serviceVisitId: string): Promise<void> {
  const visit = await prisma.serviceVisit.findUnique({
    where: { id: serviceVisitId },
    select: {
      status: true,
      totalSum: true,
      completedAt: true,
      vehicleId: true,
      driverId: true,
      resolvedCenter: { select: { name: true } },
    },
  });
  if (!visit || visit.status !== 'completed' || visit.totalSum == null || !visit.completedAt) {
    await prisma.expense.deleteMany({ where: { serviceVisitId } });
    return;
  }
  const data = {
    typeId: await typeId(prisma, SERVICE_EXPENSE_TYPE),
    amount: Math.round(visit.totalSum),
    spentAt: visit.completedAt,
    note: visit.resolvedCenter?.name ?? null,
    vehicleId: visit.vehicleId,
    driverId: visit.driverId,
  };
  await prisma.expense.upsert({ where: { serviceVisitId }, update: data, create: { ...data, serviceVisitId } });
}
