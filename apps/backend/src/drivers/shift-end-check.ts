import { tashkentDateKey, tashkentDayStartUtc } from '../common/tashkent-time';

/**
 * The end-of-day check for a forgotten clock-out, as pure rules (owner,
 * 03.11.2026).
 *
 * Half an hour after a driver's shift end — 18:30 on the usual day (owner,
 * 10.11.2026; 18:00 from 07.11) — where is he? Outside the city rings he is flagged Viloyat and left alone; his day
 * ends when the lorry crosses back into Tashkent. With an order in hand he is
 * working and is not asked; finishing it after hours no longer ends the day by
 * itself (owner, 10.11.2026). Otherwise he is asked "+30 / Ishni tugatdim" at
 * 18:30 and 19:00, and with no answer by 19:10 the shift is closed for him —
 * ended at the time he last confirmed (owner, 07.11.2026; see confirmedUntil). A shift still open the next day is ended at his
 * last photo sent to the groups (not before the end of his working day),
 * without asking.
 */

export type Zone = 'tashkent' | 'viloyat' | 'unknown';

/** Minutes after the shift end before the first check: asked at 18:30 (owner, 10.11.2026). */
export const END_CHECK_DELAY_MIN = 30;
/** Minutes between checks (and what "+30 min" buys): asked at 18:30 and 19:00. */
export const END_CHECK_INTERVAL_MIN = 30;
/** Minutes after the last unanswered reminder before the shift is closed: 19:10. */
export const CLOSE_AFTER_LAST_MIN = 10;
/** A driver out in a Viloyat is looked at this often, to catch him entering the city. */
export const VILOYAT_CHECK_INTERVAL_MIN = 10;
/** Reminders in a row without an answer before the shift is ended: two, 18:30 and 19:00 (owner, 10.11.2026). */
export const END_CHECK_MAX_UNANSWERED = 2;
/** The longest note he may give with "+30 min" (owner, 07.11.2026). */
export const END_CHECK_NOTE_MAX = 300;
/** A GPS fix older than this is not where he is now. */
export const GPS_FRESH_MIN = 30;

const MIN = 60_000;
/** At the shift's end (plus END_CHECK_DELAY_MIN), on the Tashkent day the shift started. */
export function firstCheckAt(clockInAt: Date, endMinutes: number): Date {
  const dayStart = tashkentDayStartUtc(tashkentDateKey(clockInAt));
  return new Date(dayStart.getTime() + (endMinutes + END_CHECK_DELAY_MIN) * MIN);
}

/** The hour (Tashkent) after which a shift left open from the day before is closed. */
export const STALE_CLOSE_HOUR = 3;

/**
 * Still open from a Tashkent day before today, and it is past 03:00 (owner,
 * 03.11.2026): a driver on the road back from a Viloyat at half past
 * midnight is still working, and the border rule is to end his day, not the
 * calendar.
 */
export function isStale(clockInAt: Date, now: Date): boolean {
  const nextDay = tashkentDayStartUtc(tashkentDateKey(clockInAt)).getTime() + 24 * 60 * MIN;
  return now.getTime() >= nextDay + STALE_CLOSE_HOUR * 60 * MIN;
}

export interface EndCheckShift {
  clockInAt: Date;
  /** The shift day's scheduled end, minutes after midnight Tashkent. */
  endMinutes: number;
  endCheckRanAt: Date | null;
  endCheckZone?: string | null;
  endCheckSentAt: Date | null;
  endCheckAnsweredAt: Date | null;
  endCheckUnanswered: number;
}

/** Whether the check should look at this shift now. */
export function isDue(s: EndCheckShift, now: Date): boolean {
  if (!isStale(s.clockInAt, now) && now.getTime() < firstCheckAt(s.clockInAt, s.endMinutes).getTime()) return false;
  // The last reminder he will get is out and unanswered: ten minutes, then closed.
  const lastAskOut = isAwaitingAnswer(s) && s.endCheckUnanswered >= END_CHECK_MAX_UNANSWERED - 1;
  const interval =
    s.endCheckZone === 'viloyat' ? VILOYAT_CHECK_INTERVAL_MIN : lastAskOut ? CLOSE_AFTER_LAST_MIN : END_CHECK_INTERVAL_MIN;
  if (s.endCheckRanAt && now.getTime() - s.endCheckRanAt.getTime() < interval * MIN) return false;
  return true;
}

export type EndCheckAction =
  /** Outside Tashkent: flagged, shift left open. */
  | 'skip_viloyat'
  /** An order in hand: he is working. */
  | 'skip_active'
  /** Was out in the viloyat after hours and has just crossed back into Tashkent: the day is over. */
  | 'close_returned'
  /** In the city after hours with nothing in hand: closed at his last piece of work, no question asked. */
  | 'close_in_city'
  /** Ask "+30 min / STOP". */
  | 'remind'
  /** Asked three times, no answer: closed for him, ten minutes after the last ask. */
  | 'close_no_answer'
  /** Open from an earlier day with nothing in hand. */
  | 'close_stale';

export interface EndCheckDecision {
  action: EndCheckAction;
  /** Unanswered reminders in a row after this run. */
  unanswered: number;
}

/**
 * What to do with a due shift. Where he is comes first — a Viloyat driver is
 * left alone whatever else is true — then whether he is working, then the
 * reminder count. An unknown location (no fresh GPS, no drop-off to go by) is
 * treated as Tashkent: asking is the safe side.
 */
export function decide(input: {
  stale: boolean;
  zone: Zone;
  hasActiveOrder: boolean;
  /** Last check found him in the viloyat; fresh GPS now puts him inside the city rings. */
  returnedToCity?: boolean;
  sentAt: Date | null;
  answeredAt: Date | null;
  unanswered: number;
}): EndCheckDecision {
  if (input.zone === 'viloyat') return { action: 'skip_viloyat', unanswered: 0 };
  if (input.hasActiveOrder) return { action: 'skip_active', unanswered: 0 };
  // Back from a Viloyat after hours with nothing in hand: entering the city is
  // the end of his day (owner, 02.11.2026). Closed there, not asked.
  if (input.returnedToCity) return { action: 'close_returned', unanswered: 0 };
  // The next day: still open, nothing in hand — ended at his last photo.
  if (input.stale) return { action: 'close_stale', unanswered: 0 };
  // Asked at 18:30 and 19:00; with no answer by 19:10 the day is closed for
  // him (owner, 03.11.2026; 18:30 first — owner, 10.11.2026).
  const lastWentUnanswered =
    !!input.sentAt && (!input.answeredAt || input.answeredAt.getTime() < input.sentAt.getTime());
  const unanswered = lastWentUnanswered ? input.unanswered + 1 : input.unanswered;
  if (unanswered >= END_CHECK_MAX_UNANSWERED) return { action: 'close_no_answer', unanswered };
  return { action: 'remind', unanswered };
}

/** Whether a reminder is waiting for the driver's answer right now. */
export function isAwaitingAnswer(s: Pick<EndCheckShift, 'endCheckSentAt' | 'endCheckAnsweredAt'>): boolean {
  return !!s.endCheckSentAt && (!s.endCheckAnsweredAt || s.endCheckAnsweredAt.getTime() < s.endCheckSentAt.getTime());
}

/** One "+30 min" answer and what he said he was still doing (owner, 07.11.2026). */
export type EndCheckNote = { at: Date; note: string };

/** WorkLog.endCheckNotes as stored (JSON), read back; anything malformed is skipped. */
export function readEndCheckNotes(raw: unknown): EndCheckNote[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((n: unknown) => {
    const r = n as { at?: unknown; note?: unknown } | null;
    if (typeof r?.at !== 'string' || typeof r?.note !== 'string') return [];
    const at = new Date(r.at);
    return Number.isNaN(at.getTime()) ? [] : [{ at, note: r.note }];
  });
}

/**
 * Where a shift closed for no answer ends (owner, 07.11.2026): at the end of
 * the time he last confirmed — the day's end if he never pressed "+30 min",
 * else the day's end + 30 min for each press (once → 18:30). After a reopen,
 * or for a shift begun after the day's end, it counts from that start, and
 * only the presses since then. Never after `now`.
 */
export function confirmedUntil(input: {
  dayEnd: Date;
  clockInAt: Date;
  /** When he was last let back on (the latest off period's end), if ever. */
  reopenedAt?: Date | null;
  notes: readonly { at: Date }[];
  now: Date;
}): Date {
  const base = Math.max(input.dayEnd.getTime(), input.clockInAt.getTime(), input.reopenedAt?.getTime() ?? 0);
  const presses = input.notes.filter((n) => n.at.getTime() >= base).length;
  return new Date(Math.min(base + presses * END_CHECK_INTERVAL_MIN * MIN, input.now.getTime()));
}
