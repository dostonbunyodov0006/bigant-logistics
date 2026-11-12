import { tashkentDateKey, tashkentDayStartUtc } from '../common/tashkent-time';

/** Half a day after the period ends, for the last evening's late GPS points. */
const LOCK_DELAY_MS = 12 * 60 * 60 * 1000;

/** A YYYY-MM-DD Tashkent day, or an instant read as its Tashkent day. */
export type PayDay = string | Date;

function dayKey(day: PayDay): string {
  return typeof day === 'string' ? day.slice(0, 10) : tashkentDateKey(day);
}

/**
 * When the pay period holding this Tashkent day locks (owner, 07.11.2026): the
 * period [16.M-1, 16.M) is paid from the Excel and locks on 16.M at 12:00
 * Tashkent; nothing in it changes afterwards.
 */
export function periodLockedAt(day: PayDay): Date {
  const [y, m, d] = dayKey(day).split('-').map(Number) as [number, number, number];
  // The 16th that ends this day's period: this month's, or next month's from the 16th on.
  const end = new Date(Date.UTC(y, d >= 16 ? m : m - 1, 16)).toISOString().slice(0, 10);
  return new Date(tashkentDayStartUtc(end).getTime() + LOCK_DELAY_MS);
}

/** True once the pay period holding this day is locked (owner, 07.11.2026). */
export function isPayDayLocked(day: PayDay, now: Date = new Date()): boolean {
  return now.getTime() >= periodLockedAt(day).getTime();
}
