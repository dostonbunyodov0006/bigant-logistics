import { SERVICE_DUE_SOON_KM, type ServiceReminderKind } from '@bigant/shared';
import { tashkentDateKey } from '../common/tashkent-time';

/**
 * The mileage rule, as pure arithmetic: where one work on one vehicle
 * stands, and whether the driver should be told about it today.
 *
 * Kept free of the database so the reminder policy can be asserted case by
 * case — the same way the fuel fences are.
 */

export interface DueInput {
  currentKm: number | null;
  lastDoneKm: number | null;
  intervalKm: number | null;
}

export interface DueState {
  dueKm: number | null;
  /** Negative when overdue. Null when it cannot be known. */
  remainingKm: number | null;
  /** Inside the reminder window, or past it. */
  dueSoon: boolean;
  overdue: boolean;
}

export function dueState(i: DueInput): DueState {
  if (i.intervalKm == null || i.lastDoneKm == null) {
    return { dueKm: null, remainingKm: null, dueSoon: false, overdue: false };
  }
  const dueKm = i.lastDoneKm + i.intervalKm;
  if (i.currentKm == null) return { dueKm, remainingKm: null, dueSoon: false, overdue: false };
  const remainingKm = dueKm - i.currentKm;
  return {
    dueKm,
    remainingKm,
    overdue: remainingKm < 0,
    dueSoon: remainingKm >= 0 && remainingKm <= SERVICE_DUE_SOON_KM,
  };
}

export interface ReminderHistory {
  kind: ServiceReminderKind;
  sentAt: Date;
  /**
   * Which service cycle it was sent in: the km the work had last been done at
   * (null = never). See ServiceReminder.cycleKm.
   */
  cycleKm?: number | null;
}

/**
 * Which reminder, if any, to send now.
 *
 * Every day, once a day, from 500 km before the work is due until it is done
 * (owner, 06.11.2026): "due soon" the first time, "overdue" the first time
 * past it, "repeat" on the days between. Nothing while a visit that covers
 * it is open.
 */
export function reminderDue(
  state: DueState,
  history: readonly ReminderHistory[],
  hasOpenVisit: boolean,
  now: Date,
  /** The km the work was last done at — which cycle we are in. */
  cycleKm: number | null = null,
): ServiceReminderKind | null {
  if (hasOpenVisit) return null;
  if (!state.dueSoon && !state.overdue) return null;

  // Only this cycle counts. Once the work is done the cycle moves on (a new
  // lastDoneKm), and the reminders of the previous one must not silence it:
  // the next oil change needs its own "due soon" and its own "overdue".
  const thisCycle = history.filter((h) => (h.cycleKm ?? null) === (cycleKm ?? null));
  const sent = (k: ServiceReminderKind) => thisCycle.some((h) => h.kind === k);
  // One a day, by Tashkent's calendar.
  const today = tashkentDateKey(now);
  if (thisCycle.some((h) => tashkentDateKey(h.sentAt) === today)) return null;
  if (state.overdue) return sent('overdue') ? 'repeat' : 'overdue';
  return sent('due_soon') ? 'repeat' : 'due_soon';
}
