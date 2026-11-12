import { setShiftClock, shiftStartLabel, shiftStartUtcMs } from './shift-clock';
import { driverActionsAvailableAt } from '../orders/order-timing';
import { morningNineFor } from '../orders/morning-start';

const tomorrow = new Date('2026-10-31T00:00:00.000Z');
const booking = (startAfterNine: boolean) =>
  ({ bookingKind: 'bron', deliveryDatetime: tomorrow, startAfterNine }) as never;

describe("the shift start and end follow what the office set", () => {
  afterEach(() => setShiftClock('09:00', '18:00'));

  it('09:00 by default', () => {
    expect(shiftStartUtcMs()).toBe(4 * 3_600_000);
    expect(shiftStartLabel()).toBe('09:00');
  });

  it('an order booked for after the start opens at the start the office set', () => {
    setShiftClock('08:30', '17:30');
    // 08:30 Tashkent = 03:30 UTC.
    expect(driverActionsAvailableAt(booking(true))?.toISOString()).toBe('2026-10-31T03:30:00.000Z');
  });

  it('the early-start pay runs up to that start, not to 09:00', () => {
    setShiftClock('08:00', '17:00');
    expect(morningNineFor(booking(false))?.toISOString()).toBe('2026-10-31T03:00:00.000Z');
  });
});
