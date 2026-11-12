import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpensesService } from './expenses.service';

function expenseType(overrides: Record<string, unknown> = {}) {
  return {
    id: 'et1',
    name: 'Fuel',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    typeId: 'et1',
    amount: 120000,
    spentAt: new Date('2026-07-10T00:00:00.000Z'),
    note: null,
    vehicleId: null,
    driverId: null,
    createdById: 'admin1',
    createdAt: new Date(),
    updatedAt: new Date(),
    type: { name: 'Fuel' },
    vehicle: null,
    driver: null,
    createdBy: { name: 'Boss' },
    ...overrides,
  };
}

function makeService(opts: {
  types?: unknown[];
  typeByName?: unknown;
  typeById?: unknown;
  expenseById?: unknown;
  inUse?: number;
  groups?: unknown[];
} = {}) {
  const prisma = {
    expenseType: {
      findMany: jest.fn().mockResolvedValue(opts.types ?? [expenseType()]),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string; name?: string } }) => {
        if (where.name !== undefined) return Promise.resolve('typeByName' in opts ? opts.typeByName : null);
        return Promise.resolve('typeById' in opts ? opts.typeById : expenseType());
      }),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(expenseType(data)),
      ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(expenseType(data)),
      ),
      delete: jest.fn().mockResolvedValue(expenseType()),
    },
    expense: {
      findMany: jest.fn().mockResolvedValue([expense()]),
      findUnique: jest.fn().mockResolvedValue('expenseById' in opts ? opts.expenseById : expense()),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(expense(data)),
      ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(expense(data)),
      ),
      delete: jest.fn().mockResolvedValue(expense()),
      count: jest.fn().mockResolvedValue(opts.inUse ?? 0),
      groupBy: jest.fn().mockResolvedValue(opts.groups ?? []),
    },
    vehicle: { findUnique: jest.fn().mockResolvedValue({ id: 'v1' }) },
    driver: { findUnique: jest.fn().mockResolvedValue({ id: 'd1' }) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new ExpensesService(prisma as any), prisma };
}

describe('ExpensesService types', () => {
  it('creates a type and rejects duplicates', async () => {
    const { service } = makeService();
    const res = await service.createType({ name: 'Repairs' });
    expect(res.name).toBe('Repairs');
    // The name is unique in the database; a duplicate comes back as P2002
    // and is turned into the message, not a 500.
    const dup = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dup.prisma.expenseType as any).create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(dup.service.createType({ name: 'Fuel' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks deleting a type that is in use', async () => {
    const { service } = makeService({ inUse: 3 });
    await expect(service.removeType('et1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes an unused type', async () => {
    const { service, prisma } = makeService({ inUse: 0 });
    const res = await service.removeType('et1');
    expect(res).toEqual({ deleted: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.expenseType as any).delete).toHaveBeenCalledWith({ where: { id: 'et1' } });
  });
});

describe('ExpensesService expenses', () => {
  it('creates an expense with the creator stamped and dates parsed', async () => {
    const { service, prisma } = makeService();
    const res = await service.create(
      { type_id: 'et1', amount: 120000, spent_at: '2026-07-10' },
      'admin1',
    );
    expect(res.amount).toBe(120000);
    expect(res.spent_at).toBe('2026-07-10');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.expense as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ typeId: 'et1', createdById: 'admin1' }),
      }),
    );
  });

  it('rejects an expense with an unknown type', async () => {
    const { service } = makeService({ typeById: null });
    await expect(
      service.create({ type_id: 'missing', amount: 1000, spent_at: '2026-07-10' }, 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when updating a missing expense', async () => {
    const { service } = makeService({ expenseById: null });
    await expect(service.update('nope', { amount: 5 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('summarises totals by type, sorted descending', async () => {
    const { service } = makeService({
      types: [expenseType({ id: 'et1', name: 'Fuel' }), expenseType({ id: 'et2', name: 'Repairs' })],
      groups: [
        { typeId: 'et1', _sum: { amount: 50000 }, _count: { _all: 2 } },
        { typeId: 'et2', _sum: { amount: 300000 }, _count: { _all: 1 } },
      ],
    });
    const res = await service.summary({ from: '2026-07-01', to: '2026-07-31' });
    expect(res.summary).toEqual({ total: 350000, count: 3 });
    expect(res.by_type.map((r) => r.type_id)).toEqual(['et2', 'et1']);
    expect(res.by_type[0].type_name).toBe('Repairs');
  });

  it('applies type/vehicle/driver and date filters to the query', async () => {
    const { service, prisma } = makeService();
    await service.list({ type_id: 'et1', vehicle_id: 'v1', driver_id: 'd1', from: '2026-07-01', to: '2026-07-31' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where = (prisma.expense as any).findMany.mock.calls[0][0].where;
    expect(where.typeId).toBe('et1');
    expect(where.vehicleId).toBe('v1');
    expect(where.driverId).toBe('d1');
    expect(where.spentAt.gte).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    expect(where.spentAt.lt).toEqual(new Date('2026-08-01T00:00:00.000Z'));
  });
});
