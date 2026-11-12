/*
 * Tashkent time, whatever the phone is set to (owner, 06.11.2026).
 *
 * The business runs on Tashkent's clock — UTC+5 all year, no summer time since
 * 1992 — but Date's local getters and toLocale* follow the phone's own zone
 * setting, and a phone set to Moscow or left on UTC showed every hour wrong and
 * rolled "today" over at the wrong midnight. So a moment is shifted by five
 * hours and read with the getUTC* methods: plain arithmetic, no reliance on
 * Hermes' Intl time-zone data. What goes to the server stays an ISO UTC instant.
 */
export const TASHKENT_OFFSET_MS = 5 * 3_600_000;

type Moment = Date | string | number;

/** A Date whose UTC fields are the Tashkent wall clock of that moment. */
function shifted(at: Moment): Date {
  return new Date(new Date(at).getTime() + TASHKENT_OFFSET_MS);
}
const two = (n: number) => String(n).padStart(2, '0');

/** "2026-11-07" — the Tashkent calendar day of a moment (now by default). */
export function tashkentDayKey(at: Moment = Date.now()): string {
  const d = shifted(at);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

/** "00:30" — the Tashkent hour and minute of a moment. */
export function tashkentClock(at: Moment = Date.now()): string {
  const d = shifted(at);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** "07.11.2026" — the Tashkent day, the way the office writes it. */
export function tashkentDmy(at: Moment): string {
  const d = shifted(at);
  return `${two(d.getUTCDate())}.${two(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** 0–11: the Tashkent month of a moment (now by default). */
export function tashkentMonth(at: Moment = Date.now()): number {
  return shifted(at).getUTCMonth();
}

/** "2026-11-30" + 1 → "2026-12-01": calendar arithmetic on a day key, no zone in it. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n));
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}`;
}

/** The instant a Tashkent wall clock reads that day and hour. */
export function tashkentAt(day: string, hour: number, minute: number): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour, minute) - TASHKENT_OFFSET_MS);
}

/**
 * A phone-local Date whose local fields read the Tashkent wall clock. For what
 * only formats or shows local fields — toLocale* (the phone's own language and
 * date style stay) and the native date/time picker; never sent anywhere.
 */
export function tashkentWall(at: Moment): Date {
  const d = shifted(at);
  return new Date(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds(),
  );
}

/** Back from tashkentWall: the local fields a picker returned, read as Tashkent's. */
export function fromTashkentWall(wall: Date): Date {
  return new Date(
    Date.UTC(
      wall.getFullYear(), wall.getMonth(), wall.getDate(),
      wall.getHours(), wall.getMinutes(), wall.getSeconds(), wall.getMilliseconds(),
    ) - TASHKENT_OFFSET_MS,
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return tashkentWall(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return tashkentWall(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return tashkentWall(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/**
 * An Ertangi booking carries a day, not an hour: what the seller chose is
 * "9:00 dan oldin" or "9:00 dan keyin". Null for an order with a real time.
 */
export function startSlotKey(order: { actions_available_at?: string | null; start_after_nine?: boolean }): string | null {
  if (!order.actions_available_at) return null;
  return order.start_after_nine ? 'orders.after9' : 'orders.before9';
}
