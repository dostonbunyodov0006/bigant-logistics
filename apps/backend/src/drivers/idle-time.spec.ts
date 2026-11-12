import { busyOf, idleByDay } from './idle-time';

// Tashkent is UTC+5: 09:00 local = 04:00Z.
const at = (s: string) => new Date(`${s}+05:00`);
const range = { from: '2026-11-01', to: '2026-11-30' };

describe("Bo'sh vaqt (owner, 05.11.2026)", () => {
  it('a shift with no order: all of it, less the lunch hour', () => {
    const idle = idleByDay([{ clockInAt: at('2026-11-05T09:00:00'), clockOutAt: at('2026-11-05T18:00:00'), breakMinutes: 0 }], [], range);
    expect(idle.get('2026-11-05')?.idle).toBe(8 * 60);
  });

  it('time with an order in hand is not idle', () => {
    const idle = idleByDay(
      [{ clockInAt: at('2026-11-05T09:00:00'), clockOutAt: at('2026-11-05T18:00:00'), breakMinutes: 0 }],
      [{ from: at('2026-11-05T10:00:00'), to: at('2026-11-05T13:00:00') }],
      range,
    );
    expect(idle.get('2026-11-05')).toEqual({ worked: 9 * 60, busy: 3 * 60, lunch: 60, idle: 5 * 60 }); // 9 − 3 − 1
  });

  it('two orders riding together are counted once', () => {
    const idle = idleByDay(
      [{ clockInAt: at('2026-11-05T09:00:00'), clockOutAt: at('2026-11-05T18:00:00'), breakMinutes: 0 }],
      [
        { from: at('2026-11-05T10:00:00'), to: at('2026-11-05T13:00:00') },
        { from: at('2026-11-05T11:00:00'), to: at('2026-11-05T14:00:00') },
      ],
      range,
    );
    expect(idle.get('2026-11-05')).toEqual({ worked: 9 * 60, busy: 4 * 60, lunch: 60, idle: 4 * 60 }); // 9 − 4 − 1
  });

  it('a Tanaffus he pressed counts towards the lunch hour, not twice', () => {
    const shift = { clockInAt: at('2026-11-05T09:00:00'), clockOutAt: at('2026-11-05T18:00:00') };
    expect(idleByDay([{ ...shift, breakMinutes: 40 }], [], range).get('2026-11-05')?.idle).toBe(8 * 60);
    expect(idleByDay([{ ...shift, breakMinutes: 90 }], [], range).get('2026-11-05')).toEqual({ worked: 9 * 60, busy: 0, lunch: 90, idle: 9 * 60 - 90 });
  });

  it('an order outside the shift does not count', () => {
    const idle = idleByDay(
      [{ clockInAt: at('2026-11-05T09:00:00'), clockOutAt: at('2026-11-05T12:00:00'), breakMinutes: 0 }],
      [{ from: at('2026-11-05T11:00:00'), to: at('2026-11-05T15:00:00') }],
      range,
    );
    expect(idle.get('2026-11-05')?.idle).toBe(60); // 3 − 1 − 1
  });

  it('never below zero, and days outside the range are left out', () => {
    const idle = idleByDay(
      [
        { clockInAt: at('2026-11-05T09:00:00'), clockOutAt: at('2026-11-05T09:30:00'), breakMinutes: 0 },
        { clockInAt: at('2026-10-31T09:00:00'), clockOutAt: at('2026-10-31T18:00:00'), breakMinutes: 0 },
      ],
      [],
      range,
    );
    expect(idle.get('2026-11-05')?.idle).toBe(0);
    expect(idle.has('2026-10-31')).toBe(false);
  });

  it('an order is in hand from setting off to delivery, or to the goods back', () => {
    const now = at('2026-11-05T17:00:00');
    const base = { journeyStartedAt: at('2026-11-05T10:00:00'), deliveredAt: null, returnedAt: null, updatedAt: at('2026-11-05T12:00:00') };
    expect(busyOf({ ...base, status: 'driver_accepted', journeyStartedAt: null }, now)).toBeNull();
    expect(busyOf({ ...base, status: 'on_the_way' }, now)?.to).toEqual(now);
    expect(busyOf({ ...base, status: 'delivered', deliveredAt: at('2026-11-05T13:00:00') }, now)?.to).toEqual(at('2026-11-05T13:00:00'));
    expect(
      busyOf({ ...base, status: 'returned', deliveredAt: at('2026-11-05T13:00:00'), returnedAt: at('2026-11-05T15:00:00') }, now)?.to,
    ).toEqual(at('2026-11-05T15:00:00'));
    expect(busyOf({ ...base, status: 'returning', deliveredAt: at('2026-11-05T13:00:00') }, now)?.to).toEqual(now);
    expect(busyOf({ ...base, status: 'cancelled' }, now)?.to).toEqual(at('2026-11-05T12:00:00'));
  });
});
