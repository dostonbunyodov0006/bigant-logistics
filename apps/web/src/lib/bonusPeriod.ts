import { tkYmd } from './tashkent';

/**
 * The drivers' bonuses are counted from the 16th of one month to the 15th of
 * the next (owner, 29.10.2026), as the old bonus report was.
 */
export interface BonusPeriod {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The period that starts on the 16th of the given month (1–12). */
function startingIn(year: number, month: number): BonusPeriod {
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return { from: `${year}-${pad(month)}-16`, to: `${next.y}-${pad(next.m)}-15` };
}

/** The period the given day (default today, Tashkent) falls in. */
export function bonusPeriodOf(ymd: string = tkYmd()): BonusPeriod {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  if (d >= 16) return startingIn(y, m);
  return m === 1 ? startingIn(y - 1, 12) : startingIn(y, m - 1);
}

/** The period before (-1) or after (+1) this one. */
export function shiftBonusPeriod(p: BonusPeriod, by: -1 | 1): BonusPeriod {
  const [y, m] = p.from.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + by;
  return startingIn(Math.floor(total / 12), (total % 12) + 1);
}

/**
 * Paid from the Excel and locked on the 16th at 12:00 Tashkent once it is over;
 * the server refuses changes to it from then (owner, 07.11.2026).
 */
export function bonusPeriodLocked(p: BonusPeriod, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(`${shiftBonusPeriod(p, 1).from}T12:00:00+05:00`).getTime();
}

/** "16.10.2026 – 15.11.2026". */
export const bonusPeriodLabel = (p: BonusPeriod) =>
  `${p.from.split('-').reverse().join('.')} – ${p.to.split('-').reverse().join('.')}`;
