import { driverActionsAvailableAt, isActionable } from './order-timing';

describe('Ertangi unlock time', () => {
  const day = new Date('2026-10-29T00:00:00.000Z'); // the 29th, as a label

  it('opens at 00:01 Tashkent when booked for before 9:00', () => {
    const o = { bookingKind: 'bron' as const, deliveryDatetime: day, startAfterNine: false };
    expect(driverActionsAvailableAt(o)?.toISOString()).toBe('2026-10-28T19:01:00.000Z');
    expect(isActionable(o, new Date('2026-10-29T01:00:00.000Z'))).toBe(true); // 06:00
  });

  it('stays locked until 09:00 Tashkent when booked for after 9:00', () => {
    const o = { bookingKind: 'bron' as const, deliveryDatetime: day, startAfterNine: true };
    expect(driverActionsAvailableAt(o)?.toISOString()).toBe('2026-10-29T04:00:00.000Z');
    expect(isActionable(o, new Date('2026-10-29T03:59:00.000Z'))).toBe(false); // 08:59
    expect(isActionable(o, new Date('2026-10-29T04:00:00.000Z'))).toBe(true); // 09:00
  });

  it('leaves today\'s work open whatever the flag', () => {
    const o = { bookingKind: 'zanyat' as const, deliveryDatetime: new Date('2026-10-28T07:12:00.000Z'), startAfterNine: true };
    expect(driverActionsAvailableAt(o)).toBeNull();
  });
});
