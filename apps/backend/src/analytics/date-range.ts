import { tashkentDayStartUtc } from '../common/tashkent-time';

const DAY_MS = 86_400_000;

/** [start, end) in UTC for Tashkent calendar days `from`..`to` (either side open). */
export function dayRange(from?: string, to?: string): { gte?: Date; lt?: Date } {
  return {
    ...(from ? { gte: tashkentDayStartUtc(from) } : {}),
    ...(to ? { lt: new Date(tashkentDayStartUtc(to).getTime() + DAY_MS) } : {}),
  };
}

/** [start, end) in UTC for one Tashkent calendar day. */
export function oneDay(date: string): { gte: Date; lt: Date } {
  const gte = tashkentDayStartUtc(date);
  return { gte, lt: new Date(gte.getTime() + DAY_MS) };
}

/** [start, end) in UTC for a Tashkent calendar month, "YYYY-MM". */
export function monthRange(month: string): { gte: Date; lt: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { gte: tashkentDayStartUtc(`${month}-01`), lt: tashkentDayStartUtc(`${next}-01`) };
}
