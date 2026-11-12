import { OrdersService } from './orders.service';

function makePrisma(orderForPickup?: Record<string, unknown>) {
  return {
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(orderForPickup ?? null),
    },
    driver: { findUnique: jest.fn().mockResolvedValue({ id: 'drvX', userId: 'u-d' }) },
  };
}

function svc(prisma: ReturnType<typeof makePrisma>) {
  const bonus = { accrueForDelivery: jest.fn() };
  const realtime = { orderStatusChanged: jest.fn(), driverStatusChanged: jest.fn() };
  const vozvrat = { deliver: jest.fn() };
   
  // Which of the client's places an order is for; its own spec covers the rule.
  const clientAddresses = { forOrder: jest.fn().mockResolvedValue(null) };
  return new OrdersService(prisma as any, bonus as any, realtime as any, vozvrat as any, clientAddresses as any, { notify: jest.fn().mockResolvedValue(undefined) } as any);
}

function whereOf(prisma: ReturnType<typeof makePrisma>) {
  return prisma.order.findMany.mock.calls[0][0].where;
}

describe('OrdersService list filters (§16)', () => {
  it('maps an admin status filter to where.status', async () => {
    const prisma = makePrisma();
    await svc(prisma).findAllForActor({ userId: 'a', role: 'admin' }, { status: 'delivered' });
    expect(whereOf(prisma)).toEqual({ status: 'delivered' });
  });

  it('finds both legacy problem statuses and non-terminal exception reports', async () => {
    const prisma = makePrisma();
    await svc(prisma).findAllForActor({ userId: 'a', role: 'admin' }, { problem: true });
    expect(whereOf(prisma)).toEqual({
      OR: [{ status: 'problem' }, { problemReason: { not: null } }],
    });
  });

  it('restricts a seller to their own orders', async () => {
    const prisma = makePrisma();
    await svc(prisma).findAllForActor({ userId: 's1', role: 'seller' }, {});
    expect(whereOf(prisma)).toEqual({ createdBySellerId: 's1' });
  });

  it('restricts a driver to assigned orders', async () => {
    const prisma = makePrisma();
    await svc(prisma).findAllForActor({ userId: 'u-d', role: 'driver' }, {});
    expect(whereOf(prisma)).toEqual({ assignedDriverId: 'drvX' });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'asc' }, { orderNumber: 'asc' }],
      }),
    );
  });

  it('keeps admin and seller order lists newest-first', async () => {
    for (const actor of [{ userId: 'a', role: 'admin' }, { userId: 's1', role: 'seller' }] as const) {
      const prisma = makePrisma();
      await svc(prisma).findAllForActor(actor, {});
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { orderNumber: 'desc' }],
        }),
      );
    }
  });

  it('lets a manager filter by seller_id and driver_id (manager is a full admin)', async () => {
    const prisma = makePrisma();
    await svc(prisma).findAllForActor(
      { userId: 'm1', role: 'manager' },
      { seller_id: 's9', driver_id: 'd9' },
    );
    expect(whereOf(prisma)).toEqual({ createdBySellerId: 's9', assignedDriverId: 'd9' });
  });

  it('ignores seller_id/driver_id for a seller (scope stays their own)', async () => {
    const prisma = makePrisma();
    await svc(prisma).findAllForActor(
      { userId: 's1', role: 'seller' },
      { seller_id: 'someoneElse', driver_id: 'd9' },
    );
    expect(whereOf(prisma)).toEqual({ createdBySellerId: 's1' });
  });

  it('filters by client_id within the actor scope (allowed for any role)', async () => {
    const prisma = makePrisma();
    await svc(prisma).findAllForActor({ userId: 's1', role: 'seller' }, { client_id: 'c9' });
    expect(whereOf(prisma)).toEqual({ createdBySellerId: 's1', clientId: 'c9' });
  });

  it('supports client phone search and a delivery-date day range', async () => {
    const prisma = makePrisma();
    await svc(prisma).findAllForActor(
      { userId: 'a', role: 'admin' },
      { client_phone: '998', delivery_date: '2026-06-25' },
    );
    const where = whereOf(prisma);
    expect(where.clientPhoneNumber).toEqual({ contains: '998' });
    expect(where.deliveryDatetime.gte).toBeInstanceOf(Date);
    expect(where.deliveryDatetime.lt).toBeInstanceOf(Date);
  });

});
