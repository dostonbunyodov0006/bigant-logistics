import { BadRequestException, ConflictException } from '@nestjs/common';
import { SellerBoardService } from './seller-board.service';

/** Inspection and insurance in date: what a lorry on the road is assumed to hold. */
const PAPERS = [
  { type: 'texosmotr', expiresAt: new Date('2030-01-01T00:00:00.000Z') },
  { type: 'insurance', expiresAt: new Date('2030-01-01T00:00:00.000Z') },
];

const future = () => new Date(Date.now() + 5 * 60_000);
const past = () => new Date(Date.now() - 60_000);
// Today in Tashkent — the board's day. The UTC date failed these tests from midnight to 05:00.
const today = () => new Date(`${new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);

/** A session slot as toSession() reads it back from the DB. */
function slot(seq: number, status: string, over: Record<string, unknown> = {}) {
  return {
    id: `r${seq}`,
    sequenceIndex: seq,
    status,
    mode: 'double',
    vehicleId: 'v1',
    fillDeadline: status === 'awaiting' ? future() : null,
    order: null,
    ...over,
  };
}

function makePrisma(
  over: {
    holds?: unknown[];
    session?: unknown[];
    slot?: unknown;
    next?: unknown;
    stale?: unknown[];
    orders?: unknown[];
    activeOrders?: unknown[];
  } = {},
) {
  const prisma: Record<string, unknown> = {
    vehicle: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'v1', capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200,
        driver: { id: 'drv1', currentStatus: 'available' },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    reservation: {
      // toSession queries by groupId; caps queries by status/day.
      findMany: jest.fn().mockImplementation(({ where }: { where: { status?: string; groupId?: unknown } }) => {
        if (where?.groupId) return Promise.resolve(over.session ?? [slot(0, 'awaiting')]);
        if (over.stale && where?.status === 'awaiting') return Promise.resolve(over.stale);
        return Promise.resolve(over.holds ?? []);
      }),
      findUnique: jest.fn().mockResolvedValue(over.slot ?? null),
      findFirst: jest.fn().mockResolvedValue(over.next ?? null),
      create: jest.fn().mockResolvedValue({ id: 'r-new' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      // Occupancy queries carry a delivery-date bound (the vehicle queue a
      // bookingKind filter); the driver-status rule selects status + timing;
      // anything else is the driver's running orders.
      findMany: jest.fn().mockImplementation(
        ({ where, select }: { where?: { bookingKind?: unknown; deliveryDatetime?: unknown; OR?: unknown }; select?: { bookingKind?: unknown } }) => {
          // The vehicle queue asks for bookings or returns (an OR on the kind).
          if (where?.deliveryDatetime || where?.bookingKind || where?.OR) {
            // Rows written before the date mattered: today's zanyat booking.
            return Promise.resolve(
              ((over.orders ?? []) as Record<string, unknown>[]).map((o) => ({ deliveryDatetime: new Date(), bookingKind: 'zanyat', ...o })),
            );
          }
          if (select?.bookingKind) return Promise.resolve([]);
          return Promise.resolve(over.activeOrders ?? []);
        },
      ),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({
        id: 'o1', orderNumber: 7, status: 'driver_accepted', deliveryDatetime: new Date(),
        bookingKind: 'zanyat', isBackhaul: false, fullBooking: false, poputiAllowed: true,
        weightKg: 444, clientName: 'Barakat', waybillSource: null, createdAt: new Date(),
        cargoType: { name: 'Sement' }, geoDistrict: null, createdBySeller: { name: 'Javlon' }, pickupSources: [],
      }),
    },
    driverAssignment: { create: jest.fn().mockResolvedValue({}) },
    driver: { findUnique: jest.fn().mockResolvedValue({ currentStatus: 'available' }), update: jest.fn().mockResolvedValue({}) },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    companyJob: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    workLog: { findMany: jest.fn().mockResolvedValue([]) },
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', sellerId: 's1', name: 'Barakat', phoneNumber: '+998', address: 'T' }) },
    cargoType: { findUnique: jest.fn().mockResolvedValue({ id: 'ct1', name: 'Sement' }), findMany: jest.fn().mockResolvedValue([]) },
    pickupPlace: { findMany: jest.fn().mockResolvedValue([{ id: 'pp1', name: 'A' }]) },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  // Support both callback ($transaction(cb)) and array ($transaction([...])) forms.
  prisma.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
  );
  const realtime = { orderStatusChanged: jest.fn(), driverStatusChanged: jest.fn() };
  // Eligible unless a test says otherwise — the geometry itself is covered in
  // poputi.geometry.spec.ts; here we only care that the board consults it.
  const eligible = {
    fit: { eligible: true, reason: null, detour_km: 1.2, detour_seconds: 180, sequence: [] },
    hostOrderId: 'host-order',
    sequence: [],
  };
  const poputi = {
    planForVehicle: jest.fn().mockResolvedValue(eligible),
    hostOf: jest.fn().mockResolvedValue(null),
    search: jest.fn().mockResolvedValue({ matches: [], nearMisses: [] }),
  };
   
  // Which of the client's places the booking is for; its own spec covers the rule.
  const clientAddresses = { forOrder: jest.fn().mockResolvedValue(null) };
  return {
    prisma,
    poputi,
    svc: new SellerBoardService(prisma as any, realtime as any, poputi as any, clientAddresses as any),
  };
}

const seller = { userId: 's1', role: 'seller' };
const FILL = {
  client_id: 'c1', cargo_type_id: 'ct1', weight_kg: 444,
  pickup_sources: [{ pickup_place_id: 'pp1', district_code: null }],
  over_limit_attested: false, poputi_allowed: true,
};

describe('SellerBoardService — reserve caps', () => {
  it('rejects a fully-booked (Polniy) truck', async () => {
    const { svc } = makePrisma({ holds: [{ sellerId: 'other', fullBooking: true, queuePosition: 1 }] });
    await expect(svc.reserve('v1', { kind: 'bron', mode: 'single' }, seller)).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets a 3rd distinct seller share the truck', async () => {
    const { svc } = makePrisma({ holds: [
      { sellerId: 'a', fullBooking: false, queuePosition: 1 },
      { sellerId: 'b', fullBooking: false, queuePosition: 2 },
    ] });
    await expect(svc.reserve('v1', { kind: 'bron', mode: 'single' }, seller)).resolves.toBeDefined();
  });

  it('rejects a 4th distinct seller (3-seller cap)', async () => {
    const { svc } = makePrisma({ holds: [
      { sellerId: 'a', fullBooking: false, queuePosition: 1 },
      { sellerId: 'b', fullBooking: false, queuePosition: 2 },
      { sellerId: 'c', fullBooking: false, queuePosition: 3 },
    ] });
    await expect(svc.reserve('v1', { kind: 'bron', mode: 'single' }, seller)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a seller already on the truck may add another booking even at the cap', async () => {
    const { svc } = makePrisma({ holds: [
      { sellerId: 'a', fullBooking: false, queuePosition: 1 },
      { sellerId: 'b', fullBooking: false, queuePosition: 2 },
      { sellerId: 's1', fullBooking: false, queuePosition: 3 },
    ] });
    await expect(svc.reserve('v1', { kind: 'bron', mode: 'single' }, seller)).resolves.toBeDefined();
  });

  it('rejects Polniy when another seller already holds the truck', async () => {
    const { svc } = makePrisma({ holds: [{ sellerId: 'other', fullBooking: false, queuePosition: 1 }] });
    await expect(svc.reserve('v1', { kind: 'zanyat', mode: 'full' }, seller)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SellerBoardService — sessions', () => {
  it('2x creates an active slot + a queued slot', async () => {
    const { svc, prisma } = makePrisma({ session: [slot(0, 'awaiting'), slot(1, 'queued')] });
    const res = await svc.reserve('v1', { kind: 'zanyat', mode: 'double' }, seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.reservation as any).create).toHaveBeenCalledTimes(2);
    expect(res.slots.map((s) => s.status)).toEqual(['awaiting', 'queued']);
    expect(res.slots[1].fill_deadline).toBeNull();
  });

  it('gives tomorrow bookings the same fill timer as today bookings', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { svc, prisma } = makePrisma({ session: [slot(0, 'awaiting')] });
    const res = await svc.reserve('v1', { kind: 'bron', mode: 'single', scheduled_date: tomorrow }, seller);
    expect(res.slots[0].fill_deadline).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.reservation as any).create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fillDeadline: expect.any(Date) }) }),
    );
  });

  it('queues the next order behind the one still being filled', async () => {
    const { svc, prisma } = makePrisma({ session: [slot(0, 'awaiting', { mode: 'full', sellerId: 's1' })] });
    await svc.addNext('g1', seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.reservation as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'queued', fillDeadline: null, sequenceIndex: 1 }),
      }),
    );
  });

  it('gives the next order the timer when nothing is open ahead of it', async () => {
    const { svc, prisma } = makePrisma({ session: [slot(0, 'filled', { mode: 'full', sellerId: 's1' })] });
    await svc.addNext('g1', seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.reservation as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'awaiting', fillDeadline: expect.any(Date) }),
      }),
    );
  });

  it('refuses to add an eleventh order to one booking', async () => {
    const { svc } = makePrisma({
      session: Array.from({ length: 10 }, (_, i) =>
        slot(i, i === 0 ? 'filled' : 'queued', { mode: 'full', sellerId: 's1' }),
      ),
    });
    await expect(svc.addNext('g1', seller)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SellerBoardService — the Polniy holder comes back to his lorry', () => {
  const base = {
    status: 'on_the_way', bookingKind: 'zanyat', isBackhaul: false, fullBooking: true,
    poputiAllowed: false, queuePosition: 1, createdAt: new Date(), pickupSources: [],
    deliveryDatetime: new Date(), clientName: 'Ali', carryOvers: [], _count: { returnItems: 0 },
  };

  it("the queue names his Polniy booking, so the card can add the next order to it", async () => {
    const { svc } = makePrisma({ orders: [{ ...base, id: 'o1', orderNumber: 11, createdBySellerId: 's1' }], next: { groupId: 'g-full' } });
    expect((await svc.vehicleQueue('v1', seller)).my_full_group_id).toBe('g-full');
  });

  it("his only order was a return he set aside: the Polniy is over, the lorry is Bo'sh", async () => {
    const { svc } = makePrisma({
      orders: [{ ...base, id: 'o1', orderNumber: 11, createdBySellerId: 's1', status: 'returning', returnDeferredAt: new Date() }],
      next: { groupId: 'g-full' },
    });
    expect((await svc.vehicleQueue('v1', seller)).my_full_group_id).toBeNull();
  });

  it("another seller's Polniy is not his to add to", async () => {
    const { svc } = makePrisma({ orders: [{ ...base, id: 'o1', orderNumber: 11, createdBySellerId: 'other' }], next: { groupId: 'g-full' } });
    expect((await svc.vehicleQueue('v1', seller)).my_full_group_id).toBeNull();
  });
});

describe("SellerBoardService — another seller's client", () => {
  it('shows the lorry is taken without naming whose client it is', async () => {
    const base = {
      status: 'new', bookingKind: 'zanyat', isBackhaul: false, fullBooking: false,
      poputiAllowed: false, queuePosition: 1, createdAt: new Date(), pickupSources: [],
    };
    const { svc } = makePrisma({
      orders: [
        { ...base, id: 'o1', orderNumber: 11, clientName: 'Ali', createdBySellerId: 's1' },
        { ...base, id: 'o2', orderNumber: 12, clientName: 'Bahodir', createdBySellerId: 'other' },
      ],
    });
    const q = await svc.vehicleQueue('v1', seller);
    expect(q.orders.find((o) => o.order_number === 11)).toMatchObject({ mine: true, client_name: 'Ali' });
    expect(q.orders.find((o) => o.order_number === 12)).toMatchObject({ mine: false, client_name: null });
  });

  it('the admin on the Statuslar page sees every client, and owns none of them (owner, 05.11.2026)', async () => {
    const base = {
      status: 'new', bookingKind: 'zanyat', isBackhaul: false, fullBooking: false,
      poputiAllowed: false, queuePosition: 1, createdAt: new Date(), pickupSources: [],
    };
    const { svc } = makePrisma({
      orders: [
        { ...base, id: 'o1', orderNumber: 11, clientName: 'Ali', createdBySellerId: 's1' },
        { ...base, id: 'o2', orderNumber: 12, clientName: 'Bahodir', createdBySellerId: 'other' },
      ],
    });
    const q = await svc.vehicleQueue('v1', { userId: 'admin1', role: 'admin' });
    expect(q.orders.find((o) => o.order_number === 11)).toMatchObject({ mine: false, client_name: 'Ali' });
    expect(q.orders.find((o) => o.order_number === 12)).toMatchObject({ mine: false, client_name: 'Bahodir' });
  });
});

describe('SellerBoardService — fill', () => {
  it('commits an awaiting slot into a binding order and activates the queued next', async () => {
    const { svc, prisma } = makePrisma({
      slot: {
        id: 'r0', groupId: 'g1', sellerId: 's1', status: 'awaiting', fillDeadline: future(),
        kind: 'zanyat', fullBooking: false, isBackhaul: false, queuePosition: 1, sequenceIndex: 0, scheduledDate: today(),
        vehicle: { capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS, driver: { id: 'drv1', currentStatus: 'available' } },
      },
      next: { id: 'r1', status: 'queued', sequenceIndex: 1 },
      session: [slot(0, 'filled'), slot(1, 'awaiting')],
    });
    const res = await svc.fill('r0', FILL as never, seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).create.mock.calls[0][0].data.status).toBe('driver_accepted');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverAssignment as any).create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignmentStatus: 'accepted' }) }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates = (prisma.reservation as any).update.mock.calls.map((c: unknown[]) => (c[0] as { data: { status: string } }).data.status);
    // The hold is filled with a conditional update: only an awaiting one can be.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.reservation as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r0', status: 'awaiting' }, data: expect.objectContaining({ status: 'filled' }) }),
    );
    expect(updates).toContain('awaiting');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextActivation = (prisma.reservation as any).update.mock.calls.find(
      (c: unknown[]) => (c[0] as { where: { id: string } }).where.id === 'r1',
    );
    expect(nextActivation[0].data.fillDeadline).toBeInstanceOf(Date);
    expect(res.slots).toHaveLength(2);
  });

  it('rejects filling an expired slot', async () => {
    const { svc } = makePrisma({
      slot: {
        id: 'r0', groupId: 'g1', sellerId: 's1', status: 'awaiting', fillDeadline: past(), sequenceIndex: 0, scheduledDate: today(),
        vehicle: { driver: { id: 'drv1', currentStatus: 'available' } },
      },
    });
    await expect(svc.fill('r0', FILL as never, seller)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects weight above vehicle capacity even with dimensional attestation', async () => {
    const { svc } = makePrisma({
      slot: {
        id: 'r0', groupId: 'g1', sellerId: 's1', status: 'awaiting', fillDeadline: future(), sequenceIndex: 0, scheduledDate: today(),
        vehicle: { capacityKg: 1000, lengthCm: null, widthCm: null, heightCm: null, driver: { id: 'drv1', currentStatus: 'available' } },
      },
    });
    await expect(
      svc.fill(
        'r0',
        { ...FILL, weight_kg: 5000, over_limit_attested: true } as never,
        seller,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BadRequestException>>({ message: 'weight_exceeds_vehicle_capacity' }),
    );
  });

  it('refuses a po puti-open order without weight (owner, 10.11.2026)', async () => {
    const { svc } = makePrisma({
      slot: {
        id: 'r0', groupId: 'g1', sellerId: 's1', status: 'awaiting', fillDeadline: future(),
        kind: 'zanyat', fullBooking: false, isBackhaul: false, queuePosition: 1, sequenceIndex: 0, scheduledDate: today(),
        vehicle: { capacityKg: 1000, lengthCm: null, widthCm: null, heightCm: null, driver: { id: 'drv1', currentStatus: 'available' } },
      },
    });
    await expect(svc.fill('r0', { ...FILL, weight_kg: null, poputi_allowed: true } as never, seller)).rejects.toThrow(
      'poputi_weight_required',
    );
  });

  it('allows an ordinary order (po puti off) without weight', async () => {
    const { svc, prisma } = makePrisma({
      slot: {
        id: 'r0', groupId: 'g1', sellerId: 's1', status: 'awaiting', fillDeadline: future(),
        kind: 'zanyat', fullBooking: false, isBackhaul: false, queuePosition: 1, sequenceIndex: 0, scheduledDate: today(),
        vehicle: { capacityKg: 1000, lengthCm: null, widthCm: null, heightCm: null, driver: { id: 'drv1', currentStatus: 'available' } },
      },
    });

    await svc.fill('r0', { ...FILL, weight_kg: null, poputi_allowed: false } as never, seller);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ weightKg: null }) }),
    );
  });
});

describe('SellerBoardService — expiry & board', () => {
  it('keeps an order at the customer in the seller vehicle queue', async () => {
    const { svc, prisma } = makePrisma();
    await svc.vehicleQueue('v1', seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // The statuses sit inside the OR of bookings and returns.
    const call = (prisma.order as any).findMany.mock.calls[0][0] as { where: { OR: { status: { in: string[] } }[] } };
    expect(call.where.OR.every((branch) => branch.status.in.includes('arrived_at_customer'))).toBe(true);
  });
  it('keeps a return written up at the client on the lorry: in its queue, and holding it on the board', async () => {
    const { svc, prisma } = makePrisma();
    await svc.vehicleQueue('v1', seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueCall = (prisma.order as any).findMany.mock.calls[0][0] as { where: { OR: { status: { in: string[] } }[] } };
    expect(queueCall.where.OR.every((branch) => branch.status.in.includes('returning'))).toBe(true);
    await svc.board('busy', seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (prisma.order as any).findMany.mock.calls.map((c: unknown[]) => JSON.stringify(c[0]));
    expect(calls.some((c: string) => c.includes('"returning"') && c.includes('"arrived_at_customer"'))).toBe(true);
  });
  it('marks only the requesting seller orders as owned', async () => {
    const order = (id: string, createdBySellerId: string) => ({
      id,
      orderNumber: 1,
      status: 'driver_accepted',
      bookingKind: 'zanyat',
      isBackhaul: false,
      fullBooking: false,
      poputiAllowed: false,
      createdBySellerId,
      weightKg: null,
      clientName: 'Mijoz',
      waybillSource: null,
      createdAt: new Date(),
      cargoType: null,
      geoDistrict: null,
      createdBySeller: { name: createdBySellerId },
      pickupSources: [],
    });
    const { svc } = makePrisma({
      orders: [order('mine', 's1'), order('other', 's2')],
    });

    const queue = await svc.vehicleQueue('v1', seller);

    expect(queue.orders).toEqual([
      expect.objectContaining({ id: 'mine', mine: true }),
      expect.objectContaining({ id: 'other', mine: false }),
    ]);
  });

  /**
   * A po puti co-load is aboard the order it rides with, not behind it. The
   * queue can only tell the two apart by the trip positions, which are written
   * for a merged trip and left null for an ordinary one.
   */
  describe('po puti co-loads in the vehicle queue', () => {
    const queued = (id: string, n: number, over: Record<string, unknown> = {}) => ({
      id,
      orderNumber: n,
      status: 'driver_accepted',
      bookingKind: 'zanyat',
      isBackhaul: false,
      fullBooking: false,
      poputiAllowed: true,
      createdBySellerId: 's1',
      weightKg: null,
      clientName: `Mijoz ${n}`,
      waybillSource: null,
      createdAt: new Date(),
      cargoType: null,
      geoDistrict: null,
      createdBySeller: { name: 's1' },
      deliveryTripPosition: null,
      pickupSources: [{ name: `Sklad ${n}`, legStatus: 'pending', tripPosition: null, geoDistrict: null }],
      ...over,
    });

    it('points a co-load at the order it rides with', async () => {
      const host = queued('host', 40, {
        deliveryTripPosition: 2,
        pickupSources: [{ name: 'hgkfh', legStatus: 'pending', tripPosition: 0, geoDistrict: null }],
      });
      const coload = queued('coload', 41, {
        deliveryTripPosition: 3,
        pickupSources: [{ name: 'Sklad B', legStatus: 'pending', tripPosition: 1, geoDistrict: null }],
      });
      const { svc } = makePrisma({ orders: [host, coload] });

      const queue = await svc.vehicleQueue('v1', seller);

      expect(queue.orders).toEqual([
        expect.objectContaining({ id: 'host', rides_with_order_id: null }),
        expect.objectContaining({ id: 'coload', rides_with_order_id: 'host' }),
      ]);
    });

    it('carries the trip positions the merged rail is drawn from', async () => {
      const host = queued('host', 40, {
        deliveryTripPosition: 2,
        pickupSources: [{ name: 'hgkfh', legStatus: 'arrived', tripPosition: 0, geoDistrict: null }],
      });
      const { svc } = makePrisma({ orders: [host] });

      const [o] = (await svc.vehicleQueue('v1', seller)).orders;

      expect(o.delivery_trip_position).toBe(2);
      expect(o.pickup_sources[0]).toMatchObject({ name: 'hgkfh', trip_position: 0 });
    });

    it('leaves an ordinary 2x booking queueing, because it is', async () => {
      // Both orders are driven one after the other, so neither has a trip
      // position and the second must still read as "next in line".
      const { svc } = makePrisma({ orders: [queued('first', 1), queued('second', 2)] });

      const queue = await svc.vehicleQueue('v1', seller);

      expect(queue.orders.map((o) => o.rides_with_order_id)).toEqual([null, null]);
    });
  });

  it('expires stale slots and cascades queued siblings', async () => {
    const { svc, prisma } = makePrisma({ stale: [{ id: 'r0', groupId: 'g1' }] });
    const n = await svc.expireStale();
    expect(n).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.reservation as any).updateMany).toHaveBeenCalled();
  });

  it('keeps multiple normal bookings booked instead of marking them Polniy', async () => {
    const { svc, prisma } = makePrisma({
      holds: [
        { vehicleId: 'v1', sellerId: 'a', fullBooking: false, fillDeadline: future() },
        { vehicleId: 'v1', sellerId: 'b', fullBooking: false, fillDeadline: future() },
      ],
    });
    (prisma.vehicle as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([
      { id: 'v1', model: 'Gazel', plateNumber: '01 A', type: 'truck', category: null, capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS, driver: { id: 'd1', currentStatus: 'available', licenseCategory: 'B', user: { name: 'A' } } },
    ]);
    const busy = await svc.board('busy', seller);
    expect(busy.katta[0]?.board_status).toBe('booked');
    expect(busy.katta[0]?.card_state).toBe('multi_load');
    expect(busy.katta[0]).toMatchObject({
      confirmed_slots: 0,
      confirmed_full_booking: false,
      has_pending_hold: true,
      has_my_pending_hold: false,
      my_slots: 0,
      // Holds count as sellers on the truck (owner, 09.11.2026).
      seller_count: 2,
    });
  });

  it('counts only fully saved orders while pending forms keep holding capacity', async () => {
    const { svc, prisma } = makePrisma({
      holds: [{ vehicleId: 'v1', sellerId: 'other', fullBooking: false, fillDeadline: future() }],
      orders: [
        {
          assignedDriverId: 'd1',
          createdBySellerId: 's1',
          fullBooking: false,
        },
      ],
    });
    (prisma.vehicle as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([
      { id: 'v1', model: 'Gazel', plateNumber: '01 A', type: 'truck', category: null, capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS, driver: { id: 'd1', currentStatus: 'available', licenseCategory: 'B', user: { name: 'A' } } },
    ]);

    const busy = await svc.board('busy', seller);

    expect(busy.katta[0]).toMatchObject({
      confirmed_slots: 1,
      confirmed_full_booking: false,
      has_pending_hold: true,
      has_my_pending_hold: false,
      my_slots: 1,
      // s1's saved order and another seller's hold: shared, so the card is orange.
      seller_count: 2,
    });
  });

  it('keeps an own pending form resumable without counting it as a confirmed slot', async () => {
    const { svc, prisma } = makePrisma({
      holds: [{ vehicleId: 'v1', sellerId: 's1', fullBooking: false, fillDeadline: future() }],
    });
    (prisma.vehicle as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([
      { id: 'v1', model: 'Gazel', plateNumber: '01 A', type: 'truck', category: null, capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS, driver: { id: 'd1', currentStatus: 'available', licenseCategory: 'B', user: { name: 'A' } } },
    ]);

    const mine = await svc.board('mine', seller);

    expect(mine.katta).toHaveLength(1);
    expect(mine.katta[0]).toMatchObject({
      confirmed_slots: 0,
      has_pending_hold: true,
      has_my_pending_hold: true,
      my_slots: 0,
    });
  });

  it('marks a free truck free and an offline driver off-duty', async () => {
    const { svc, prisma } = makePrisma();
    (prisma.vehicle as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([
      { id: 'v1', model: 'Gazel', plateNumber: '01 A', type: 'truck', category: null, capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS, driver: { id: 'd1', currentStatus: 'available', licenseCategory: 'B', user: { name: 'A' } } },
      { id: 'v2', model: 'Labo', plateNumber: '01 B', type: 'car', category: null, capacityKg: 1000, lengthCm: 280, widthCm: 160, heightCm: 150, documents: PAPERS, driver: { id: 'd2', currentStatus: 'offline', user: { name: 'B' } } },
    ]);
    const free = await svc.board('free', seller);
    expect(free.katta.map((v) => v.id)).toEqual(['v1']);
    expect(free.yengil.map((v) => v.board_status)).toEqual(['offduty']);
    // An off-shift truck belongs to the free list, under its own heading, and
    // nowhere else: with nobody clocked in, "free" and "busy" used to show
    // the same trucks and the seller had to hunt between them.
    const busy = await svc.board('busy', seller);
    expect(busy.yengil).toEqual([]);
    expect(busy.katta).toEqual([]);
  });

  it('a driver on a break shows free and bookable, with the end of his break (owner, 12.11.2026)', async () => {
    const { svc, prisma } = makePrisma();
    const until = new Date(Date.now() - 10 * 60_000); // ten minutes late
    (prisma.vehicle as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([
      { id: 'v1', model: 'Gazel', plateNumber: '01 A', type: 'truck', category: null, capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS,
        driver: { id: 'd1', currentStatus: 'available', breakStartedAt: new Date(Date.now() - 70 * 60_000), breakUntil: until, licenseCategory: 'B', user: { name: 'A' } } },
    ]);
    const free = await svc.board('free', seller);
    expect(free.katta.map((v) => v.id)).toEqual(['v1']);
    expect(free.katta[0].card_state).toBe('available_working');
    expect(free.katta[0].break_until).toBe(until.toISOString());
  });

  it('"Polniy" today: not in the free list, greyed in the busy one, and not bookable (owner, 12.11.2026)', async () => {
    const { svc, prisma } = makePrisma();
    (prisma.vehicle as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([
      { id: 'v1', model: 'Gazel', plateNumber: '01 A', type: 'truck', category: null, capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS,
        driver: { id: 'd1', currentStatus: 'offline', licenseCategory: 'B', user: { name: 'A' } } },
    ]);
    (prisma.workLog as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([{ driverId: 'd1' }]);
    const free = await svc.board('free', seller);
    expect(free.katta).toEqual([]);
    const busy = await svc.board('busy', seller);
    expect(busy.katta.map((v) => [v.id, v.day_off, v.card_state])).toEqual([['v1', true, 'excused']]);
  });

  it('Gazels (orta) stand with the Isuzu in KATTA; Damas and Labo (kichik) in YENGIL', async () => {
    const { svc, prisma } = makePrisma();
    const lorry = (id: string, model: string, category: string) => ({
      id, model, plateNumber: id, type: 'truck', category, capacityKg: 1000, lengthCm: 400, widthCm: 200, heightCm: 200,
      documents: PAPERS, driver: { id: `d-${id}`, currentStatus: 'available', licenseCategory: 'C', user: { name: id } },
    });
    (prisma.vehicle as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([
      lorry('isuzu', 'Isuzu', 'katta'),
      lorry('gazel', 'GAZelle NEXT', 'orta'),
      lorry('damas', 'Damas Van', 'kichik'),
    ]);
    const free = await svc.board('free', seller);
    expect(free.katta.map((v) => v.id).sort()).toEqual(['gazel', 'isuzu']);
    expect(free.yengil.map((v) => v.id)).toEqual(['damas']);
  });
});

describe('SellerBoardService — coordinate snapshots on fill', () => {
  const awaitingSlot = {
    id: 'r0', groupId: 'g1', sellerId: 's1', status: 'awaiting', fillDeadline: future(),
    kind: 'zanyat', fullBooking: false, isBackhaul: false, queuePosition: 1, sequenceIndex: 0, scheduledDate: today(),
    vehicle: { capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS, driver: { id: 'drv1', currentStatus: 'available' } },
  };

  it('copies the client pin onto the order and each place pin onto its pickup source', async () => {
    const { svc, prisma } = makePrisma({ slot: awaitingSlot });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.client as any).findUnique.mockResolvedValue({
      id: 'c1', sellerId: 's1', name: 'Barakat', phoneNumber: '+998', address: 'T', lat: 41.2995, lng: 69.2401,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.pickupPlace as any).findMany.mockResolvedValue([
      { id: 'pp1', name: 'Sklad', regionCode: '1726', geoDistrictCode: '1726-01', lat: 41.2856, lng: 69.2034 },
    ]);

    await svc.fill('r0', FILL as never, seller);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (prisma.order as any).create.mock.calls[0][0].data;
    // Delivery point comes from the client — and is a snapshot, not a relation:
    // editing the client later must not move an existing order.
    expect(data.deliveryLat).toBe(41.2995);
    expect(data.deliveryLng).toBe(69.2401);
    expect(data.pickupSources.create[0]).toEqual(
      expect.objectContaining({ pickupPlaceId: 'pp1', lat: 41.2856, lng: 69.2034 }),
    );
  });

  it('leaves the snapshot empty for legacy rows that were never pinned', async () => {
    const { svc, prisma } = makePrisma({ slot: awaitingSlot });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.client as any).findUnique.mockResolvedValue({
      id: 'c1', sellerId: 's1', name: 'Barakat', phoneNumber: '+998', address: 'T', lat: null, lng: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.pickupPlace as any).findMany.mockResolvedValue([{ id: 'pp1', name: 'A', lat: null, lng: null }]);

    await svc.fill('r0', FILL as never, seller);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (prisma.order as any).create.mock.calls[0][0].data;
    // Null, never a fabricated 0,0 — a zero coordinate would route drivers into
    // the Gulf of Guinea and pass every "is it set" check on the way there.
    expect(data.deliveryLat).toBeNull();
    expect(data.deliveryLng).toBeNull();
    expect(data.pickupSources.create[0].lat).toBeNull();
  });
});

describe('SellerBoardService — current order and own orders on a card', () => {
  it('names the order the driver is actually on, and the seller\'s own in queue order', async () => {
    const { svc } = makePrisma({
      orders: [
        { id: 'o-second', assignedDriverId: 'drv1', createdBySellerId: 's1', fullBooking: false, queuePosition: 2 },
        { id: 'o-first', assignedDriverId: 'drv1', createdBySellerId: 'other', fullBooking: false, queuePosition: 1 },
        { id: 'o-third', assignedDriverId: 'drv1', createdBySellerId: 's1', fullBooking: false, queuePosition: 3 },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([
      { id: 'v1', model: 'Isuzu', plateNumber: '01A', category: 'katta', type: 'truck', status: 'active',
        capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS,
        driver: { id: 'drv1', currentStatus: 'busy', breakUntil: null, licenseCategory: 'C', user: { name: 'Azamat' } } },
    ]);
    const board = await svc.board('busy', seller);
    const card = board.katta[0];
    // The driver is on the other seller's order; ours are queued behind it.
    expect(card.current_order_id).toBe('o-first');
    expect(card.my_order_ids).toEqual(['o-second', 'o-third']);
    expect(card.my_slots).toBe(2);
  });
});

describe('SellerBoardService — po puti co-load rules', () => {
  const backhaulSlot = {
    id: 'r0', groupId: 'g1', sellerId: 's1', status: 'awaiting', fillDeadline: future(),
    kind: 'bron', fullBooking: false, isBackhaul: true, queuePosition: 1, sequenceIndex: 0,
    scheduledDate: today(), vehicleId: 'v1',
    vehicle: { capacityKg: 2000, lengthCm: null, widthCm: null, heightCm: null, driver: { id: 'drv1', currentStatus: 'busy' } },
  };

  function pinned({ poputi, prisma }: { poputi: { planForVehicle: jest.Mock }; prisma: Record<string, unknown> }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.client as any).findUnique.mockResolvedValue({
      id: 'c1', sellerId: 's1', name: 'Barakat', phoneNumber: '+998', address: 'T', lat: 41.3111, lng: 69.2797,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.pickupPlace as any).findMany.mockResolvedValue([
      { id: 'pp1', name: 'Sklad', regionCode: '1726', geoDistrictCode: null, lat: 41.2856, lng: 69.2034 },
    ]);
    return poputi;
  }

  it('checks the co-load rules at fill, where the cargo coordinates finally exist', async () => {
    const { svc, prisma, poputi } = makePrisma({ slot: backhaulSlot });
    pinned({ poputi, prisma });

    await svc.fill('r0', FILL as never, seller);

    expect(poputi.planForVehicle).toHaveBeenCalledWith('v1', {
      pickups: [{ lat: 41.2856, lng: 69.2034 }],
      delivery: { lat: 41.3111, lng: 69.2797 },
      weight_kg: 444,
      length_cm: null,
    }, null, 's1'); // no trip picked in the form: the earliest that fits; the seller asking
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).create).toHaveBeenCalled();
  });

  it('two sellers at once: the truck already took a po puti while this one was filling — refused (owner, 10.11.2026)', async () => {
    const { svc, prisma, poputi } = makePrisma({ slot: backhaulSlot });
    pinned({ poputi, prisma });
    // The plan said yes; by the time this fill locks the truck, another seller's po puti is aboard.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findMany = (prisma.order as any).findMany;
    const usual = findMany.getMockImplementation();
    findMany.mockImplementation((args: { where?: { isBackhaul?: boolean } }) =>
      args?.where?.isBackhaul ? Promise.resolve([{ createdBySellerId: 's9' }]) : usual(args),
    );
    await expect(svc.fill('r0', FILL as never, seller)).rejects.toEqual(
      expect.objectContaining({ message: 'poputi_poputi_taken' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).create).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('the same seller’s second client on that trip: allowed; a third: refused (owner, 11.11.2026)', async () => {
    const second = makePrisma({ slot: backhaulSlot });
    pinned({ poputi: second.poputi, prisma: second.prisma });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fm = (second.prisma.order as any).findMany;
    const usual = fm.getMockImplementation();
    fm.mockImplementation((args: { where?: { isBackhaul?: boolean } }) =>
      args?.where?.isBackhaul ? Promise.resolve([{ createdBySellerId: 's1' }]) : usual(args),
    );
    await second.svc.fill('r0', FILL as never, seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((second.prisma.order as any).create).toHaveBeenCalled();

    const third = makePrisma({ slot: backhaulSlot });
    pinned({ poputi: third.poputi, prisma: third.prisma });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fm3 = (third.prisma.order as any).findMany;
    const usual3 = fm3.getMockImplementation();
    fm3.mockImplementation((args: { where?: { isBackhaul?: boolean } }) =>
      args?.where?.isBackhaul ? Promise.resolve([{ createdBySellerId: 's1' }, { createdBySellerId: 's1' }]) : usual3(args),
    );
    await expect(third.svc.fill('r0', FILL as never, seller)).rejects.toEqual(expect.objectContaining({ message: 'poputi_poputi_taken' }));
  });

  it('refuses the order when the cargo falls outside the fences, and says which rule', async () => {
    const { svc, prisma, poputi } = makePrisma({ slot: backhaulSlot });
    pinned({ poputi, prisma });
    poputi.planForVehicle.mockResolvedValue({
      fit: { eligible: false, reason: 'pickup_outside_fences', detour_km: null, detour_seconds: null, sequence: [] },
      hostOrderId: null,
      sequence: [],
    });

    await expect(svc.fill('r0', FILL as never, seller)).rejects.toEqual(
      expect.objectContaining({ message: 'poputi_pickup_outside_fences' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).create).not.toHaveBeenCalled();
  });

  it('refuses a co-load the running order has no room for', async () => {
    const { svc, prisma, poputi } = makePrisma({ slot: backhaulSlot });
    pinned({ poputi, prisma });
    poputi.planForVehicle.mockResolvedValue({
      fit: { eligible: false, reason: 'capacity_exceeded', detour_km: null, detour_seconds: null, sequence: [] },
      hostOrderId: null,
      sequence: [],
    });
    await expect(svc.fill('r0', FILL as never, seller)).rejects.toEqual(
      expect.objectContaining({ message: 'poputi_capacity_exceeded' }),
    );
  });

  it('refuses an unpinned co-load rather than silently skipping the geometry', async () => {
    const { svc, prisma, poputi } = makePrisma({ slot: backhaulSlot });
    pinned({ poputi, prisma });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.pickupPlace as any).findMany.mockResolvedValue([{ id: 'pp1', name: 'Sklad', lat: null, lng: null }]);

    await expect(svc.fill('r0', FILL as never, seller)).rejects.toEqual(
      expect.objectContaining({ message: 'poputi_missing_coordinates' }),
    );
    expect(poputi.planForVehicle).not.toHaveBeenCalled();
  });

  it('leaves an ordinary booking alone — only a po puti order is a co-load', async () => {
    const { svc, prisma, poputi } = makePrisma({
      slot: { ...backhaulSlot, isBackhaul: false, kind: 'zanyat' },
    });
    pinned({ poputi, prisma });
    await svc.fill('r0', FILL as never, seller);
    expect(poputi.planForVehicle).not.toHaveBeenCalled();
  });

  it('blocks the po puti button up front when no form could ever satisfy it', async () => {
    const { svc, poputi } = makePrisma();
    poputi.planForVehicle.mockResolvedValue({
      fit: { eligible: false, reason: 'no_pickups_left', detour_km: null, detour_seconds: null, sequence: [] },
      hostOrderId: null,
      sequence: [],
    });
    await expect(svc.reservePoputi('v1', seller)).rejects.toEqual(
      expect.objectContaining({ message: 'poputi_no_pickups_left' }),
    );
  });

  it('still opens the form when only the geometry is unknown at reserve time', async () => {
    const { svc, prisma, poputi } = makePrisma();
    // createSession keeps its own consent check inside the row lock — the
    // precheck is a fast fail, that one is authoritative against races.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).count.mockResolvedValue(1);
    // The precheck probe sits at 0,0 — it always fails the fences, and that
    // must not stop the seller from opening the form.
    poputi.planForVehicle.mockResolvedValue({
      fit: { eligible: false, reason: 'pickup_outside_fences', detour_km: null, detour_seconds: null, sequence: [] },
      hostOrderId: null,
      sequence: [],
    });
    await expect(svc.reservePoputi('v1', seller)).resolves.toBeDefined();
  });

  it('a truck booked for tomorrow takes the po puti order tomorrow, at its start', async () => {
    const { svc, prisma, poputi } = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).count.mockResolvedValue(1);
    const tomorrow = new Date(today().getTime() + 86_400_000);
    poputi.hostOf.mockResolvedValue({ deliveryDatetime: tomorrow, startAfterNine: true });
    await svc.reservePoputi('v1', seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.reservation as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isBackhaul: true, scheduledDate: tomorrow, startAfterNine: true }),
      }),
    );
  });

  it("today's truck keeps the po puti order today", async () => {
    const { svc, prisma, poputi } = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).count.mockResolvedValue(1);
    poputi.hostOf.mockResolvedValue({ deliveryDatetime: new Date(), startAfterNine: false });
    await svc.reservePoputi('v1', seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.reservation as any).create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scheduledDate: today(), startAfterNine: false }) }),
    );
  });

  it('the search tells the seller when the truck is booked for a later day', async () => {
    const { svc, prisma, poputi } = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.client as any).findUnique.mockResolvedValue({ id: 'c1', sellerId: 's1', lat: 41.3, lng: 69.2 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).pickupPlace = { findMany: jest.fn().mockResolvedValue([{ id: 'pp1', lat: 41.2, lng: 69.1 }]) };
    const tomorrow = new Date(today().getTime() + 86_400_000);
    const match = (id: string, at: Date) => ({
      candidate: {
        vehicle: { id, model: 'GAZelle', plateNumber: id, capacityKg: 1500, category: 'orta' },
        driverName: 'H',
        headingTo: null,
        hostDeliveryAt: at,
      },
      fit: { eligible: true, reason: null, detour_km: 0, detour_seconds: 0, sequence: [] },
      hostOrderId: 'o',
    });
    poputi.search.mockResolvedValue({ matches: [match('v-tom', tomorrow), match('v-now', new Date())], nearMisses: [] });
    const res = await svc.searchPoputi({ client_id: 'c1', pickup_place_ids: ['pp1'], weight_kg: 640 }, seller);
    expect(res.matches.map((m) => [m.vehicle_id, m.later_day])).toEqual([
      ['v-tom', tomorrow.toISOString().slice(0, 10)],
      ['v-now', null],
    ]);
  });
});

describe("SellerBoardService — a truck still carrying yesterday's order", () => {
  // 27.09 at 10:00 Tashkent. The unfinished order was booked on 26.09; an
  // Ertangi booking for 28.09 sits in the queue behind.
  const NOW = new Date('2026-09-27T05:00:00Z');
  const yesterdays = { id: 'o-old', assignedDriverId: 'drv1', createdBySellerId: 'other', fullBooking: false, queuePosition: 1, bookingKind: 'zanyat', deliveryDatetime: new Date('2026-09-26T06:00:00Z') };
  const tomorrows = { id: 'o-next', assignedDriverId: 'drv1', createdBySellerId: 'other', fullBooking: false, queuePosition: 2, bookingKind: 'bron', deliveryDatetime: new Date('2026-09-28T00:00:00Z') };
  const truck = {
    id: 'v1', model: 'Isuzu', plateNumber: '01A', category: 'katta', type: 'truck', status: 'active',
    capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS,
    driver: { id: 'drv1', currentStatus: 'busy', breakUntil: null, licenseCategory: 'C', user: { name: 'Bahodir' } },
  };

  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  // The driver has not pressed Ish boshlandi. Whatever is booked on his lorry
  // — one zanyat, several, or a return — the lorry is a busy one for every
  // seller, and the booking seller's own under Mening zakazlarim.
  const offShift = { ...truck, driver: { ...truck.driver, currentStatus: 'offline' } };
  const mineToday = { id: 'o-mine', assignedDriverId: 'drv1', createdBySellerId: 's1', fullBooking: false, queuePosition: 1, bookingKind: 'zanyat', deliveryDatetime: new Date('2026-09-27T04:00:00Z') };
  const mineReturn = { ...mineToday, id: 'o-ret', bookingKind: null, kind: 'vozvrat', status: 'driver_accepted' };

  it('a lorry booked before its driver clocks in is busy, mine, and not free', async () => {
    const { svc } = makePrisma({ orders: [mineToday] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([offShift]);
    expect((await svc.board('busy', seller)).katta.map((c) => c.id)).toEqual(['v1']);
    expect((await svc.board('mine', seller)).katta.map((c) => c.id)).toEqual(['v1']);
    expect((await svc.board('free', seller)).katta).toEqual([]);
    expect((await svc.board('busy', seller)).katta[0]).toMatchObject({ board_status: 'offduty', confirmed_slots: 1, my_slots: 1 });
  });

  it('two bookings and a return on an off-shift lorry: still busy, still mine, counted', async () => {
    const { svc } = makePrisma({ orders: [mineToday, { ...mineToday, id: 'o-2', createdBySellerId: 'other', queuePosition: 2 }, mineReturn] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([offShift]);
    const busy = (await svc.board('busy', seller)).katta[0];
    expect(busy).toMatchObject({ confirmed_slots: 3, my_slots: 2, vozvrat_slots: 1 });
    expect((await svc.board('mine', seller)).katta.map((c) => c.id)).toEqual(['v1']);
    expect((await svc.board('free', seller)).katta).toEqual([]);
  });

  it('an off-shift lorry with nothing on it stays in the free list', async () => {
    const { svc } = makePrisma({ orders: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([offShift]);
    expect((await svc.board('free', seller)).katta.map((c) => c.id)).toEqual(['v1']);
    expect((await svc.board('busy', seller)).katta).toEqual([]);
  });

  it("is not Bo'sh the next day: yesterday's order still takes the truck", async () => {
    const { svc } = makePrisma({ orders: [yesterdays] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([truck]);
    const card = (await svc.board('busy', seller)).katta[0];
    expect(card).toMatchObject({ board_status: 'booked', card_state: 'one_load', confirmed_slots: 1 });
  });

  it("today's trip does not show on Ertangi buyurtmalar (owner, 07.11.2026)", async () => {
    const { svc } = makePrisma({ orders: [yesterdays] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([truck]);
    const today = (await svc.board('busy', seller)).katta[0];
    expect(today.current_order_id).not.toBeNull();
    const tomorrow = (await svc.board('tomorrow', seller)).katta[0];
    expect(tomorrow).toMatchObject({ order_status: null, poputi_open: false, current_order_id: null });
  });

  it("tomorrow's booking belongs to tomorrow's tab, not today's", async () => {
    const { svc } = makePrisma({ orders: [tomorrows] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([truck]);
    expect((await svc.board('free', seller)).katta[0]).toMatchObject({ card_state: 'available_working', confirmed_slots: 0 });
    expect((await svc.board('tomorrow', seller)).katta[0]).toMatchObject({ card_state: 'one_load', confirmed_slots: 1 });
  });

  it("cannot be booked Polniy while yesterday's load is still aboard", async () => {
    const { svc } = makePrisma({ orders: [yesterdays] });
    await expect(svc.reserve('v1', { kind: 'zanyat', mode: 'full' }, seller)).rejects.toBeInstanceOf(ConflictException);
  });

  it('names the paper that ran out, and the card keeps its working colour', async () => {
    const { svc } = makePrisma({ orders: [yesterdays] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([
      {
        ...truck,
        documents: [
          { type: 'texosmotr', expiresAt: new Date('2026-09-01T00:00:00Z') },
          { type: 'insurance', expiresAt: new Date('2027-01-01T00:00:00Z') },
        ],
      },
    ]);
    expect((await svc.board('busy', seller)).katta[0]).toMatchObject({
      card_state: 'one_load',
      blocked_reason: 'documents',
      expired_docs: ['texosmotr'],
    });
  });

  it('names the paper when inspection or insurance is not on file at all', async () => {
    const { svc } = makePrisma({ orders: [yesterdays] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([{ ...truck, documents: [PAPERS[0]] }]);
    expect((await svc.board('busy', seller)).katta[0]).toMatchObject({
      card_state: 'one_load',
      blocked_reason: 'missing_documents',
      missing_docs: ['insurance'],
    });
  });

  it("names it when the driver's licence has run out", async () => {
    const { svc } = makePrisma({ orders: [yesterdays] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([
      { ...truck, driver: { ...truck.driver, licenseExpiresAt: new Date('2020-01-01T00:00:00.000Z') } },
    ]);
    expect((await svc.board('busy', seller)).katta[0]).toMatchObject({
      card_state: 'one_load',
      blocked_reason: 'license_expired',
    });
  });

  it("reports what the lorry's record is missing without colouring the card", async () => {
    const { svc } = makePrisma({ orders: [yesterdays] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([
      {
        ...truck,
        capacityKg: null,
        driver: { ...truck.driver, licenseCategory: null },
      },
    ]);
    // A gap in our own paperwork is the office's to close; the seller's card
    // goes on reading the lorry's work.
    expect((await svc.board('busy', seller)).katta[0]).toMatchObject({
      card_state: 'one_load',
      blocked_reason: null,
      missing_fields: ['capacity', 'license_category'],
    });
  });

  it('does not call a lorry taken off the fleet a repair job', async () => {
    const { svc } = makePrisma({ orders: [yesterdays] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([{ ...truck, status: 'inactive' }]);
    expect((await svc.board('busy', seller)).katta[0]).toMatchObject({
      card_state: 'blocked',
      blocked_reason: 'inactive',
    });
  });

  it('calls a van at the repair shop repair, not paperwork', async () => {
    const { svc } = makePrisma({ orders: [yesterdays] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findMany.mockResolvedValue([{ ...truck, status: 'maintenance' }]);
    expect((await svc.board('busy', seller)).katta[0]).toMatchObject({
      card_state: 'blocked',
      blocked_reason: 'repair',
      expired_docs: [],
    });
  });

  it('takes a booking for a lorry whose driver has not clocked in', async () => {
    const { svc } = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.vehicle.findUnique.mockResolvedValue({
      id: 'v1', capacityKg: 2000, driver: { id: 'drv1', currentStatus: 'offline' },
    });
    await expect(svc.reserve('v1', { kind: 'zanyat', mode: 'single' }, seller)).resolves.toBeDefined();
  });

  it('refuses today for a driver who took "Polniy", but tomorrow is open (owner, 12.11.2026)', async () => {
    const { svc } = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (svc as any).prisma;
    p.vehicle.findUnique.mockResolvedValue({ id: 'v1', capacityKg: 2000, driver: { id: 'drv1', currentStatus: 'offline' } });
    p.workLog.findMany.mockResolvedValue([{ driverId: 'drv1' }]);
    await expect(svc.reserve('v1', { kind: 'zanyat', mode: 'single' }, seller)).rejects.toThrow('driver_day_off');
  });

  it('refuses a booking for a day that has already passed', async () => {
    const { svc } = makePrisma();
    await expect(
      svc.reserve('v1', { kind: 'bron', mode: 'single', scheduled_date: '2026-09-26' }, seller),
    ).rejects.toThrow('scheduled_date_in_past');
  });
});

describe('SellerBoardService — the day turns at midnight Tashkent, not 05:00', () => {
  // 27.09 02:00 Tashkent is still 26.09 in UTC.
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-09-26T21:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  it("a booking made at 02:00 is today's, and today is 27.09", async () => {
    const { svc, prisma } = makePrisma();
    await svc.reserve('v1', { kind: 'zanyat', mode: 'single' }, seller);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.reservation as any).create.mock.calls[0][0].data.scheduledDate).toEqual(new Date('2026-09-27T00:00:00Z'));
  });
});

describe("SellerBoardService — booking for another seller's client", () => {
  const slotOf = {
    id: 'r0', groupId: 'g1', sellerId: 's1', status: 'awaiting', fillDeadline: future(),
    kind: 'zanyat', fullBooking: false, isBackhaul: false, queuePosition: 1, sequenceIndex: 0, scheduledDate: today(),
    vehicle: { capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: PAPERS, driver: { id: 'drv1', currentStatus: 'available' } },
  };

  it('refuses to fill a booking with a client that belongs to someone else', async () => {
    const { svc, prisma } = makePrisma({ slot: slotOf });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.client as any).findUnique.mockResolvedValue({ id: 'c1', sellerId: 'other', name: 'X', phoneNumber: '+998', address: 'T' });
    await expect(svc.fill('r0', FILL as never, seller)).rejects.toThrow('client_not_found');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.order as any).create).not.toHaveBeenCalled();
  });

  it('refuses a po puti search for a client that belongs to someone else', async () => {
    const { svc, prisma } = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.client as any).findUnique.mockResolvedValue({ id: 'c1', sellerId: 'other', lat: 41.3, lng: 69.2 });
    await expect(svc.searchPoputi({ client_id: 'c1' } as never, seller)).rejects.toThrow('client_not_found');
  });
});

describe('SellerBoardService — "Ishxona ishi bilan" (owner, 12.11.2026)', () => {
  const admin = { userId: 'a1', role: 'admin' };
  const lorry = { id: 'v1', model: 'Gazel', plateNumber: '01 A', type: 'truck', category: null, capacityKg: 2000, lengthCm: 420, widthCm: 200, heightCm: 200, documents: [], driver: { id: 'd1', currentStatus: 'available', licenseCategory: 'B', user: { name: 'A' } } };

  it('takes a free lorry for the errands and how long', async () => {
    const { svc, prisma } = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prisma as any;
    p.vehicle.findUnique.mockResolvedValue({ id: 'v1', status: 'active', driver: { id: 'd1', userId: 'u1' } });
    p.reservation.count = jest.fn().mockResolvedValue(0);
    p.user = { findUnique: jest.fn().mockResolvedValue({ name: 'Anvar' }) };
    p.companyJob.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'j1', ...data }));
    const r = await svc.startCompanyJob('v1', { tasks: [' Bankka hujjat ', 'Soliqqa'], minutes: 90 }, admin);
    expect(r.id).toBe('j1');
    expect(p.companyJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vehicleId: 'v1', driverId: 'd1', tasks: ['Bankka hujjat', 'Soliqqa'], minutes: 90, createdByName: 'Anvar' }),
    });
  });

  it('refuses while the driver carries an order', async () => {
    const { svc, prisma } = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prisma as any;
    p.vehicle.findUnique.mockResolvedValue({ id: 'v1', status: 'active', driver: { id: 'd1', userId: 'u1' } });
    p.order.count = jest.fn().mockResolvedValue(1);
    await expect(svc.startCompanyJob('v1', { tasks: ['Bank'], minutes: 60 }, admin)).rejects.toThrow('vehicle_busy');
  });

  it('the card says so, and the lorry stays free and bookable', async () => {
    const { svc, prisma } = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prisma as any;
    p.vehicle.findMany = jest.fn().mockResolvedValue([lorry]);
    const until = new Date(Date.now() + 3_600_000);
    p.companyJob.findMany.mockResolvedValue([{ id: 'j1', vehicleId: 'v1', tasks: ['Bank'], until, createdByName: 'Anvar' }]);
    const free = await svc.board('free', seller);
    expect(free.katta[0].board_status).toBe('free');
    expect(free.katta[0].company_job).toEqual({ id: 'j1', tasks: ['Bank'], until: until.toISOString(), created_by_name: 'Anvar' });
    await expect(svc.reserve('v1', { kind: 'zanyat', mode: 'single' }, seller)).resolves.toBeDefined();
  });

  it('the "Nima ish bilan?" list: one already there in another case is not added twice', async () => {
    const { svc, prisma } = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prisma as any;
    p.companyJobOption = {
      findFirst: jest.fn().mockResolvedValue({ id: 'o1', name: 'Bankka hujjat' }),
      create: jest.fn(),
    };
    expect(await svc.addCompanyJobOption('  bankka   HUJJAT ')).toEqual({ id: 'o1', name: 'Bankka hujjat' });
    expect(p.companyJobOption.create).not.toHaveBeenCalled();
    p.companyJobOption.findFirst.mockResolvedValue(null);
    p.companyJobOption.create.mockResolvedValue({ id: 'o2', name: 'Soliqqa' });
    expect(await svc.addCompanyJobOption('Soliqqa')).toEqual({ id: 'o2', name: 'Soliqqa' });
  });
});
