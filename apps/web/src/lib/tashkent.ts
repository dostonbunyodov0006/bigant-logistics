/**
 * Every date and time on the site is Tashkent's, whatever the computer's own
 * clock or zone says — the server counts days in Tashkent, and the screen has
 * to agree with it (owner, 29.10.2026). Tashkent keeps +05:00 all year.
 */
export const TZ = 'Asia/Tashkent';
const OFFSET = '+05:00';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(at: Date | string | number) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute };
}

/** "YYYY-MM-DD" of the moment, in Tashkent. */
export function tkYmd(at: Date | string | number = new Date()): string {
  const { y, m, d } = parts(at);
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM" of the moment, in Tashkent. */
export const tkYm = (at: Date | string | number = new Date()): string => tkYmd(at).slice(0, 7);

/** The first day of this month, in Tashkent. */
export const tkMonthStart = (): string => `${tkYm()}-01`;

/** A day label moved by whole days ("2026-10-29", 1 → "2026-10-30"). */
export function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** ISO → the "YYYY-MM-DDTHH:mm" a datetime-local input shows, in Tashkent. */
export function tkInput(at: Date | string | number | null = new Date()): string {
  if (at == null) return '';
  const { y, m, d, hh, mm } = parts(at);
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

/** What a datetime-local input (or a date + time pair) holds, read as Tashkent time. */
export function fromTkInput(value: string): string {
  const v = value.length === 16 ? `${value}:00` : value;
  return new Date(`${v}${OFFSET}`).toISOString();
}

/** Whole days from today (Tashkent) to the given day; negative once it has passed. */
export function daysUntil(at: string): number {
  return Math.round((Date.parse(`${tkYmd(at)}T00:00:00Z`) - Date.parse(`${tkYmd()}T00:00:00Z`)) / 86_400_000);
}
