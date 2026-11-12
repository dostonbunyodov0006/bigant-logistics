/**
 * Tashkent local time (UTC+5, no DST).
 *
 * Attendance is judged against the driver's wall clock, so every comparison —
 * which calendar day a shift belongs to, which weekday's schedule applies, how
 * many minutes late they are — has to be done in Tashkent time, never in the
 * server's timezone and never on the phone (whose clock the driver controls).
 */
export const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** The instant shifted into Tashkent time, for reading UTC* getters as local. */
function shifted(date: Date): Date {
  return new Date(date.getTime() + TASHKENT_OFFSET_MS);
}

/** Calendar day in Tashkent as YYYY-MM-DD. */
export function tashkentDateKey(date: Date): string {
  return shifted(date).toISOString().slice(0, 10);
}

/**
 * The Tashkent calendar day as a UTC-midnight date label — the way seller-board
 * scheduled days are stored. Deriving it from the UTC date instead moved "today"
 * to 05:00 Tashkent: until then, the board was still showing yesterday.
 */
export function tashkentDateLabel(date: Date): Date {
  return new Date(`${tashkentDateKey(date)}T00:00:00.000Z`);
}

/** Weekday in Tashkent, 0 = Sunday .. 6 = Saturday. */
export function tashkentWeekday(date: Date): number {
  return shifted(date).getUTCDay();
}

/** Minutes since midnight in Tashkent. */
export function tashkentMinutes(date: Date): number {
  const d = shifted(date);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Local HH:MM in Tashkent. */
export function tashkentHhmm(date: Date): string {
  const d = shifted(date);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Tashkent local date and time for reports: dd.MM.yyyy HH:mm. */
export function tashkentDateTime(date: Date): string {
  const d = shifted(date);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "HH:MM" → minutes since midnight. Returns null for anything malformed. */
export function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** UTC instant of 00:00 Tashkent on the given YYYY-MM-DD. */
export function tashkentDayStartUtc(dateKey: string): Date {
  return new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() - TASHKENT_OFFSET_MS);
}

/** Inclusive list of YYYY-MM-DD keys from `from` to `to`. */
export function dateKeyRange(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  for (let t = new Date(`${from}T00:00:00.000Z`).getTime(); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Weekday (0–6) of a YYYY-MM-DD key. */
export function dateKeyWeekday(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}
