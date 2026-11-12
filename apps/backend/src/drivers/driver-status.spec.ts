import { settleDriverStatus, statusFromOrders } from './driver-status';

/**
 * The status is what he is carrying. Times are fixed Tashkent moments; an
 * Ertangi booking for 27.09 is stored as 27.09T00:00Z and opens at 00:01
 * Tashkent that day — 26.09T19:01Z.
 */
const MON_11PM_TAS = new Date('2026-09-26T18:00:00Z'); // 26.09 23:00 Tashkent
const TUE_4AM_TAS = new Date('2026-09-26T23:00:00Z'); // 27.09 04:00 Tashkent
const booking27 = { bookingKind: 'bron' as const, deliveryDatetime: new Date('2026-09-27T00:00:00Z') };
const adminOrder = { bookingKind: null, deliveryDatetime: new Date('2026-09-21T06:00:00Z') };

describe('statusFromOrders', () => {
  it('nothing in hand is available', () => {
    expect(statusFromOrders([], TUE_4AM_TAS)).toBe('available');
  });

  it("yesterday's unfinished order is still work today — busy, not Bo'sh", () => {
    expect(statusFromOrders([{ status: 'driver_accepted', ...adminOrder }], TUE_4AM_TAS)).toBe('busy');
  });

  it('on the road outranks everything else aboard', () => {
    expect(
      statusFromOrders([{ status: 'collecting_items', ...adminOrder }, { status: 'on_the_way', ...adminOrder }], TUE_4AM_TAS),
    ).toBe('on_delivery');
  });

  it("an Ertangi booking is not work before 00:01 on its day, and is from then on", () => {
    const o = [{ status: 'driver_accepted', ...booking27 }];
    expect(statusFromOrders(o, MON_11PM_TAS)).toBe('available');
    expect(statusFromOrders(o, TUE_4AM_TAS)).toBe('busy');
  });

  it('a pending offer and a carried return are not work', () => {
    expect(
      statusFromOrders([{ status: 'assigned_to_driver', ...adminOrder }, { status: 'returning', ...adminOrder }], TUE_4AM_TAS),
    ).toBe('available');
  });
});

describe('settleDriverStatus', () => {
  function db(current: string, orders: unknown[]) {
    return {
      driver: { findUnique: jest.fn().mockResolvedValue({ currentStatus: current }), update: jest.fn().mockResolvedValue({}) },
      order: { findMany: jest.fn().mockResolvedValue(orders) },
    };
  }

  it('never brings a clocked-out driver back on — that is the shift’s call', async () => {
    const d = db('offline', []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await settleDriverStatus(d as any, 'drv1', { now: TUE_4AM_TAS })).toEqual({ status: 'offline', changed: false });
    expect(d.driver.update).not.toHaveBeenCalled();
  });

  it("clock-in with yesterday's order still open comes back busy", async () => {
    const d = db('offline', [{ status: 'driver_accepted', ...adminOrder }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await settleDriverStatus(d as any, 'drv1', { comingOnShift: true, now: TUE_4AM_TAS });
    expect(r).toEqual({ status: 'busy', changed: true });
    expect(d.driver.update).toHaveBeenCalledWith({ where: { id: 'drv1' }, data: { currentStatus: 'busy' } });
  });

  it('writes nothing when the status is already right', async () => {
    const d = db('busy', [{ status: 'collecting_items', ...adminOrder }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await settleDriverStatus(d as any, 'drv1', { now: TUE_4AM_TAS })).changed).toBe(false);
    expect(d.driver.update).not.toHaveBeenCalled();
  });
});
