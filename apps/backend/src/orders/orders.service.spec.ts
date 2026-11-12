import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';

function item(id: string, collectionStatus: string) {
  return {
    id,
    productName: 'Hammer',
    quantity: 1,
    pickupPlaceId: 'pp1',
    pickupPlaceName: 'A warehouse',
    collectionStatus,
    problemReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function pickup(
  id: string,
  position: number,
  legStatus: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    pickupPlaceId: 'pp-' + id,
    name: 'Place ' + id,
    position,
    legStatus,
    loadPhotoUrl: null,
    returnRequired: false,
    returnDestination: null,
    returnStage: null,
    returnProofPhotoUrl: null,
    returnedAt: null,
    region: { name: 'Toshkent', isCity: true },
    geoDistrict: null,
    ...overrides,
  };
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    orderNumber: 1,
    clientId: 'c1',
    clientName: 'Akmal',
    clientPhoneNumber: '+998900000000',
    clientAddress: 'Tashkent',
    deliveryDatetime: new Date(),
    bookingKind: null,
    comment: null,
    priority: 'normal',
    status: 'driver_accepted',
    problemReason: null,
    problemComment: null,
    cancellationReason: null,
    proofPhotoUrl: null,
    createdBySellerId: 's1',
    createdBySeller: { name: 'Bekzod', phoneNumber: '+998901234567' },
    assignedDriverId: 'drv1',
    assignedDriver: { user: { name: 'Hamza' } },
    region: { name: 'Toshkent', isCity: true },
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [item('i1', 'pending'), item('i2', 'pending')],
    pickupSources: [pickup('ps1', 0, 'pending')],
    ...overrides,
  };
}

function makePrisma(
  order: ReturnType<typeof makeOrder>,
  opts: {
    itemsAfter?: unknown[];
    driver?: Record<string, unknown>;
    pickupsRemaining?: number;
    /** The driver's OTHER open orders, as the status rules see them. */
    aboard?: { status: string; bookingKind: string | null; deliveryDatetime: Date }[];
    /** Rows already recorded for this order's return, for the second-submit case. */
    returnItemsWritten?: number;
    /** The written-up rows themselves, for the seller's check. */
    returnItemRows?: Record<string, unknown>[];
    /** No open shift: he has not pressed Ish boshlandi. */
    offShift?: boolean;
  } = {},
) {
  const prisma: Record<string, unknown> = {
    order: {
      findUnique: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockResolvedValue(order),
      // Read back after a conditional write, to return what the caller shows.
      findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      // Conditional writes — "only if the order is still where I read it".
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      // The driver-status rule reads status + timing of what else he carries;
      // every other query (the trip cursor, lists) gets the order itself.
      findMany: jest
        .fn()
        .mockImplementation((args?: { select?: { bookingKind?: unknown; pickupSources?: unknown } }) =>
          Promise.resolve(args?.select?.bookingKind && !args.select.pickupSources ? (opts.aboard ?? []) : [order]),
        ),
      count: jest.fn().mockResolvedValue(0),
    },
    orderItem: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(opts.itemsAfter ?? order.items),
    },
    orderPickupSource: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(opts.pickupsRemaining ?? 0),
      // cancel() reads the stops again inside its transaction, so a driver
      // loading at the same moment is not decided on a stale read.
      findMany: jest.fn().mockResolvedValue(order.pickupSources ?? []),
    },
    orderItemQuantityAudit: { create: jest.fn().mockResolvedValue({}) },
    driverAssignment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    orderReturnItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      // Nothing written up yet, unless a test says otherwise.
      count: jest.fn().mockResolvedValue(opts.returnItemsWritten ?? 0),
      findMany: jest.fn().mockResolvedValue(opts.returnItemRows ?? []),
    },
    vozvratReport: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    driverTariffEarning: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    vehicleTariff: {
      findUnique: jest.fn().mockResolvedValue({
        pickupCitySom: 10,
        pickupOutsideSom: 20,
        deliveryCitySom: 100,
        deliveryOutsideSom: 200,
      }),
    },
    driver: {
      findUnique: jest.fn().mockResolvedValue(
        opts.driver ?? { id: 'drv1', userId: 'u-driver', vehicle: { category: 'katta' } },
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    // An open shift: the driver has pressed Ish boshlandi.
    workLog: { count: jest.fn().mockResolvedValue(opts.offShift ? 0 : 1) },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  return prisma;
}

function svc(
  prisma: Record<string, unknown>,
  vozvrat: { deliver: jest.Mock } = { deliver: jest.fn().mockResolvedValue('sent') },
) {
  const bonus = { accrueForDelivery: jest.fn().mockResolvedValue(undefined) };
  const realtime = { orderStatusChanged: jest.fn(), driverStatusChanged: jest.fn() };
   
  // Which of the client's places an order is for; its own spec covers the rule.
  const clientAddresses = { forOrder: jest.fn().mockResolvedValue(null) };
  return new OrdersService(prisma as any, bonus as any, realtime as any, vozvrat as any, clientAddresses as any, { notify: jest.fn().mockResolvedValue(undefined) } as any);
}

const driver = { userId: 'u-driver', role: 'driver' as const };

describe('OrdersService', () => {
  it('includes the booking seller name and phone in the order response', async () => {
    const prisma = makePrisma(makeOrder());
    const [order] = await svc(prisma).findAllForActor(driver, {});

    expect(order).toMatchObject({
      created_by_seller_name: 'Bekzod',
      created_by_seller_phone_number: '+998901234567',
      actions_available_at: null,
    });
  });

  it('publishes 00:01 Tashkent as the activation time for a future seller booking', async () => {
    const prisma = makePrisma(
      makeOrder({
        bookingKind: 'zanyat',
        deliveryDatetime: new Date('2099-01-02T00:00:00.000Z'),
      }),
    );

    const order = await svc(prisma).findOneForActor('o1', driver);

    expect(order.actions_available_at).toBe('2099-01-01T19:01:00.000Z');
  });

  it('returns a page of orders plus the total count', async () => {
    const prisma = makePrisma(makeOrder({ status: 'delivered' }));
    (prisma.order as { count: jest.Mock }).count.mockResolvedValueOnce(7);
    const res = await svc(prisma).findPageForActor(
      { userId: 'admin', role: 'admin' },
      { driver_id: 'drv1', skip: 5, take: 5 },
    );
    expect(res.total).toBe(7);
    expect(res.items).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
  });

  it('paginates driver orders oldest-first', async () => {
    const prisma = makePrisma(makeOrder());
    await svc(prisma).findPageForActor(driver, { skip: 0, take: 10 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'asc' }, { orderNumber: 'asc' }],
      }),
    );
  });

  it('rejects cancelling a delivered order', async () => {
    const prisma = makePrisma(makeOrder({ status: 'delivered' }));
    await expect(
      svc(prisma).cancel('o1', 'reason', { userId: 'admin', role: 'admin' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("forbids a seller from cancelling another seller's order", async () => {
    const prisma = makePrisma(makeOrder({ status: 'created', createdBySellerId: 'sellerA' }));
    await expect(
      svc(prisma).cancel('o1', 'reason', { userId: 'sellerB', role: 'seller' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cancels with a reason for the owning seller', async () => {
    const prisma = makePrisma(makeOrder({ status: 'created', createdBySellerId: 's1' }));
    await svc(prisma).cancel('o1', 'client changed mind', { userId: 's1', role: 'seller' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany.mock.calls[0][0].data).toEqual({
      status: 'cancelled',
      cancellationReason: 'client changed mind',
    });
  });

  it('credits an en-route pickup then cancels without Vozvrat when no goods were collected', async () => {
    const prisma = makePrisma(
      makeOrder({
        status: 'collecting_items',
        pickupSources: [pickup('ps1', 0, 'en_route')],
      }),
    );
    await svc(prisma).cancel('o1', 'client cancelled', { userId: 's1', role: 'seller' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverTariffEarning as any).createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventKey: 'pickup:ps1', amount: 10 }),
        skipDuplicates: true,
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'cancelled', cancellationReason: 'client cancelled' },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).update).not.toHaveBeenCalled();
  });

  /**
   * Trip positions are what make two orders one journey. They outlive neither
   * order on their own, so cancelling one has to unpick them — otherwise the
   * survivor's stops stay numbered against a trip that is no longer driven.
   */
  describe('cancelling out of a po puti trip', () => {
    const merged = (over: Record<string, unknown> = {}) =>
      makeOrder({
        status: 'driver_accepted',
        deliveryTripPosition: 2,
        pickupSources: [pickup('ps1', 0, 'pending', { tripPosition: 0 })],
        ...over,
      });

    it('leaves an ordinary order alone — nothing to unpick', async () => {
      const prisma = makePrisma(makeOrder({ status: 'driver_accepted' }));
      await svc(prisma).cancel('o1', 'client cancelled', { userId: 's1', role: 'seller' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.orderPickupSource as any).updateMany).not.toHaveBeenCalled();
    });

    it('clears the leaver, and the one order left behind with it', async () => {
      const prisma = makePrisma(merged());
      // The co-load is the only order still holding positions.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.order as any).findMany.mockResolvedValue([{ id: 'o2' }]);

      await svc(prisma).cancel('o1', 'client cancelled', { userId: 's1', role: 'seller' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleared = (prisma.orderPickupSource as any).updateMany.mock.calls.map(
        (c: [{ where: { orderId: string } }]) => c[0].where.orderId,
      );
      expect(cleared).toEqual(['o1', 'o2']);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.order as any).update).toHaveBeenCalledWith({
        where: { id: 'o2' },
        data: { deliveryTripPosition: null },
      });
    });

    it('keeps the trip intact when two orders are still riding together', async () => {
      const prisma = makePrisma(merged());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.order as any).findMany.mockResolvedValue([{ id: 'o2' }, { id: 'o3' }]);

      await svc(prisma).cancel('o1', 'client cancelled', { userId: 's1', role: 'seller' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleared = (prisma.orderPickupSource as any).updateMany.mock.calls.map(
        (c: [{ where: { orderId: string } }]) => c[0].where.orderId,
      );
      expect(cleared).toEqual(['o1']);
    });
  });

  it('returns only collected goods when cancellation happens en route to the next pickup', async () => {
    const prisma = makePrisma(
      makeOrder({
        status: 'collecting_items',
        pickupSources: [
          pickup('ps1', 0, 'arrived'),
          pickup('ps2', 1, 'en_route'),
        ],
      }),
    );
    await svc(prisma).cancel('o1', 'client cancelled', { userId: 's1', role: 'seller' });

    // The trip to the second pickup is paid even though its goods were not collected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverTariffEarning as any).createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventKey: 'pickup:ps2' }),
      }),
    );
    // Only goods already collected at the first pickup enter Vozvrat.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).update).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).update).toHaveBeenCalledWith({
      where: { id: 'ps1' },
      data: {
        returnRequired: true,
        returnDestination: null,
        returnStage: null,
        returnProofPhotoUrl: null,
        returnedAt: null,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'returning',
          cancellationReason: 'client cancelled',
        }),
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverAssignment as any).updateMany).not.toHaveBeenCalled();
  });

  it('forbids a non-assigned driver from advancing the journey', async () => {
    const prisma = makePrisma(
      makeOrder({ status: 'driver_accepted', assignedDriverId: 'someoneElse' }),
    );
    await expect(svc(prisma).departToPickup('o1', 'ps1', driver)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks journey actions before 00:01 Tashkent on the scheduled day', async () => {
    const prisma = makePrisma(
      makeOrder({
        bookingKind: 'bron',
        deliveryDatetime: new Date('2099-01-02T00:00:00.000Z'),
      }),
    );

    await expect(svc(prisma).departToPickup('o1', 'ps1', driver)).rejects.toThrow(
      'order_actions_not_available_yet',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).update).not.toHaveBeenCalled();
  });

  // --- Place-based journey (Option A) ---

  it('departing to the first pickup flips the order into collecting_items', async () => {
    const prisma = makePrisma(
      makeOrder({ status: 'driver_accepted', pickupSources: [pickup('ps1', 0, 'pending')] }),
    );
    await svc(prisma).departToPickup('o1', 'ps1', driver);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).update).toHaveBeenCalledWith({
      where: { id: 'ps1' },
      data: { legStatus: 'en_route' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'collecting_items', journeyStartedAt: expect.any(Date) },
      }),
    );
  });

  it('will not start the next order while another is under way', async () => {
    const prisma = makePrisma(
      makeOrder({ status: 'driver_accepted', pickupSources: [pickup('ps1', 0, 'pending')] }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = (prisma.order as any).findMany.getMockImplementation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockImplementation((args?: { select?: { deliveryTripPosition?: unknown; pickupSources?: unknown } }) =>
      args?.select?.deliveryTripPosition && !args.select.pickupSources ? Promise.resolve([{ id: 'o-busy', deliveryTripPosition: null }]) : base(args),
    );
    await expect(svc(prisma).departToPickup('o1', 'ps1', driver)).rejects.toMatchObject({
      message: 'finish_current_order_first',
    });
  });

  it('lets a po puti co-load set off beside the order it rides with', async () => {
    const order = makeOrder({ status: 'driver_accepted', deliveryTripPosition: 3, pickupSources: [pickup('ps1', 0, 'pending')] });
    const prisma = makePrisma(order);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = (prisma.order as any).findMany.getMockImplementation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockImplementation((args?: { select?: { deliveryTripPosition?: unknown; pickupSources?: unknown } }) =>
      args?.select?.deliveryTripPosition && !args.select.pickupSources ? Promise.resolve([{ id: 'o-host', deliveryTripPosition: 1 }]) : base(args),
    );
    await expect(svc(prisma).departToPickup('o1', 'ps1', driver)).resolves.toBeDefined();
  });

  it('rejects departing to a pickup out of position order', async () => {
    const prisma = makePrisma(
      makeOrder({
        status: 'collecting_items',
        pickupSources: [pickup('ps1', 0, 'pending'), pickup('ps2', 1, 'pending')],
      }),
    );
    await expect(svc(prisma).departToPickup('o1', 'ps2', driver)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('arriving at the last pickup advances to items_collected', async () => {
    const prisma = makePrisma(
      makeOrder({ status: 'collecting_items', pickupSources: [pickup('ps1', 0, 'en_route')] }),
      { pickupsRemaining: 0 },
    );
    await svc(prisma).arriveAtPickup(
      'o1',
      'ps1',
      driver,
      'https://example.com/load.jpg',
      'Qutilar tekshirildi',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'items_collected' } }),
    );
    // The loaded-goods photo is saved on the stop…
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { legStatus: 'arrived', loadPhotoUrl: 'https://example.com/load.jpg' },
      }),
    );
    // …and a pickup_loaded event is emitted for the Telegram post.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.outboxEvent as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'order.pickup_loaded',
          payload: expect.objectContaining({ comment: 'Qutilar tekshirildi' }),
        }),
      }),
    );
  });

  it('confirms Yuk olindi with a photo and credits pickup pay immediately', async () => {
    const prisma = makePrisma(
      makeOrder({ status: 'collecting_items', pickupSources: [pickup('ps1', 0, 'en_route')] }),
      { pickupsRemaining: 0 },
    );

    await svc(prisma).arriveAtPickup('o1', 'ps1', driver, 'https://example.com/pickup.jpg');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).update).toHaveBeenCalledWith({
      where: { id: 'ps1' },
      data: { legStatus: 'arrived', loadPhotoUrl: 'https://example.com/pickup.jpg' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverTariffEarning as any).createMany).toHaveBeenCalledWith({
      data: {
        eventKey: 'pickup:ps1',
        type: 'pickup_city',
        amount: 10,
        driverId: 'drv1',
        orderId: 'o1',
        pickupSourceId: 'ps1',
      },
      skipDuplicates: true,
    });
  });

  it('rejects Yuk olindi without a photo and does not credit pickup pay', async () => {
    const prisma = makePrisma(
      makeOrder({ status: 'collecting_items', pickupSources: [pickup('ps1', 0, 'en_route')] }),
    );
    await expect(svc(prisma).arriveAtPickup('o1', 'ps1', driver, '')).rejects.toThrow(
      'pickup_photo_required',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).update).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverTariffEarning as any).createMany).not.toHaveBeenCalled();
  });

  it('refuses any press while the driver is off shift, and changes nothing', async () => {
    const prisma = makePrisma(makeOrder({ status: 'items_collected' }), { offShift: true });

    await expect(svc(prisma).departToCustomer('o1', driver)).rejects.toThrow('shift_not_started');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany ?? (prisma.order as any).update).not.toHaveBeenCalled();
  });

  it('credits delivery pay when the driver starts toward the customer', async () => {
    const prisma = makePrisma(makeOrder({ status: 'items_collected' }));

    await svc(prisma).departToCustomer('o1', driver);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverTariffEarning as any).createMany).toHaveBeenCalledWith({
      data: {
        eventKey: 'delivery:o1',
        type: 'delivery_city',
        amount: 100,
        driverId: 'drv1',
        orderId: 'o1',
      },
      skipDuplicates: true,
    });
  });

  it('keeps collecting_items while earlier pickups remain', async () => {
    const prisma = makePrisma(
      makeOrder({
        status: 'collecting_items',
        pickupSources: [pickup('ps1', 0, 'en_route'), pickup('ps2', 1, 'pending')],
      }),
      { pickupsRemaining: 1 },
    );
    await svc(prisma).arriveAtPickup('o1', 'ps1', driver, 'https://example.com/load.jpg');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusUpdates = (prisma.order as any).updateMany.mock.calls.filter(
      (c: [{ data?: { status?: string } }]) => c[0]?.data?.status,
    );
    expect(statusUpdates).toHaveLength(0);
  });

  it('arriving at the customer moves on_the_way → arrived_at_customer', async () => {
    const prisma = makePrisma(makeOrder({ status: 'on_the_way' }));
    await svc(prisma).arriveAtCustomer('o1', driver);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'arrived_at_customer' } }),
    );
  });

  it('computes next_action = depart_pickup for a fresh accepted order', async () => {
    const prisma = makePrisma(
      makeOrder({ status: 'driver_accepted', pickupSources: [pickup('ps1', 0, 'pending')] }),
    );
    const res = await svc(prisma).findOneForActor('o1', { userId: 'admin', role: 'admin' });
    expect(res.next_action).toEqual({
      type: 'depart_pickup',
      pickup_id: 'ps1',
      pickup_name: 'Place ps1',
      pickup_position: 0,
    });
  });

  it('computes next_action = deliver on the way to the customer, with no arrival step between', async () => {
    for (const status of ['on_the_way', 'arrived_at_customer']) {
      const prisma = makePrisma(makeOrder({ status }));
      const res = await svc(prisma).findOneForActor('o1', { userId: 'admin', role: 'admin' });
      expect(res.next_action.type).toBe('deliver');
    }
  });

  // --- Delivery outcomes (Phase 5) ---

  it('reports an exception without changing the order, driver or assignment', async () => {
    const prisma = makePrisma(makeOrder({ status: 'arrived_at_customer' }));
    const service = svc(prisma);
    await service.reportException(
      'o1',
      { reason: 'client_absent', comment: '10 daqiqa kutdim' },
      driver,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { problemReason: 'client_absent', problemComment: '10 daqiqa kutdim' },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).update).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverAssignment as any).updateMany).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.outboxEvent as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'order.problem',
          payload: expect.objectContaining({ reason: 'client_absent', comment: '10 daqiqa kutdim' }),
        }),
      }),
    );
  });

  it('prevents duplicate exception reports', async () => {
    const prisma = makePrisma(
      makeOrder({ status: 'arrived_at_customer', problemReason: 'client_absent' }),
    );
    await expect(
      svc(prisma).reportException('o1', { reason: 'other', comment: null }, driver),
    ).rejects.toBeInstanceOf(ConflictException);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).not.toHaveBeenCalled();
  });

  it('refuses a second return submit, so a written-up list cannot be replaced', async () => {
    const source = pickup('ps1', 0, 'arrived');
    const prisma = makePrisma(
      makeOrder({ status: 'arrived_at_customer', pickupSources: [source] }),
      // The first submit already recorded what comes back.
      { returnItemsWritten: 2 },
    );
    await expect(
      svc(prisma).startReturn(
        'o1',
        {
          returns: [{ pickup_source_id: 'ps1', destination: 'warehouse' }],
          reason: null,
          items: [{ name: 'Sement', quantity: 1, condition: 'yaroqli', reason: 'm5', photo_url: 'https://cdn.test/a.jpg' }],
        },
        driver,
      ),
    ).rejects.toThrow('return_already_written');
  });

  describe('the place cannot change after the seller confirmed (owner, 07.11.2026)', () => {
    const placesOnly = { returns: [{ pickup_source_id: 'ps1', destination: 'store' as const }], reason: null };

    it('refuses a places-only submit once the write-up is confirmed', async () => {
      const source = pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: 'warehouse' });
      const prisma = makePrisma(
        makeOrder({ status: 'returning', pickupSources: [source], returnItemsConfirmedAt: new Date() }),
        { returnItemsWritten: 2 },
      );
      await expect(svc(prisma).startReturn('o1', placesOnly, driver)).rejects.toThrow('return_already_confirmed');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.orderPickupSource as any).update).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.order as any).updateMany).not.toHaveBeenCalled();
    });

    it('refuses a places-only submit while a written-up list waits for the seller', async () => {
      const source = pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: null });
      const prisma = makePrisma(makeOrder({ status: 'returning', pickupSources: [source] }), {
        returnItemsWritten: 1,
      });
      await expect(svc(prisma).startReturn('o1', placesOnly, driver)).rejects.toThrow('return_already_written');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.orderPickupSource as any).update).not.toHaveBeenCalled();
    });

    it('a seller confirm landing first wins: the conditional move finds nothing', async () => {
      const source = pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: null });
      const prisma = makePrisma(makeOrder({ status: 'returning', pickupSources: [source] }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.order as any).updateMany.mockResolvedValue({ count: 0 });
      await expect(svc(prisma).startReturn('o1', placesOnly, driver)).rejects.toThrow('return_already_started');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'o1', status: 'returning', returnItemsConfirmedAt: null } }),
      );
    });
  });

  it('refuses a return the order has already been moved into', async () => {
    const source = pickup('ps1', 0, 'arrived');
    const prisma = makePrisma(
      makeOrder({ status: 'arrived_at_customer', pickupSources: [source] }),
    );
    // Another submit landed first: the conditional write finds nothing to move.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).updateMany.mockResolvedValue({ count: 0 });
    await expect(
      svc(prisma).startReturn(
        'o1',
        { returns: [{ pickup_source_id: 'ps1', destination: 'warehouse' }], reason: null },
        driver,
      ),
    ).rejects.toThrow('return_already_started');
  });

  it('starts a return while still on the way to the client — the vozvrat sits beside the hand-over', async () => {
    const source = pickup('ps1', 0, 'arrived');
    const prisma = makePrisma(makeOrder({ status: 'on_the_way', pickupSources: [source] }));
    await svc(prisma).startReturn(
      'o1',
      { returns: [{ pickup_source_id: 'ps1', destination: 'warehouse' }], reason: 'refused' },
      driver,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', status: 'on_the_way', returnItemsConfirmedAt: null }, data: expect.objectContaining({ status: 'returning' }) }),
    );
  });

  it("a vozvrat order's write-up on the way to the client moves it to returning", async () => {
    const source = pickup('ps1', 0, 'pending', { returnRequired: true, returnDestination: 'warehouse' });
    const prisma = makePrisma(makeOrder({ status: 'on_the_way', kind: 'vozvrat', pickupSources: [source] }));
    await svc(prisma).startReturn(
      'o1',
      {
        returns: [],
        reason: null,
        items: [{ name: 'Sement', quantity: 1, condition: 'yaroqli', reason: 'm5', photo_url: 'https://cdn.test/a.jpg' }],
      },
      driver,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', status: 'on_the_way', returnItemsConfirmedAt: null }, data: expect.objectContaining({ status: 'returning' }) }),
    );
  });

  it('a vozvrat order on the way to the client goes straight to writing up what comes back', async () => {
    const prisma = makePrisma(makeOrder({ status: 'on_the_way', kind: 'vozvrat' }));
    const res = await svc(prisma).findOneForActor('o1', { userId: 'admin', role: 'admin' });
    expect(res.next_action.type).toBe('collect_return');
  });

  it('starts one return entry per collected pickup and frees the driver', async () => {
    const source = pickup('ps1', 0, 'arrived');
    const prisma = makePrisma(
      makeOrder({ status: 'arrived_at_customer', pickupSources: [source] }),
    );
    await svc(prisma).startReturn(
      'o1',
      {
        returns: [{ pickup_source_id: 'ps1', destination: 'warehouse' }],
        reason: 'refused',
      },
      driver,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).update).toHaveBeenCalledWith({
      where: { id: 'ps1' },
      data: { returnRequired: true, returnDestination: 'warehouse' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'returning',
          returnDestination: 'warehouse',
          returnReason: 'refused',
          returnStage: null,
        },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentStatus: 'available' } }),
    );
  });

  describe('vozvrat report', () => {
    const photo = 'https://cdn.example.com/p.jpg';
    const returning = (seller: { telegramId: string | null } = { telegramId: '100000001' }) => {
      const prisma = makePrisma(
        makeOrder({
          status: 'arrived_at_customer',
          orderNumber: 1042,
          createdBySeller: { name: 'Bekzod', phoneNumber: '+998901234567', telegramId: seller.telegramId },
          pickupSources: [pickup('ps1', 0, 'arrived')],
        }),
      );
      const vozvrat = { deliver: jest.fn().mockResolvedValue('sent') };
      return { prisma, vozvrat, service: svc(prisma, vozvrat) };
    };
    const returns = [{ pickup_source_id: 'ps1', destination: 'warehouse' as const }];

    it('saves the items and the report as the mini app takes it, then sends it', async () => {
      const { prisma, vozvrat, service } = returning();
      await service.startReturn(
        'o1',
        {
          returns,
          reason: 'mijoz olmadi',
          items: [
            { product_id: '417', name: 'Kafel 30x60', unit: 'm2', quantity: 2.5, condition: 'yaroqsiz', reason: 'o1', photo_url: photo },
            { name: 'Sement', quantity: 1, condition: 'yaroqli', reason: 'x', other_reason: 'yomgʻir', culprit: 'haydovchi', photo_url: photo },
          ],
        },
        driver,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (prisma.orderReturnItem as any).createMany.mock.calls[0][0].data;
      expect(rows[0]).toMatchObject({ productId: '417', unit: 'm2', quantity: 2.5, culprit: 'omborchi' });
      expect(rows[1]).toMatchObject({ productId: null, unit: null, culprit: 'haydovchi', otherReason: 'yomgʻir' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = (prisma.vozvratReport as any).upsert.mock.calls[0][0].create.payload;
      expect(payload).toMatchObject({
        id: '1042',
        haydovchi: 'Hamza',
        mijoz: 'Akmal',
        sotuvchi: 'Bekzod',
        sotuvchi_id: 100000001,
        izoh: 'mijoz olmadi',
      });
      expect(payload.tovarlar[0]).toEqual({
        nom: 'Kafel 30x60',
        soni: 2.5,
        birlik: 'm2',
        holat: 'yaroqsiz',
        sabab: 'o1',
        mahsulot_id: 417,
        rasmlar: [photo],
      });
      expect(payload.tovarlar[1]).toEqual({
        nom: 'Sement',
        soni: 1,
        holat: 'yaroqli',
        sabab: 'x',
        izoh_sabab: 'yomgʻir',
        aybdor: 'haydovchi',
        rasmlar: [photo],
      });
      // Held, not sent: the seller has not looked at the list yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.vozvratReport as any).upsert.mock.calls[0][0].create.status).toBe('held');
      expect(vozvrat.deliver).not.toHaveBeenCalled();
    });

    it('still files the report for a seller with no Telegram id — it is sent once the id is known', async () => {
      const { prisma, vozvrat, service } = returning({ telegramId: null });
      await service.startReturn(
        'o1',
        { returns, reason: null, items: [{ name: 'Kafel', quantity: 1, condition: 'yaroqli', reason: 'o2', photo_url: photo }] },
        driver,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = (prisma.vozvratReport as any).upsert.mock.calls[0][0].create.payload;
      expect(payload.sotuvchi_id).toBeNull();
      expect(vozvrat.deliver).not.toHaveBeenCalled();
    });

    it('works without items, as older apps send it', async () => {
      const { prisma, vozvrat, service } = returning();
      await service.startReturn('o1', { returns, reason: null }, driver);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.vozvratReport as any).upsert).not.toHaveBeenCalled();
      expect(vozvrat.deliver).not.toHaveBeenCalled();
    });
  });

  it('requires a destination for every collected pickup', async () => {
    const prisma = makePrisma(
      makeOrder({
        status: 'arrived_at_customer',
        pickupSources: [pickup('ps1', 0, 'arrived'), pickup('ps2', 1, 'arrived')],
      }),
    );
    await expect(
      svc(prisma).startReturn(
        'o1',
        { returns: [{ pickup_source_id: 'ps1', destination: 'store' }], reason: null },
        driver,
      ),
    ).rejects.toThrow('return_destinations_incomplete');
  });

  it('rejects a driver-started return before he has set off to the customer', async () => {
    const prisma = makePrisma(
      makeOrder({ status: 'items_collected', pickupSources: [pickup('ps1', 0, 'arrived')] }),
    );
    await expect(
      svc(prisma).startReturn(
        'o1',
        { returns: [{ pickup_source_id: 'ps1', destination: 'store' }], reason: null },
        driver,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('hands a return stop back once, however many times the button is tapped', async () => {
    const source = pickup('ps1', 0, 'arrived', {
      returnRequired: true,
      returnDestination: 'warehouse',
      returnStage: 'arrived',
    });
    const prisma = makePrisma(makeOrder({ status: 'returning', pickupSources: [source] }));
    // The stop was claimed by the first tap.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.orderPickupSource as any).updateMany.mockResolvedValue({ count: 0 });
    await expect(
      svc(prisma).completeReturn('o1', 'ps1', driver, 'https://cdn.test/proof.jpg'),
    ).rejects.toThrow('return_already_started');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.outboxEvent as any).create).not.toHaveBeenCalled();
  });

  it('keeps a written-up warehouse return at the warehouse until the storekeeper takes it in', async () => {
    const source = pickup('ps1', 0, 'arrived', {
      returnRequired: true,
      returnDestination: 'warehouse',
      returnStage: 'arrived',
    });
    const waiting = makePrisma(
      makeOrder({ status: 'returning', pickupSources: [source], _count: { returnItems: 1 }, returnItemsConfirmedAt: new Date() }),
    );
    const order = await svc(waiting).findOneForActor('o1', driver);
    expect(order.next_action).toMatchObject({ type: 'return_wait_warehouse', pickup_id: 'ps1' });
    await expect(
      svc(waiting).completeReturn('o1', 'ps1', driver, 'https://cdn.test/proof.jpg'),
    ).rejects.toThrow('return_waiting_warehouse');

    const accepted = makePrisma(
      makeOrder({
        status: 'returning',
        pickupSources: [source],
        _count: { returnItems: 1 },
        returnItemsConfirmedAt: new Date(),
        returnWarehouseAcceptedAt: new Date(),
      }),
    );
    const after = await svc(accepted).findOneForActor('o1', driver);
    expect(after.next_action).toMatchObject({ type: 'return_complete', pickup_id: 'ps1' });
  });

  it("keeps a written-up store return at the shop until the shop's person takes it in (owner, 07.11.2026)", async () => {
    const source = pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: 'store', returnStage: 'arrived' });
    const base = { status: 'returning', pickupSources: [source], _count: { returnItems: 1 }, returnItemsConfirmedAt: new Date() };
    const waiting = makePrisma(makeOrder(base));
    expect((await svc(waiting).findOneForActor('o1', driver)).next_action).toMatchObject({ type: 'return_wait_warehouse', pickup_id: 'ps1' });
    await expect(svc(waiting).completeReturn('o1', 'ps1', driver, 'https://cdn.test/proof.jpg')).rejects.toThrow('return_waiting_warehouse');
    // The warehouse's acceptance does not open a store stop.
    const wrongPlace = makePrisma(makeOrder({ ...base, returnWarehouseAcceptedAt: new Date() }));
    expect((await svc(wrongPlace).findOneForActor('o1', driver)).next_action).toMatchObject({ type: 'return_wait_warehouse' });
    const accepted = makePrisma(makeOrder({ ...base, returnStoreAcceptedAt: new Date() }));
    expect((await svc(accepted).findOneForActor('o1', driver)).next_action).toMatchObject({ type: 'return_complete', pickup_id: 'ps1' });
  });

  it('lets a written-up supplier return be handed over with no one taking it in (owner, 07.11.2026)', async () => {
    const source = pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: 'supplier', returnStage: 'arrived' });
    const prisma = makePrisma(
      makeOrder({ status: 'returning', pickupSources: [source], _count: { returnItems: 1 }, returnItemsConfirmedAt: new Date() }),
    );
    expect((await svc(prisma).findOneForActor('o1', driver)).next_action).toMatchObject({ type: 'return_complete', pickup_id: 'ps1' });
    await expect(svc(prisma).completeReturn('o1', 'ps1', driver, 'https://cdn.test/proof.jpg')).resolves.toBeDefined();
  });

  it('lets the driver set a return aside (Ojidaniya) and takes it up again on the next leg', async () => {
    const source = pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: 'warehouse', returnStage: null });
    const prisma = makePrisma(makeOrder({ status: 'returning', pickupSources: [source] }));
    await svc(prisma).deferReturn('o1', driver);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { returnDeferredAt: expect.any(Date) } });
    await svc(prisma).departReturn('o1', 'ps1', driver);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (prisma.order as any).update.mock.calls.map((c: any[]) => c[0].data);
    expect(calls.some((d: Record<string, unknown>) => 'returnDeferredAt' in d && d.returnDeferredAt === null)).toBe(true);
  });

  it("refuses to set aside a vozvrat the seller made — he goes and brings it", async () => {
    const source = pickup('ps1', 0, 'pending', { returnRequired: true, returnDestination: 'warehouse' });
    const prisma = makePrisma(makeOrder({ status: 'returning', kind: 'vozvrat', pickupSources: [source] }));
    await expect(svc(prisma).deferReturn('o1', driver)).rejects.toThrow('vozvrat_order_cannot_defer');
  });

  it('refuses to set aside an order that is not returning', async () => {
    const prisma = makePrisma(makeOrder({ status: 'driver_accepted' }));
    await expect(svc(prisma).deferReturn('o1', driver)).rejects.toThrow('order_invalid_transition');
  });

  it('completes the final pickup return and requires its proof photo', async () => {
    const source = pickup('ps1', 0, 'arrived', {
      returnRequired: true,
      returnDestination: 'warehouse',
      returnStage: 'arrived',
    });
    const prisma = makePrisma(makeOrder({ status: 'returning', pickupSources: [source] }));
    (prisma.order as { count: jest.Mock }).count.mockResolvedValue(0);

    await expect(
      svc(prisma).completeReturn('o1', 'ps1', driver, ''),
    ).rejects.toThrow('return_photo_required');

    await svc(prisma).completeReturn(
      'o1',
      'ps1',
      driver,
      'https://cdn.test/proof.jpg',
      'Ombor qabul qildi',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).updateMany).toHaveBeenCalledWith({
      // Conditional: the stop is claimed once, so a second "Topshirdim" finds
      // nothing to hand back instead of overwriting the proof.
      where: { id: 'ps1', returnedAt: null },
      data: {
        returnProofPhotoUrl: 'https://cdn.test/proof.jpg',
        returnedAt: expect.any(Date),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusCall = (prisma.order as any).update.mock.calls.find(
      (call: [{ data?: { status?: string } }]) => call[0]?.data?.status === 'returned',
    );
    expect(statusCall).toBeTruthy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.outboxEvent as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'order.return_delivered',
          payload: expect.objectContaining({
            pickupId: 'ps1',
            comment: 'Ombor qabul qildi',
          }),
        }),
      }),
    );
  });

  it('includes an optional driver photo comment in the delivery event', async () => {
    const prisma = makePrisma(makeOrder({ status: 'arrived_at_customer' }));
    await svc(prisma).completeDelivery(
      'o1',
      driver,
      'https://cdn.test/delivery.jpg',
      'Mijoz qabul qildi',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.outboxEvent as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'order.delivered',
          payload: expect.objectContaining({ comment: 'Mijoz qabul qildi' }),
        }),
      }),
    );
  });

  it('rejects delivery completion without a proof photo', async () => {
    const prisma = makePrisma(makeOrder({ status: 'arrived_at_customer' }));

    await expect(
      svc(prisma).completeDelivery('o1', driver, ''),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BadRequestException>>({ message: 'delivery_photo_required' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).not.toHaveBeenCalled();
  });

  it('rejects completing a pickup return before arriving at its destination', async () => {
    const source = pickup('ps1', 0, 'arrived', {
      returnRequired: true,
      returnDestination: 'warehouse',
      returnStage: 'heading',
    });
    const prisma = makePrisma(makeOrder({ status: 'returning', pickupSources: [source] }));
    await expect(
      svc(prisma).completeReturn('o1', 'ps1', driver, 'https://cdn.test/proof.jpg'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('walks one pickup return through heading and arrived', async () => {
    const pending = pickup('ps1', 0, 'arrived', {
      returnRequired: true,
      returnDestination: 'warehouse',
    });
    const departPrisma = makePrisma(
      makeOrder({ status: 'returning', pickupSources: [pending] }),
    );
    await svc(departPrisma).departReturn('o1', 'ps1', driver);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((departPrisma.orderPickupSource as any).update).toHaveBeenCalledWith({
      where: { id: 'ps1' },
      data: { returnStage: 'heading' },
    });

    const heading = pickup('ps1', 0, 'arrived', {
      returnRequired: true,
      returnDestination: 'warehouse',
      returnStage: 'heading',
    });
    const arrivePrisma = makePrisma(
      makeOrder({ status: 'returning', pickupSources: [heading] }),
    );
    await svc(arrivePrisma).arriveReturn('o1', 'ps1', driver);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((arrivePrisma.orderPickupSource as any).update).toHaveBeenCalledWith({
      where: { id: 'ps1' },
      data: { returnStage: 'arrived' },
    });
  });

  it('rejects departing a pickup return from the wrong stage', async () => {
    const source = pickup('ps1', 0, 'arrived', {
      returnRequired: true,
      returnDestination: 'warehouse',
      returnStage: 'heading',
    });
    const prisma = makePrisma(makeOrder({ status: 'returning', pickupSources: [source] }));
    await expect(
      svc(prisma).departReturn('o1', 'ps1', driver),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('computes configuration and per-pickup return actions', async () => {
    const actionFor = async (source: ReturnType<typeof pickup>) =>
      (
        await svc(
          makePrisma(makeOrder({ status: 'returning', pickupSources: [source] })),
        ).findOneForActor('o1', { userId: 'admin', role: 'admin' })
      ).next_action;

    expect(
      (
        await actionFor(
          pickup('ps1', 0, 'arrived', { returnRequired: true }),
        )
      ).type,
    ).toBe('return_configure');
    expect(
      (
        await actionFor(
          pickup('ps1', 0, 'arrived', {
            returnRequired: true,
            returnDestination: 'warehouse',
          }),
        )
      ).type,
    ).toBe('return_depart');
    expect(
      (
        await actionFor(
          pickup('ps1', 0, 'arrived', {
            returnRequired: true,
            returnDestination: 'warehouse',
            returnStage: 'heading',
          }),
        )
      ).type,
    ).toBe('return_arrive');
    const complete = await actionFor(
      pickup('ps1', 0, 'arrived', {
        returnRequired: true,
        returnDestination: 'warehouse',
        returnStage: 'arrived',
      }),
    );
    expect(complete).toMatchObject({ type: 'return_complete', pickup_id: 'ps1' });
  });

  it('continues with the next pickup after one returned pickup is complete', async () => {
    const first = pickup('ps1', 0, 'arrived', {
      returnRequired: true,
      returnDestination: 'supplier',
      returnStage: 'arrived',
      returnedAt: new Date(),
    });
    const second = pickup('ps2', 1, 'arrived', {
      returnRequired: true,
      returnDestination: 'store',
    });
    const order = await svc(
      makePrisma(makeOrder({ status: 'returning', pickupSources: [first, second] })),
    ).findOneForActor('o1', { userId: 'admin', role: 'admin' });
    expect(order.next_action).toMatchObject({ type: 'return_depart', pickup_id: 'ps2' });
  });
});

describe('OrdersService — the way back is named by where the goods go (owner, 12.11.2026)', () => {
  it('loaded at BIGANT sklad, bound for BIGANT do‘kon: "BIGANT do‘kon ga yo‘l oldim"', async () => {
    const stop = { ...pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: 'store' }), name: 'BIGANT sklad' };
    const service = svc(makePrisma(makeOrder({ status: 'returning', pickupSources: [stop] })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).home = { store: { name: "BIGANT do'kon", address: null, lat: 41.3, lng: 69.2 } };
    const order = await service.findOneForActor('o1', { userId: 'admin', role: 'admin' });
    expect(order.next_action).toMatchObject({ type: 'return_depart', pickup_id: 'ps1', pickup_name: "BIGANT do'kon" });
  });

  it('bound for a supplier: the supplier‘s own yard keeps its name', async () => {
    const stop = { ...pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: 'supplier' }), name: 'Ombor Tashkent' };
    const order = await svc(makePrisma(makeOrder({ status: 'returning', pickupSources: [stop] }))).findOneForActor('o1', { userId: 'admin', role: 'admin' });
    expect(order.next_action).toMatchObject({ type: 'return_depart', pickup_name: 'Ombor Tashkent' });
  });
});

describe('OrdersService — co-load trips', () => {
  /** Two orders sharing a driver: host stops at trip 0 and 2, co-load at 1 and 3. */
  const hostOrder = (over: Record<string, unknown> = {}) =>
    makeOrder({
      id: 'host',
      status: 'collecting_items',
      deliveryTripPosition: 2,
      pickupSources: [{ ...pickup('ps-host', 0, 'pending'), tripPosition: 0 }],
      ...over,
    });
  const coloadOrder = (over: Record<string, unknown> = {}) =>
    makeOrder({
      id: 'coload',
      status: 'driver_accepted',
      deliveryTripPosition: 3,
      pickupSources: [{ ...pickup('ps-co', 0, 'pending'), tripPosition: 1 }],
      ...over,
    });

  /** Both orders are "running" for the cursor query. */
  function withTrip(order: ReturnType<typeof makeOrder>, running: unknown[]) {
    const prisma = makePrisma(order);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany = jest.fn().mockResolvedValue(running);
    return prisma;
  }

  const driverActor = { userId: 'u-driver', role: 'driver' as const };

  it('offers the action to whichever order owns the next stop', async () => {
    const running = [hostOrder(), coloadOrder()];
    // Host owns trip position 0 → it acts.
    const a = await svc(withTrip(hostOrder(), running)).findOneForActor('host', driverActor);
    expect(a.next_action.type).toBe('depart_pickup');
  });

  it('makes the other order wait rather than sending the driver to the wrong stop', async () => {
    const running = [hostOrder(), coloadOrder()];
    // Co-load owns position 1, but position 0 is still open → it must wait.
    const b = await svc(withTrip(coloadOrder(), running)).findOneForActor('coload', driverActor);
    expect(b.next_action.type).toBe('waiting_for_trip_stop');
  });

  it('hands the turn over once the earlier stop is done', async () => {
    const doneHost = hostOrder({
      status: 'items_collected',
      pickupSources: [{ ...pickup('ps-host', 0, 'arrived'), tripPosition: 0 }],
    });
    const running = [doneHost, coloadOrder()];
    const b = await svc(withTrip(coloadOrder(), running)).findOneForActor('coload', driverActor);
    expect(b.next_action.type).toBe('depart_pickup');
  });

  describe('a vozvrat carrying its goods back with a po puti (owner, 11.11.2026)', () => {
    // The vozvrat's return place at trip 1; the po puti's pickup at 0, its client at 2.
    const vozvrat = (over: Record<string, unknown> = {}) =>
      makeOrder({
        id: 'voz',
        kind: 'vozvrat',
        status: 'returning',
        returnItemsConfirmedAt: new Date(),
        pickupSources: [{ ...pickup('ps-ret', 0, 'pending', { returnRequired: true, returnDestination: 'supplier' }), tripPosition: 1 }],
        ...over,
      });
    const rider = (over: Record<string, unknown> = {}) =>
      makeOrder({
        id: 'rider',
        status: 'driver_accepted',
        deliveryTripPosition: 2,
        pickupSources: [{ ...pickup('ps-r', 0, 'pending'), tripPosition: 0 }],
        ...over,
      });

    it('the po puti pickup first: the vozvrat waits, the rider acts', async () => {
      const running = [vozvrat(), rider()];
      expect((await svc(withTrip(vozvrat(), running)).findOneForActor('voz', driverActor)).next_action.type).toBe('waiting_for_trip_stop');
      expect((await svc(withTrip(rider(), running)).findOneForActor('rider', driverActor)).next_action.type).toBe('depart_pickup');
    });

    it('pickup done: the return place is next — the vozvrat acts, the rider’s client waits', async () => {
      const collected = rider({ status: 'items_collected', pickupSources: [{ ...pickup('ps-r', 0, 'arrived'), tripPosition: 0 }] });
      const running = [vozvrat(), collected];
      expect((await svc(withTrip(vozvrat(), running)).findOneForActor('voz', driverActor)).next_action.type).toBe('return_depart');
      expect((await svc(withTrip(collected, running)).findOneForActor('rider', driverActor)).next_action.type).toBe('waiting_for_trip_stop');
    });

    it('handed over at the return place: the rider’s client is next', async () => {
      const collected = rider({ status: 'items_collected', pickupSources: [{ ...pickup('ps-r', 0, 'arrived'), tripPosition: 0 }] });
      // The returned vozvrat is no longer among what the driver runs.
      expect((await svc(withTrip(collected, [collected])).findOneForActor('rider', driverActor)).next_action.type).toBe('depart_customer');
    });

    it('an ordinary vozvrat, no po puti: exactly as before', async () => {
      const plainVoz = vozvrat({ pickupSources: [pickup('ps-ret', 0, 'pending', { returnRequired: true, returnDestination: 'supplier' })] });
      const res = await svc(withTrip(plainVoz, [plainVoz])).findOneForActor('voz', driverActor);
      expect(res.next_action.type).toBe('return_depart');
    });
  });

  it('leaves an ordinary order completely untouched', async () => {
    // No trip positions anywhere: the cursor is null and nothing is withheld.
    const plain = makeOrder({ status: 'arrived_at_customer' });
    const res = await svc(withTrip(plain, [plain])).findOneForActor('o1', driverActor);
    expect(res.next_action.type).toBe('deliver');
  });

  it('is not confused by a select that omits the trip columns', async () => {
    // Prisma yields undefined, not null, for unselected fields — treating that
    // as a real position poisons the cursor and freezes every order.
    const partial = [{ status: 'collecting_items', pickupSources: [{ legStatus: 'pending' }] }];
    const plain = makeOrder({ status: 'arrived_at_customer' });
    const res = await svc(withTrip(plain, partial)).findOneForActor('o1', driverActor);
    expect(res.next_action.type).toBe('deliver');
  });
});

describe('OrdersService — the driver is only freed when nothing is aboard', () => {
  it('keeps the driver busy when a co-load is still running', async () => {
    const order = makeOrder({ status: 'arrived_at_customer' });
    // One other order still assigned to this driver.
    const prisma = makePrisma(order, { aboard: [{ status: 'collecting_items', bookingKind: null, deliveryDatetime: new Date() }] });
    await svc(prisma).completeDelivery('o1', { userId: 'u-driver', role: 'driver' }, 'https://p/1.jpg');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freed = (prisma.driver as any).update.mock.calls.some(
      (c: unknown[]) => (c[0] as { data: { currentStatus?: string } }).data.currentStatus === 'available',
    );
    expect(freed).toBe(false);
  });

  it('frees the driver on the last delivery', async () => {
    const order = makeOrder({ status: 'arrived_at_customer' });
    const prisma = makePrisma(order, { aboard: [] });
    await svc(prisma).completeDelivery('o1', { userId: 'u-driver', role: 'driver' }, 'https://p/1.jpg');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freed = (prisma.driver as any).update.mock.calls.some(
      (c: unknown[]) => (c[0] as { data: { currentStatus?: string } }).data.currentStatus === 'available',
    );
    expect(freed).toBe(true);
  });
});

describe('OrdersService — driver status across a co-load and an Ertangi booking', () => {
  const statusWrites = (prisma: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((prisma.driver as any).update.mock.calls as { data: { currentStatus?: string } }[][]).map((c) => c[0].data.currentStatus);

  it('starting a return keeps the driver busy while the co-loaded order is still aboard', async () => {
    const prisma = makePrisma(
      makeOrder({ status: 'arrived_at_customer', pickupSources: [pickup('ps1', 0, 'arrived')] }),
      {
        driver: { id: 'drv1', userId: 'u-driver', currentStatus: 'on_delivery', vehicle: { category: 'katta' } },
        aboard: [{ status: 'items_collected', bookingKind: null, deliveryDatetime: new Date() }],
      },
    );
    await svc(prisma).startReturn('o1', { returns: [{ pickup_source_id: 'ps1', destination: 'warehouse' }] }, driver);
    // It was set available unconditionally; the other order makes him busy.
    expect(statusWrites(prisma)).toEqual(['busy']);
  });

  it('the first pickup of an Ertangi booking makes the driver busy — nothing did before', async () => {
    // 27.09 08:00 Tashkent; the booking is for 27.09 and opened at 03:00.
    jest.useFakeTimers({ now: new Date('2026-09-27T03:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const day = new Date('2026-09-27T00:00:00Z');
      const prisma = makePrisma(
        makeOrder({ status: 'driver_accepted', bookingKind: 'bron', deliveryDatetime: day, pickupSources: [pickup('ps1', 0, 'pending')] }),
        {
          driver: { id: 'drv1', userId: 'u-driver', currentStatus: 'available', vehicle: { category: 'katta' } },
          aboard: [{ status: 'collecting_items', bookingKind: 'bron', deliveryDatetime: day }],
        },
      );
      await svc(prisma).departToPickup('o1', 'ps1', driver);
      expect(statusWrites(prisma)).toEqual(['busy']);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("OrdersService.create — a seller orders only for their own client", () => {
  it("another seller's client is not found", async () => {
    const prisma = makePrisma(makeOrder());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).client = { findUnique: jest.fn().mockResolvedValue({ id: 'c1', sellerId: 's-other' }) };
    await expect(
      svc(prisma).create({ client_id: 'c1', items: [] } as never, { userId: 's-me', role: 'seller' }),
    ).rejects.toThrow('Client not found');
  });
});

describe('vozvrat order (goods fetched back from a client)', () => {
  const photo = 'https://cdn.example.com/p.jpg';
  const admin = { userId: 'u-admin', role: 'admin' as const };
  const warehouse = { id: 'pp-w', name: 'Sklad', type: 'warehouse', regionCode: '1726', geoDistrictCode: '1726264', lat: 41.22, lng: 69.21 };
  const client = { id: 'c1', name: 'Akmal', phoneNumber: '+998901112233', address: 'Lutfiy 12', regionCode: '1726', districtCode: '1726262', lat: 41.29, lng: 69.18, sellerId: null };

  it('is created as client → the place, with the stop marked as a return stop and the seller of the delivery', async () => {
    const created = makeOrder({ kind: 'vozvrat', status: 'created', pickupSources: [] });
    const prisma = Object.assign(makePrisma(created), {
      client: { findUnique: jest.fn().mockResolvedValue(client) },
      pickupPlace: { findUnique: jest.fn().mockResolvedValue(warehouse) },
    });
    (prisma.order as any).findUnique = jest.fn().mockResolvedValue({ id: 'o-orig', clientId: 'c1', status: 'delivered', kind: 'delivery', createdBySellerId: 's-sardor' });
    (prisma.order as any).create = jest.fn().mockResolvedValue(created);
    const out = await svc(prisma).createVozvratOrder(
      { client_id: 'c1', original_order_id: 'o-orig', pickup_place_id: 'pp-w', pickup_datetime: null, comment: 'uchta qop' },
      admin,
    );
    expect(out.kind).toBe('vozvrat');
    const data = (prisma.order as any).create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: 'vozvrat', originalOrderId: 'o-orig', createdBySellerId: 's-sardor', clientName: 'Akmal', deliveryLat: 41.29 });
    expect(data.pickupSources.create[0]).toMatchObject({ pickupPlaceId: 'pp-w', name: 'Sklad', returnRequired: true, returnDestination: 'warehouse', position: 0 });
  });

  it('refuses a delivery of another client or one not delivered yet', async () => {
    const prisma = Object.assign(makePrisma(makeOrder()), {
      client: { findUnique: jest.fn().mockResolvedValue(client) },
      pickupPlace: { findUnique: jest.fn().mockResolvedValue(warehouse) },
    });
    (prisma.order as any).findUnique = jest.fn().mockResolvedValue({ id: 'o-orig', clientId: 'other', status: 'delivered', kind: 'delivery', createdBySellerId: 's1' });
    await expect(
      svc(prisma).createVozvratOrder({ client_id: 'c1', original_order_id: 'o-orig', pickup_place_id: 'pp-w' }, admin),
    ).rejects.toThrow('vozvrat_original_order_invalid');
    (prisma.order as any).findUnique = jest.fn().mockResolvedValue({ id: 'o-orig', clientId: 'c1', status: 'on_the_way', kind: 'delivery', createdBySellerId: 's1' });
    await expect(
      svc(prisma).createVozvratOrder({ client_id: 'c1', original_order_id: 'o-orig', pickup_place_id: 'pp-w' }, admin),
    ).rejects.toThrow('vozvrat_original_order_not_delivered');
  });

  it('lets the driver head to the client straight after accepting, earning no delivery bonus', async () => {
    const order = makeOrder({ kind: 'vozvrat', status: 'driver_accepted', pickupSources: [pickup('ps1', 0, 'pending', { returnRequired: true, returnDestination: 'warehouse' })] });
    const prisma = makePrisma(order);
    await svc(prisma).departToCustomer('o1', driver);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'on_the_way' } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverTariffEarning as any).createMany).not.toHaveBeenCalled();
  });

  it('starts the return at the client from the products written up, to the place chosen at creation', async () => {
    const order = makeOrder({
      kind: 'vozvrat',
      status: 'arrived_at_customer',
      pickupSources: [pickup('ps1', 0, 'pending', { returnRequired: true, returnDestination: 'warehouse' })],
    });
    const vozvrat = { deliver: jest.fn().mockResolvedValue('sent') };
    const prisma = makePrisma(order);
    await svc(prisma, vozvrat).startReturn(
      'o1',
      { returns: [{ pickup_source_id: 'ps1', destination: 'warehouse' }], reason: null, items: [{ name: 'Sement', quantity: 3, condition: 'yaroqli', reason: 'm5', photo_url: photo }] },
      driver,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderPickupSource as any).update).toHaveBeenCalledWith({ where: { id: 'ps1' }, data: { returnRequired: true, returnDestination: 'warehouse' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'returning' }) }));
    // The list waits for the seller before the warehouse hears about it.
    expect(vozvrat.deliver).not.toHaveBeenCalled();
  });

  describe("the seller's check on the write-up", () => {
    const seller = { userId: 's1', role: 'seller' as const };
    const other = { userId: 's2', role: 'seller' as const };
    const written = (overrides: Record<string, unknown> = {}) =>
      makePrisma(
        makeOrder({
          status: 'returning',
          pickupSources: [pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: 'warehouse' })],
          _count: { returnItems: 2 },
          ...overrides,
        }),
        { returnItemRows: [{ name: 'Sement', unit: null, quantity: 1, condition: 'yaroqli', reasonCode: 'm5', otherReason: null, culprit: null, photoUrl: photo }] },
      );

    it('waits for the seller, not for a place, when the driver left the place out', async () => {
      const prisma = written({
        pickupSources: [pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: null })],
      });
      const order = await svc(prisma).findOneForActor('o1', driver);
      expect(order.next_action.type).toBe('return_confirm_wait');
    });

    it('lets the seller say where the goods go when he confirms', async () => {
      const prisma = written({
        pickupSources: [pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: null })],
      });
      const vozvrat = { deliver: jest.fn().mockResolvedValue('sent') };
      await svc(prisma, vozvrat).confirmReturnItems('o1', seller, {
        destinations: [{ pickup_source_id: 'ps1', destination: 'store' }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.orderPickupSource as any).update).toHaveBeenCalledWith({
        where: { id: 'ps1' },
        data: { returnDestination: 'store', returnPlaceId: null },
      });
    });

    it("Ta'minotchi picked from the list: the supplier's place is kept (owner, 12.11.2026)", async () => {
      const prisma = written({
        pickupSources: [pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: null })],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).pickupPlace = { ...((prisma as any).pickupPlace ?? {}), count: jest.fn().mockResolvedValue(1) };
      const vozvrat = { deliver: jest.fn().mockResolvedValue('sent') };
      await svc(prisma, vozvrat).confirmReturnItems('o1', seller, {
        destinations: [{ pickup_source_id: 'ps1', destination: 'supplier', place_id: 'pp9' }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.orderPickupSource as any).update).toHaveBeenCalledWith({
        where: { id: 'ps1' },
        data: { returnDestination: 'supplier', returnPlaceId: 'pp9' },
      });
    });

    it("refuses a supplier's place that is not on the list", async () => {
      const prisma = written({
        pickupSources: [pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: null })],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).pickupPlace = { ...((prisma as any).pickupPlace ?? {}), count: jest.fn().mockResolvedValue(0) };
      await expect(
        svc(prisma).confirmReturnItems('o1', seller, {
          destinations: [{ pickup_source_id: 'ps1', destination: 'supplier', place_id: 'nope' }],
        }),
      ).rejects.toThrow('return_place_unknown');
    });

    it('refuses to confirm a return that has nowhere to go', async () => {
      const prisma = written({
        pickupSources: [pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: null })],
      });
      await expect(svc(prisma).confirmReturnItems('o1', seller)).rejects.toThrow('return_destination_required');
    });

    it('holds the driver at the write-up until the seller has looked at it', async () => {
      const prisma = written();
      const order = await svc(prisma).findOneForActor('o1', driver);
      expect(order.next_action.type).toBe('return_confirm_wait');
    });

    it('sends the album and the report once the seller confirms', async () => {
      const prisma = written();
      const vozvrat = { deliver: jest.fn().mockResolvedValue('sent') };
      await svc(prisma, vozvrat).confirmReturnItems('o1', seller);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'o1', returnItemsConfirmedAt: null, returnItemsRejectedAt: null } }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.vozvratReport as any).updateMany).toHaveBeenCalledWith({
        where: { orderId: 'o1', status: 'held' },
        data: expect.objectContaining({ status: 'pending' }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.outboxEvent as any).create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ eventType: 'order.return_written_up' }) }),
      );
      expect(vozvrat.deliver).toHaveBeenCalledWith('o1');
    });

    it("keeps the seller's own account beside the driver's when he gives one", async () => {
      const prisma = written();
      const vozvrat = { deliver: jest.fn().mockResolvedValue('sent') };
      await svc(prisma, vozvrat).confirmReturnItems('o1', seller, {
        seller_culprit: 'mijoz',
        seller_note: '  Mijoz o‘zi shu tovarni buyurtma qilgan  ',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.order as any).updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            returnSellerCulprit: 'mijoz',
            returnSellerNote: 'Mijoz o‘zi shu tovarni buyurtma qilgan',
          }),
        }),
      );
      // The driver goes on with the return either way.
      expect(vozvrat.deliver).toHaveBeenCalledWith('o1');
    });

    it('lets a second confirm find nothing to confirm', async () => {
      const prisma = written();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.order as any).updateMany.mockResolvedValue({ count: 0 });
      await expect(svc(prisma).confirmReturnItems('o1', seller)).rejects.toThrow('return_already_confirmed');
    });

    it('clears the list when the seller sends it back, with nothing posted to retract', async () => {
      const prisma = written();
      const vozvrat = { deliver: jest.fn().mockResolvedValue('sent') };
      await svc(prisma, vozvrat).rejectReturnItems('o1', 'Soni togri emas', seller);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.orderReturnItem as any).deleteMany).toHaveBeenCalledWith({ where: { orderId: 'o1' } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.vozvratReport as any).deleteMany).toHaveBeenCalledWith({ where: { orderId: 'o1', status: 'held' } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.outboxEvent as any).create).not.toHaveBeenCalled();
      expect(vozvrat.deliver).not.toHaveBeenCalled();
    });

    it('asks the driver to write it again once it has come back', async () => {
      const prisma = written({ returnItemsRejectedAt: new Date(), returnItemsRejectReason: 'Soni togri emas' });
      const order = await svc(prisma).findOneForActor('o1', driver);
      expect(order.next_action.type).toBe('return_rewrite');
      expect(order.return_items_reject_reason).toBe('Soni togri emas');
    });

    it("is not another seller's call", async () => {
      const prisma = written();
      await expect(svc(prisma).confirmReturnItems('o1', other)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('leaves a plain return — nothing written up — on its old journey', async () => {
      const prisma = makePrisma(
        makeOrder({
          status: 'returning',
          pickupSources: [pickup('ps1', 0, 'arrived', { returnRequired: true, returnDestination: 'warehouse' })],
          _count: { returnItems: 0 },
        }),
      );
      const order = await svc(prisma).findOneForActor('o1', driver);
      expect(order.next_action.type).toBe('return_depart');
    });
  });

  it('needs the products: a vozvrat order with nothing written up is not a return', async () => {
    const order = makeOrder({
      kind: 'vozvrat',
      status: 'arrived_at_customer',
      pickupSources: [pickup('ps1', 0, 'pending', { returnRequired: true, returnDestination: 'warehouse' })],
    });
    await expect(
      svc(makePrisma(order)).startReturn('o1', { returns: [{ pickup_source_id: 'ps1', destination: 'warehouse' }], reason: null }, driver),
    ).rejects.toThrow('vozvrat_items_required');
  });
});
