import { hhmmToMinutes, tashkentDateKey, tashkentDayStartUtc } from '../common/tashkent-time';

/**
 * Shift arithmetic shared by clock-out, the end-of-day check, staff
 * corrections and every report. Pure: dates in, numbers out.
 */

const MIN = 60_000;
const DAY = 86_400_000;

/** The hour (Tashkent) a new shift day begins (owner, 04.11.2026; 05:00 since 07.11.2026). */
export const SHIFT_DAY_START_HOUR = 5;

/**
 * The shift day an instant belongs to, as a Tashkent date key: from 05:00 to
 * 05:00. A clock-in at 19:15 or at 01:00 after a day's work is still that
 * day's shift; a new one begins at five in the morning.
 */
export function shiftDayKey(at: Date): string {
  return tashkentDateKey(new Date(at.getTime() - SHIFT_DAY_START_HOUR * 60 * MIN));
}

/**
 * The instant the shift was expected to end: the `expectedEnd` snapshot taken
 * at clock-in, on the Tashkent day the shift *started*. Null on a day off.
 *
 * Judging against the day of clock-out instead made a delivery finished at
 * 00:21 "1059 minutes early" by the next day's 18:00.
 */
export function shiftDayEnd(clockInAt: Date, expectedEnd: string | null): Date | null {
  const minutes = hhmmToMinutes(expectedEnd);
  if (minutes == null) return null;
  return new Date(tashkentDayStartUtc(tashkentDateKey(clockInAt)).getTime() + minutes * MIN);
}

/** Minutes before the shift day's end that `at` falls; 0 at or after it. */
export function earlyMinutesAt(clockInAt: Date, expectedEnd: string | null, at: Date): number {
  const end = shiftDayEnd(clockInAt, expectedEnd);
  if (!end || at.getTime() >= end.getTime()) return 0;
  return Math.round((end.getTime() - at.getTime()) / MIN);
}

/** Minutes after the shift day's start that `at` falls; 0 at or before it. */
export function lateMinutesAt(clockInAt: Date, expectedStart: string | null): number {
  const minutes = hhmmToMinutes(expectedStart);
  if (minutes == null) return 0;
  const start = tashkentDayStartUtc(tashkentDateKey(clockInAt)).getTime() + minutes * MIN;
  return clockInAt.getTime() > start ? Math.round((clockInAt.getTime() - start) / MIN) : 0;
}

/** Whole minutes worked: clock-in to clock-out, less breaks. Null while open. */
export function netMinutes(log: {
  clockInAt: Date;
  clockOutAt: Date | null;
  breakMinutes?: number;
}): number | null {
  if (!log.clockOutAt) return null;
  const gross = Math.round((log.clockOutAt.getTime() - log.clockInAt.getTime()) / MIN);
  return Math.max(0, gross - (log.breakMinutes ?? 0));
}

/**
 * A closed shift's worked minutes per Tashkent calendar day, in order. A shift
 * over midnight — or a three-day trip to the regions — is credited to each day
 * it covered, not all to the day it began.
 *
 * Break minutes come off the first days first: a break is not recorded with
 * its time of day, and shifts that span days are rare.
 */
export function workedByDay(log: {
  clockInAt: Date;
  clockOutAt: Date | null;
  breakMinutes?: number;
}): { date: string; minutes: number }[] {
  if (!log.clockOutAt) return [];
  const out: { date: string; minutes: number }[] = [];
  let cursor = log.clockInAt.getTime();
  const end = log.clockOutAt.getTime();
  while (cursor < end) {
    const date = tashkentDateKey(new Date(cursor));
    const nextMidnight = tashkentDayStartUtc(date).getTime() + DAY;
    const sliceEnd = Math.min(end, nextMidnight);
    out.push({ date, minutes: (sliceEnd - cursor) / MIN });
    cursor = sliceEnd;
  }
  // Round per day, then make the days add up to the shift's own total.
  const rounded = out.map((d) => ({ date: d.date, minutes: Math.round(d.minutes) }));
  let owed = rounded.reduce((s, d) => s + d.minutes, 0) - (netMinutes(log) ?? 0);
  for (const d of rounded) {
    if (owed <= 0) break;
    const take = Math.min(d.minutes, owed);
    d.minutes -= take;
    owed -= take;
  }
  return rounded;
}

/**
 * Minutes of the current break taken so far: from its start to its planned
 * end, or to now if it is still running or was ended early.
 */
export function breakTakenMinutes(
  driver: { breakStartedAt: Date | null; breakUntil: Date | null },
  now: Date,
): number {
  if (!driver.breakStartedAt) return 0;
  const end = Math.min(now.getTime(), driver.breakUntil?.getTime() ?? now.getTime());
  return Math.max(0, Math.round((end - driver.breakStartedAt.getTime()) / MIN));
}

/** Time off between a close and a reopen the same day (owner, 07.11.2026). */
export type OffPeriod = { from: Date; to: Date };

/** WorkLog.offPeriods as stored (JSON), read back; anything malformed is skipped. */
export function readOffPeriods(raw: unknown): OffPeriod[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p: unknown) => {
    const r = p as { from?: unknown; to?: unknown } | null;
    if (typeof r?.from !== 'string' || typeof r?.to !== 'string') return [];
    const from = new Date(r.from);
    const to = new Date(r.to);
    return Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) ? [] : [{ from, to }];
  });
}
