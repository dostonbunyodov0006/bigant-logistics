import { ConflictException, NotFoundException } from '@nestjs/common';
import { LeaveService } from './leave.service';

function leave(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lr1',
    driverId: 'drv1',
    type: 'vacation',
    startDate: new Date('2026-08-01T00:00:00.000Z'),
    endDate: new Date('2026-08-05T00:00:00.000Z'),
    reason: 'Family trip',
    status: 'pending',
    reviewedById: null,
    reviewNote: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    driver: { user: { name: 'Hamza' } },
    reviewedBy: null,
    ...overrides,
  };
}

function makeService(
  opts: { driver?: { id: string; userId: string } | null; existing?: unknown; staff?: { id: string }[] } = {},
) {
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyMany: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    driver: {
      findUnique: jest.fn().mockResolvedValue(
        'driver' in opts ? opts.driver : { id: 'drv1', userId: 'u-driver' },
      ),
    },
    user: {
      findMany: jest.fn().mockResolvedValue(opts.staff ?? [{ id: 'admin1' }, { id: 'mgr1' }]),
    },
    leaveRequest: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(leave(data)),
      ),
      findMany: jest.fn().mockResolvedValue([leave()]),
      findUnique: jest.fn().mockResolvedValue('existing' in opts ? opts.existing : leave()),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(leave({ ...data })),
      ),
      // review() claims the request with a conditional update and reads it back.
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimed ?? 1 }),
      findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve(leave({ status: 'approved' }))),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new LeaveService(prisma as any, notifications as any), prisma, notifications };
}

const INPUT = { type: 'vacation' as const, start_date: '2026-08-01', end_date: '2026-08-05', reason: 'Trip' };

describe('LeaveService', () => {
  it('the office enters a leave: approved as written, the driver is told', async () => {
    const { service, prisma, notifications } = makeService();
    const res = await service.grant({ ...INPUT, driver_id: 'drv1' }, 'admin1');
    expect(res.status).toBe('approved');
    expect(res.start_date).toBe('2026-08-01');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.leaveRequest as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driverId: 'drv1', type: 'vacation', status: 'approved', reviewedById: 'admin1' }),
      }),
    );
    expect(notifications.notify).toHaveBeenCalledWith('u-driver', expect.objectContaining({ type: 'leave.decided' }));
  });

  it('refuses a leave for a driver that does not exist', async () => {
    const { service } = makeService({ driver: null });
    await expect(service.grant({ ...INPUT, driver_id: 'nope' }, 'admin1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('approves a pending request and notifies the driver', async () => {
    const { service, prisma, notifications } = makeService();
    await service.review('lr1', { status: 'approved', review_note: 'ok' }, 'admin1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.leaveRequest as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Conditional on purpose: only a request still pending can be decided.
        where: { id: 'lr1', status: 'pending' },
        data: expect.objectContaining({ status: 'approved', reviewedById: 'admin1' }),
      }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      'u-driver',
      expect.objectContaining({ type: 'leave.decided' }),
    );
  });

  it('rejects reviewing a request that is not pending', async () => {
    const { service } = makeService({ existing: leave({ status: 'approved' }) });
    await expect(
      service.review('lr1', { status: 'rejected' }, 'admin1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws when reviewing a missing request', async () => {
    const { service } = makeService({ existing: null });
    await expect(
      service.review('nope', { status: 'approved' }, 'admin1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters listAll by status and driver', async () => {
    const { service, prisma } = makeService();
    await service.listAll({ status: 'pending', driver_id: 'drv1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (prisma.leaveRequest as any).findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: 'pending', driverId: 'drv1' });
  });
});
