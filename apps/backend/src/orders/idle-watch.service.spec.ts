import { IdleWatchService } from './idle-watch.service';

const T0 = new Date('2026-11-02T05:00:00Z'); // Monday 10:00 Tashkent
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
// The first pickup, and points 1 km and 600 m from it (due south).
const PICKUP = { lat: 41.31, lng: 69.25 };
const FAR = { lat: 41.301, lng: 69.25 };
const NEARER = { lat: 41.3046, lng: 69.25 };

type Row = Record<string, unknown> & { id: string };

function order(over: Partial<Row> = {}): Row {
  return {
    id: 'o1',
    status: 'driver_accepted',
    assignedDriverId: 'd1',
    createdBySellerId: 'seller1',
    clientName: 'Barakat',
    bookingKind: 'zanyat',
    deliveryDatetime: T0,
    startAfterNine: false,
    idleWatchSince: null,
    idleStartMetres: null,
    idleState: null,
    pickupSources: [{ position: 0, legStatus: 'pending', ...PICKUP }],
    ...over,
  };
}

/** A tiny store: orders keep what the service writes, so ticks can follow one another. */
function make(opts: { orders: Row[]; onShift?: boolean; busy?: boolean; pos?: { lat: number; lng: number }; fixAt?: Date }) {
  const rows = opts.orders;
  let pos = opts.pos ?? FAR;
  let fixAt = opts.fixAt ?? T0;
  const prisma = {
    order: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { OR?: unknown } }) =>
        Promise.resolve(where.OR ? (opts.busy ? [{ assignedDriverId: 'd1' }] : []) : rows.filter((r) => r.status === 'driver_accepted')),
      ),
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Row }) => {
        Object.assign(rows.find((r) => r.id === where.id)!, data);
        return Promise.resolve({});
      }),
    },
    driver: {
      findMany: jest.fn().mockImplementation(() =>
        Promise.resolve([{ id: 'd1', userId: 'u-d1', locationLat: pos.lat, locationLng: pos.lng, locationUpdatedAt: fixAt, vehicle: { plateNumber: '01 T 001 TT' } }]),
      ),
    },
    workLog: { findMany: jest.fn().mockResolvedValue(opts.onShift === false ? [] : [{ driverId: 'd1' }]) },
  };
  const orders = { cancel: jest.fn().mockImplementation((id: string) => { rows.find((r) => r.id === id)!.status = 'cancelled'; return Promise.resolve({}); }) };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new IdleWatchService(prisma as any, orders as any, notifications as any);
  return {
    svc,
    orders,
    notifications,
    move: (p: { lat: number; lng: number }, when: Date) => {
      pos = p;
      fixAt = when;
    },
  };
}

describe('the stalled-lorry watch', () => {
  it('warns the driver and the seller at 10 minutes and cancels at 15 when the lorry does not move', async () => {
    const t = make({ orders: [order()] });
    expect(await t.svc.sweep(at(0))).toEqual({ o1: 'started' });
    t.move(FAR, at(9));
    expect(await t.svc.sweep(at(9))).toEqual({ o1: 'waiting' });
    t.move(FAR, at(10));
    expect(await t.svc.sweep(at(10))).toEqual({ o1: 'warned' });
    expect(t.notifications.notify.mock.calls.map((c) => [c[0], c[1].title])).toEqual([
      ['u-d1', 'Harakatlaning, zakaz tomon'],
      ['seller1', 'Biriktirilgan mashina harakatsiz'],
    ]);
    t.move(FAR, at(14));
    expect(await t.svc.sweep(at(14))).toEqual({ o1: 'waiting' });
    t.move(FAR, at(15));
    expect(await t.svc.sweep(at(15))).toEqual({ o1: 'cancelled' });
    expect(t.orders.cancel).toHaveBeenCalledWith('o1', expect.stringContaining('15 daqiqa'), expect.objectContaining({ role: 'admin' }));
    expect(t.notifications.notify).toHaveBeenCalledTimes(4);
  });

  it('leaves a lorry alone once it has come 200 m nearer the pickup', async () => {
    const t = make({ orders: [order()] });
    await t.svc.sweep(at(0));
    t.move(NEARER, at(6));
    expect(await t.svc.sweep(at(6))).toEqual({ o1: 'moved' });
    t.move(FAR, at(16));
    expect(await t.svc.sweep(at(16))).toEqual({});
    expect(t.notifications.notify).not.toHaveBeenCalled();
    expect(t.orders.cancel).not.toHaveBeenCalled();
  });

  it('leaves an office offer not yet accepted to the older 10-minute rule', async () => {
    const t = make({ orders: [order({ status: 'assigned_to_driver' })] });
    expect(await t.svc.sweep(at(0))).toEqual({});
  });

  it('counts a closed app — no fresh position — as not moving', async () => {
    const t = make({ orders: [order()], fixAt: at(-30) });
    await t.svc.sweep(at(0));
    expect(await t.svc.sweep(at(10))).toEqual({ o1: 'warned' });
  });

  it('does not watch a driver off shift, or one with other work under way', async () => {
    expect(await make({ orders: [order()], onShift: false }).svc.sweep(at(0))).toEqual({});
    expect(await make({ orders: [order()], busy: true }).svc.sweep(at(0))).toEqual({});
  });

  it("watches only the driver's next order, and not tomorrow's booking", async () => {
    const t = make({ orders: [order(), order({ id: 'o2' })] });
    expect(await t.svc.sweep(at(0))).toEqual({ o1: 'started' });
    const tomorrow = make({ orders: [order({ bookingKind: 'bron', deliveryDatetime: new Date('2026-11-03T00:00:00Z') })] });
    expect(await tomorrow.svc.sweep(at(0))).toEqual({});
  });

  it('starts afresh when the order stops being his turn', async () => {
    const rows = [order()];
    const t = make({ orders: rows });
    await t.svc.sweep(at(0));
    const offShift = make({ orders: rows, onShift: false });
    expect(await offShift.svc.sweep(at(5))).toEqual({ o1: 'reset' });
    expect(rows[0]!.idleWatchSince).toBeNull();
  });
});
