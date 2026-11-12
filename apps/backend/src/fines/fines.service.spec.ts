import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FinesService } from './fines.service';

function fine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    driverId: 'drv1',
    orderId: null,
    reason: 'Late delivery',
    amount: 50000,
    issuedById: 'admin1',
    driver: { user: { name: 'Hamza' } },
    order: null,
    issuedBy: { name: 'Boss' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(
  opts: { fines?: unknown[]; driverExists?: boolean; orderExists?: boolean; fineById?: unknown } = {},
) {
  const prisma = {
    fine: {
      findMany: jest.fn().mockResolvedValue(opts.fines ?? [fine()]),
      findUnique: jest.fn().mockResolvedValue('fineById' in opts ? opts.fineById : fine()),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(fine(data)),
      ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(fine(data)),
      ),
      delete: jest.fn().mockResolvedValue(fine()),
    },
    driver: {
      findUnique: jest.fn().mockResolvedValue(opts.driverExists === false ? null : { id: 'drv1' }),
    },
    order: {
      findUnique: jest.fn().mockResolvedValue(opts.orderExists === false ? null : { id: 'o1' }),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new FinesService(prisma as any), prisma };
}

describe('FinesService', () => {
  it('creates a fine against a driver and stamps the issuer', async () => {
    const { service, prisma } = makeService();
    const res = await service.create(
      { driver_id: 'drv1', amount: 50000, reason: 'Late delivery' },
      'admin1',
    );
    expect(res.amount).toBe(50000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.fine as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driverId: 'drv1', amount: 50000, issuedById: 'admin1' }),
      }),
    );
  });

  it('rejects a fine for a non-existent driver', async () => {
    const { service } = makeService({ driverExists: false });
    await expect(
      service.create({ driver_id: 'missing', amount: 1000, reason: 'x' }, 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a fine tied to a non-existent order', async () => {
    const { service } = makeService({ orderExists: false });
    await expect(
      service.create({ driver_id: 'drv1', amount: 1000, reason: 'x', order_id: 'missing' }, 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters the list by driver and date range', async () => {
    const { service, prisma } = makeService();
    await service.list({ driver_id: 'drv1', from: '2026-01-01', to: '2026-01-31' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (prisma.fine as any).findMany.mock.calls[0][0];
    expect(arg.where.driverId).toBe('drv1');
    // A calendar day is a Tashkent day (UTC+5): 1 Jan 00:00 there is 31 Dec 19:00 UTC.
    expect(arg.where.createdAt.gte).toEqual(new Date('2025-12-31T19:00:00.000Z'));
    // `to` is exclusive of the next day.
    expect(arg.where.createdAt.lt).toEqual(new Date('2026-01-31T19:00:00.000Z'));
  });

  it('throws when updating a missing fine', async () => {
    const { service } = makeService({ fineById: null });
    await expect(service.update('nope', { amount: 100 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes an existing fine', async () => {
    const { service, prisma } = makeService();
    const res = await service.remove('f1');
    expect(res).toEqual({ deleted: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.fine as any).delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
  });
});

describe('pay period lock (owner, 07.11.2026)', () => {
  it('a fine issued in a locked period cannot be changed or removed', async () => {
    const { service, prisma } = makeService({ fineById: fine({ createdAt: new Date('2026-01-10T05:00:00Z') }) });
    await expect(service.update('f1', { amount: 1 })).rejects.toThrow('period_locked');
    await expect(service.remove('f1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.fine.update).not.toHaveBeenCalled();
    expect(prisma.fine.delete).not.toHaveBeenCalled();
  });

  it('a fine of the current period is changed as before', async () => {
    const { service, prisma } = makeService();
    await service.update('f1', { amount: 1 });
    expect(prisma.fine.update).toHaveBeenCalled();
  });
});
