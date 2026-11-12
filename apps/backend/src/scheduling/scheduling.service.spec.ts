import { ConflictException, ForbiddenException } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    orderId: 'o1',
    driverId: 'drv1',
    deliveryDatetime: new Date('2026-06-25T17:00:00.000Z'),
    assignmentStatus: 'pending_driver_response',
    startTime: null,
    estimatedFinishTime: null,
    createdById: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrisma(opts: {
  offShift?: boolean;
  order?: Record<string, unknown> | null;
  driver?: { id: string; userId: string };
  /** The stored driver row, when a test cares about his status or his break. */
  driverRow?: Record<string, unknown>;
  /** The orders he is holding, as the status rules read them. */
  ordersAboard?: Record<string, unknown>[];
  assignment?: Record<string, unknown> | null;
  clashes?: unknown[];
}) {
  const created = assignment();
  const prisma: Record<string, unknown> = {
    driverBreak: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    order: {
      findUnique: jest.fn().mockResolvedValue(opts.order ?? null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      // What the driver is left holding — the status rules read the rows.
      // "What else is he holding" asks with this order left out; the status
      // settler asks for everything, this order included.
      findMany: jest
        .fn()
        .mockImplementation((args?: { where?: { id?: { not?: string } } }) =>
          Promise.resolve(args?.where?.id?.not ? [] : (opts.ordersAboard ?? [])),
        ),
    },
    driver: {
      findUnique: jest
        .fn()
        .mockImplementation(({ select }: { select?: Record<string, unknown> }) =>
          Promise.resolve(
            select?.breakStartedAt || select?.currentStatus
              ? (opts.driverRow ?? { currentStatus: 'available', breakStartedAt: null, breakUntil: null })
              : (opts.driver ?? { id: 'drv1', userId: 'u-d' }),
          ),
        ),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    // An open shift unless the test says he is off: he pressed Ish boshlandi.
    workLog: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), count: jest.fn().mockResolvedValue(opts.offShift ? 0 : 1) },
    driverAssignment: {
      findUnique: jest.fn().mockResolvedValue(opts.assignment ?? null),
      findMany: jest.fn().mockResolvedValue(opts.clashes ?? []),
      create: jest.fn().mockResolvedValue(created),
      update: jest.fn().mockResolvedValue(created),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(opts.assignment ?? created),
    },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  return prisma;
}

function svc(prisma: Record<string, unknown>) {
  const config = { get: () => 90 };
  const realtime = { orderStatusChanged: jest.fn(), driverStatusChanged: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new SchedulingService(prisma as any, realtime as any, config as any);
}

const admin = { userId: 'admin', role: 'admin' as const };
const driver = { userId: 'u-d', role: 'driver' as const };

describe('SchedulingService', () => {
  it('assigns and surfaces a non-blocking conflict warning', async () => {
    const prisma = makePrisma({
      order: {
        id: 'o1',
        status: 'created',
        createdBySellerId: 's1',
        deliveryDatetime: new Date('2026-06-25T17:00:00.000Z'),
      },
      clashes: [
        {
          id: 'a0',
          orderId: 'o0',
          deliveryDatetime: new Date('2026-06-25T17:30:00.000Z'),
          order: { orderNumber: 5 },
        },
      ],
    });
    const result = await svc(prisma).assign('o1', 'drv1', admin);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].order_number).toBe(5);
    expect(result.assignment.assignment_status).toBe('pending_driver_response');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { assignedDriverId: 'drv1', status: 'assigned_to_driver', idleWatchSince: null, idleStartMetres: null, idleState: null },
      }),
    );
  });

  it('a binding assignment is accepted on the spot: no driver accept step', async () => {
    const prisma = makePrisma({ order: { id: 'o1', status: 'created', deliveryDatetime: new Date(), createdBySellerId: 's1' } });
    const seller = { userId: 's1', role: 'seller' as const };
    await svc(prisma).assign('o1', 'drv1', seller, { binding: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverAssignment as any).create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignmentStatus: 'accepted' }) }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'driver_accepted' }) }),
    );
  });

  it('refuses to assign an order that is already delivered', async () => {
    const prisma = makePrisma({
      order: {
        id: 'o1',
        status: 'delivered',
        createdBySellerId: 's1',
        deliveryDatetime: new Date(),
      },
    });
    await expect(svc(prisma).assign('o1', 'drv1', admin)).rejects.toBeInstanceOf(ConflictException);
  });

  it("forbids a seller from assigning on another seller's order", async () => {
    const prisma = makePrisma({
      order: {
        id: 'o1',
        status: 'created',
        createdBySellerId: 'sellerA',
        deliveryDatetime: new Date(),
      },
    });
    await expect(
      svc(prisma).assign('o1', 'drv1', { userId: 'sellerB', role: 'seller' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an offer cannot be accepted or rejected off shift, and nothing changes', async () => {
    const prisma = makePrisma({ assignment: assignment(), offShift: true });
    await expect(svc(prisma).accept('a1', driver)).rejects.toThrow('shift_not_started');
    await expect(svc(prisma).reject('a1', driver)).rejects.toThrow('shift_not_started');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverAssignment as any).updateMany).not.toHaveBeenCalled();
  });

  it('lets the assigned driver accept, moving the order to driver_accepted', async () => {
    const prisma = makePrisma({ assignment: assignment() });
    await svc(prisma).accept('a1', driver);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverAssignment as any).updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', assignmentStatus: 'pending_driver_response' },
      data: { assignmentStatus: 'accepted' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', status: 'assigned_to_driver', assignedDriverId: 'drv1' },
      data: { status: 'driver_accepted' },
    });
  });

  it('ends a running break when the driver accepts, crediting what he took', async () => {
    const prisma = makePrisma({
      assignment: assignment(),
      driverRow: {
        currentStatus: 'available',
        breakStartedAt: new Date(Date.now() - 30 * 60_000),
        breakUntil: new Date(Date.now() + 30 * 60_000),
      },
      ordersAboard: [{ status: 'driver_accepted', bookingKind: null, deliveryDatetime: new Date() }],
    });
    await svc(prisma).accept('a1', driver);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).updateMany).toHaveBeenCalledWith({
      where: { driverId: 'drv1', clockOutAt: null },
      data: { breakMinutes: { increment: 30 } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).update).toHaveBeenCalledWith({
      where: { id: 'drv1' },
      data: { breakUntil: null, breakStartedAt: null },
    });
  });

  it('does not bring a clocked-out driver back online by accepting', async () => {
    const prisma = makePrisma({
      assignment: assignment(),
      driverRow: { currentStatus: 'offline', breakStartedAt: null, breakUntil: null },
      ordersAboard: [{ status: 'driver_accepted', bookingKind: null, deliveryDatetime: new Date() }],
    });
    await svc(prisma).accept('a1', driver);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusWrites = (prisma.driver as any).update.mock.calls.filter(
      (call: [{ data?: { currentStatus?: string } }]) => call[0]?.data?.currentStatus !== undefined,
    );
    expect(statusWrites).toHaveLength(0);
  });

  it('a double tap on accept finds nothing pending and is refused', async () => {
    const prisma = makePrisma({ assignment: assignment() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.driverAssignment as any).updateMany.mockResolvedValue({ count: 0 });
    await expect(svc(prisma).accept('a1', driver)).rejects.toBeInstanceOf(ConflictException);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).not.toHaveBeenCalled();
  });

  it('rejects accepting an assignment that is not pending', async () => {
    const prisma = makePrisma({ assignment: assignment({ assignmentStatus: 'accepted' }) });
    await expect(svc(prisma).accept('a1', driver)).rejects.toBeInstanceOf(ConflictException);
  });

  it('forbids acting on an assignment that belongs to another driver', async () => {
    const prisma = makePrisma({ assignment: assignment({ driverId: 'someoneElse' }) });
    await expect(svc(prisma).reject('a1', driver)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('auto-rejects a stale pending assignment and returns the order to the pool', async () => {
    const prisma = makePrisma({
      assignment: assignment(), // findUnique inside the tx → still pending
      clashes: [{ id: 'a1', orderId: 'o1', driverId: 'drv1' }], // findMany → stale list
    });
    const count = await svc(prisma).expireStaleAssignments(10);
    expect(count).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverAssignment as any).update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { assignmentStatus: 'rejected' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.outboxEvent as any).create).toHaveBeenCalled();
  });

  it('skips a stale assignment that was answered just before the sweep', async () => {
    const prisma = makePrisma({
      assignment: assignment({ assignmentStatus: 'accepted' }), // re-check finds it answered
      clashes: [{ id: 'a1', orderId: 'o1', driverId: 'drv1' }],
    });
    const count = await svc(prisma).expireStaleAssignments(10);
    expect(count).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverAssignment as any).update).not.toHaveBeenCalled();
  });

  it('only returns active drivers in availability', async () => {
    const prisma = makePrisma({});

    await svc(prisma).availability();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user: { status: 'active' } } }),
    );
  });
});

describe('SchedulingService — status across days and shifts', () => {
  // 27.09 10:00 Tashkent.
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-09-27T05:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  it("tomorrow's Ertangi booking does not stop the driver accepting today's order", async () => {
    const prisma = makePrisma({ assignment: assignment() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([
      { status: 'driver_accepted', bookingKind: 'bron', deliveryDatetime: new Date('2026-09-28T00:00:00Z') },
    ]);
    await expect(svc(prisma).accept('a1', driver)).resolves.toBeDefined();
  });

  it("yesterday's unfinished order still does", async () => {
    const prisma = makePrisma({ assignment: assignment() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([
      { status: 'collecting_items', bookingKind: null, deliveryDatetime: new Date('2026-09-26T06:00:00Z') },
    ]);
    await expect(svc(prisma).accept('a1', driver)).rejects.toThrow('driver_has_active_order');
  });

  it('an unanswered offer timing out leaves a clocked-out driver off shift', async () => {
    const prisma = makePrisma({ assignment: assignment(), clashes: [{ id: 'a1', orderId: 'o1', driverId: 'drv1' }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.driver as any).findUnique.mockResolvedValue({ id: 'drv1', userId: 'u-d', currentStatus: 'offline' });
    expect(await svc(prisma).expireStaleAssignments(10)).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).update).not.toHaveBeenCalled();
  });
});

/**
 * The case that used to strand an order: a driver clocks out with goods in the
 * van ("not today"), then does not come in. Every action on that order asks
 * for him, so nobody could move it — the cargo was unreachable until he
 * returned. The office can now hand it on; the new driver picks it up where it
 * stands.
 */
describe('SchedulingService — an order whose driver is not coming', () => {
  const inProgress = {
    id: 'o1',
    status: 'collecting_items',
    assignedDriverId: 'drv-away',
    createdBySellerId: 's1',
    deliveryDatetime: new Date('2026-10-20T09:00:00Z'),
  };

  function make(openShifts: number) {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(inProgress),
        update: jest.fn().mockResolvedValue(inProgress),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // settleDriverStatus re-derives the old driver's status from what is
        // still aboard; with the journey moved away, nothing is.
        findMany: jest.fn().mockResolvedValue([]),
      },
      driver: {
        findUnique: jest.fn().mockResolvedValue({ id: 'drv-new', currentStatus: 'available' }),
        update: jest.fn().mockResolvedValue({}),
      },
      workLog: { count: jest.fn().mockResolvedValue(openShifts) },
      driverAssignment: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'a2', ...data, createdAt: new Date(), updatedAt: new Date(), estimatedFinishTime: null }),
        ),
      },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn().mockImplementation((fn: any) => fn(prisma)),
    };
    const realtime = { orderStatusChanged: jest.fn(), driverStatusChanged: jest.fn() };
    const config = { get: jest.fn().mockReturnValue(90) };
    return {
      prisma,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc: new SchedulingService(prisma as any, realtime as any, config as any),
    };
  }

  const admin = { userId: 'a1', role: 'admin' as const };
  const seller = { userId: 's1', role: 'seller' as const };

  it('the office may move it when the driver has no open shift', async () => {
    const { svc, prisma } = make(0);
    const res = await svc.assign('o1', 'drv-new', admin);
    expect(res.assignment.driver_id).toBe('drv-new');
    expect(prisma.workLog.count).toHaveBeenCalled();
  });

  it('a driver who is on shift keeps his journey', async () => {
    const { svc } = make(1);
    await expect(svc.assign('o1', 'drv-new', admin)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a seller cannot take a journey off a driver', async () => {
    const { svc } = make(0);
    await expect(svc.assign('o1', 'drv-new', seller)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SchedulingService.assign racing the driver (audit, 07.11.2026)', () => {
  it('claims the order as it was read, and refuses when it moved meanwhile', async () => {
    const prisma = makePrisma({ order: { id: 'o1', status: 'assigned_to_driver', assignedDriverId: 'drv0', deliveryDatetime: new Date(), createdBySellerId: 's1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order = prisma.order as any;
    order.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc(prisma).assign('o1', 'drv1', admin)).rejects.toThrow('order_already_in_progress');
    expect(order.updateMany.mock.calls[0][0].where).toEqual({ id: 'o1', status: 'assigned_to_driver', assignedDriverId: 'drv0' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverAssignment as any).create).not.toHaveBeenCalled();
  });
});
