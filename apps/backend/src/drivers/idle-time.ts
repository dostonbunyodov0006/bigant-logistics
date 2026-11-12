import { tashkentDateKey, tashkentDayStartUtc } from '../common/tashkent-time';
import { workedByDay } from './shift-time';

/**
 * Bo'sh vaqt (owner, 05.11.2026): the time a lorry stood with its shift open
 * and no order in hand. Per Tashkent day: the shift's worked minutes (breaks
 * already out), less the minutes an order was in hand inside the shift, less
 * the hour of lunch — a Tanaffus he pressed counts towards that hour.
 *
 * An order is in hand from the moment he set off on it to delivery, or to the
 * goods brought back when it had a return. Pure: dates in, minutes out.
 */

const MIN = 60_000;
const DAY = 86_400_000;
export const LUNCH_MINUTES = 60;

export type IdleShift = { clockInAt: Date; clockOutAt: Date | null; breakMinutes: number };
export type Busy = { from: Date; to: Date };

/** Busy intervals merged into non-overlapping ones, in order. */
function merge(spans: { from: number; to: number }[]): { from: number; to: number }[] {
  const sorted = spans.filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/** Minutes of `spans` falling on each Tashkent day. */
function perDay(spans: { from: number; to: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of spans) {
    let cursor = s.from;
    while (cursor < s.to) {
      const date = tashkentDateKey(new Date(cursor));
      const end = Math.min(s.to, tashkentDayStartUtc(date).getTime() + DAY);
      out.set(date, (out.get(date) ?? 0) + (end - cursor) / MIN);
      cursor = end;
    }
  }
  return out;
}

export type DayTimes = { worked: number; busy: number; lunch: number; idle: number };

/**
 * One driver's day, per Tashkent day within [from, to] (inclusive date keys),
 * adding up: the shift ("Ishni boshlash" to "Ishni tugatish") = on orders +
 * lunch (the hour, or the Tanaffus he pressed if longer) + idle.
 */
export function idleByDay(
  shifts: IdleShift[],
  busy: Busy[],
  range: { from: string; to: string },
): Map<string, DayTimes> {
  const worked = new Map<string, number>();
  const inHand = new Map<string, number>();
  const breaks = new Map<string, number>();
  for (const s of shifts) {
    if (!s.clockOutAt) continue;
    for (const d of workedByDay({ ...s, breakMinutes: 0 })) worked.set(d.date, (worked.get(d.date) ?? 0) + d.minutes);
    const start = tashkentDateKey(s.clockInAt);
    breaks.set(start, (breaks.get(start) ?? 0) + s.breakMinutes);
    const a = s.clockInAt.getTime();
    const b = s.clockOutAt.getTime();
    const clipped = merge(busy.map((x) => ({ from: Math.max(a, x.from.getTime()), to: Math.min(b, x.to.getTime()) })));
    for (const [date, m] of perDay(clipped)) inHand.set(date, (inHand.get(date) ?? 0) + m);
  }
  const out = new Map<string, DayTimes>();
  for (const [date, w] of worked) {
    if (date < range.from || date > range.to) continue;
    const b = Math.min(w, Math.round(inHand.get(date) ?? 0));
    const lunch = Math.min(w - b, Math.max(LUNCH_MINUTES, breaks.get(date) ?? 0));
    out.set(date, { worked: w, busy: b, lunch, idle: w - b - lunch });
  }
  return out;
}

/** When an order stopped being in hand: delivered, its goods back, or cancelled. */
export function busyOf(
  o: {
    status: string;
    journeyStartedAt: Date | null;
    deliveredAt: Date | null;
    returnedAt: Date | null;
    updatedAt: Date;
  },
  now: Date,
): Busy | null {
  if (!o.journeyStartedAt) return null;
  const ends = [o.deliveredAt, o.returnedAt].filter((d): d is Date => !!d).map((d) => d.getTime());
  // Still running (on the way, bringing goods back, a problem): in hand until now.
  const finished = ['delivered', 'returned', 'cancelled'].includes(o.status);
  const to = !finished ? now.getTime() : ends.length ? Math.max(...ends) : o.updatedAt.getTime();
  return { from: o.journeyStartedAt, to: new Date(Math.max(to, o.journeyStartedAt.getTime())) };
}
