import { isPayDayLocked, periodLockedAt } from './period-lock';

/** A Tashkent wall-clock time (UTC+5) as an instant. */
const tk = (s: string) => new Date(`${s}+05:00`);

describe('pay period lock (owner, 07.11.2026)', () => {
  it('a period locks on the 16th at 12:00 Tashkent', () => {
    expect(periodLockedAt('2026-10-16').toISOString()).toBe(tk('2026-11-16T12:00:00').toISOString());
    expect(periodLockedAt('2026-11-15').toISOString()).toBe(tk('2026-11-16T12:00:00').toISOString());
    expect(periodLockedAt('2026-11-16').toISOString()).toBe(tk('2026-12-16T12:00:00').toISOString());
  });

  it('the 15th at 23:59 belongs to the old period, the 16th at 00:00 to the new one', () => {
    expect(periodLockedAt(tk('2026-11-15T23:59:00')).toISOString()).toBe(tk('2026-11-16T12:00:00').toISOString());
    expect(periodLockedAt(tk('2026-11-16T00:00:00')).toISOString()).toBe(tk('2026-12-16T12:00:00').toISOString());
  });

  it('the old period is still open on the 16th at 11:59 and locked at 12:00', () => {
    const lastEvening = tk('2026-11-15T23:59:00');
    expect(isPayDayLocked(lastEvening, tk('2026-11-16T11:59:59'))).toBe(false);
    expect(isPayDayLocked(lastEvening, tk('2026-11-16T12:00:00'))).toBe(true);
    expect(isPayDayLocked('2026-11-15', tk('2026-11-16T12:00:00'))).toBe(true);
    // The new period is not touched by the old one locking.
    expect(isPayDayLocked(tk('2026-11-16T00:00:00'), tk('2026-11-16T12:00:00'))).toBe(false);
  });

  it('wraps the year: December 16th to January 15th locks on 16 January', () => {
    expect(periodLockedAt('2026-12-20').toISOString()).toBe(tk('2027-01-16T12:00:00').toISOString());
    expect(periodLockedAt('2027-01-10').toISOString()).toBe(tk('2027-01-16T12:00:00').toISOString());
  });

  it('a day in an older period stays locked', () => {
    expect(isPayDayLocked('2026-09-20', tk('2026-11-07T10:00:00'))).toBe(true);
    expect(isPayDayLocked('2026-10-20', tk('2026-11-07T10:00:00'))).toBe(false);
  });
});
