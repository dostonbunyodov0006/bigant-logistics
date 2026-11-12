import { ConflictException } from '@nestjs/common';
import { syncFuelExpense, syncServiceExpense } from './auto-expense';
import { ExpensesService } from './expenses.service';

function prismaWith(rows: { fuelLog?: unknown; serviceVisit?: unknown }) {
  return {
    fuelLog: { findUnique: jest.fn().mockResolvedValue(rows.fuelLog ?? null) },
    serviceVisit: { findUnique: jest.fn().mockResolvedValue(rows.serviceVisit ?? null) },
    expenseType: { upsert: jest.fn(({ where }) => Promise.resolve({ id: `type:${where.name}` })) },
    expense: { upsert: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

const at = new Date('2026-10-29T08:00:00Z');

describe('fuel and service land in Xarajatlar by themselves', () => {
  it('a confirmed fill is one Yoqilg‘i expense, with its station, lorry and driver', async () => {
    const prisma = prismaWith({
      fuelLog: { status: 'confirmed', totalSum: 299_999.6, capturedAt: at, vehicleId: 'v1', driverId: 'd1', resolvedStation: { name: 'Metan Yujniy' } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await syncFuelExpense(prisma as any, 'f1');
    const data = { typeId: "type:Yoqilg'i", amount: 300_000, spentAt: at, note: 'Metan Yujniy', vehicleId: 'v1', driverId: 'd1' };
    expect(prisma.expense.upsert).toHaveBeenCalledWith({ where: { fuelLogId: 'f1' }, update: data, create: { ...data, fuelLogId: 'f1' } });
  });

  it('a fill the driver has not confirmed yet is not an expense', async () => {
    const prisma = prismaWith({ fuelLog: { status: 'draft', totalSum: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await syncFuelExpense(prisma as any, 'f1');
    expect(prisma.expense.upsert).not.toHaveBeenCalled();
    expect(prisma.expense.deleteMany).toHaveBeenCalledWith({ where: { fuelLogId: 'f1' } });
  });

  it('a completed service visit is one Servis expense; a cancelled one is taken out', async () => {
    const done = prismaWith({
      serviceVisit: { status: 'completed', totalSum: 450_000, completedAt: at, vehicleId: 'v1', driverId: null, resolvedCenter: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await syncServiceExpense(done as any, 's1');
    expect(done.expense.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serviceVisitId: 's1' }, update: expect.objectContaining({ typeId: 'type:Servis', amount: 450_000 }) }),
    );
    const cancelled = prismaWith({ serviceVisit: { status: 'cancelled', totalSum: 450_000, completedAt: at } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await syncServiceExpense(cancelled as any, 's1');
    expect(cancelled.expense.deleteMany).toHaveBeenCalledWith({ where: { serviceVisitId: 's1' } });
  });

  it('the office cannot edit or delete such a row by hand', async () => {
    const prisma = { expense: { findUnique: jest.fn().mockResolvedValue({ id: 'e1', fuelLogId: 'f1', serviceVisitId: null }) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ExpensesService(prisma as any);
    await expect(svc.remove('e1')).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.update('e1', { amount: 1 })).rejects.toMatchObject({ message: 'expense_auto' });
  });
});
