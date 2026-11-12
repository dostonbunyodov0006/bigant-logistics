import { tashkentDateKey, tashkentDayStartUtc } from '../common/tashkent-time';

const MIN = 60_000;
/** With work in hand the window runs this far ahead; the next fix or screen refresh moves it. */
export const IN_HAND_HOURS = 12;

/**
 * When GPS must be on (owner, 04.11.2026): on shift, within the working hours
 * the office set for the day — or, outside them, for as long as an order or a
 * return is still in hand. Off shift, on a day off with nothing in hand, or
 * after hours with nothing in hand: not required, and nobody is nagged.
 */
/** Kept for older callers; a break no longer ends in a grace (owner, 12.11.2026). */
export const BREAK_GRACE_MS = 0;

/**
 * On a break at `at` — his own time (owner, 12.11.2026): where he is then is
 * not recorded. From its start to its planned end.
 */
export function onBreakAt(driver: { breakStartedAt?: Date | null; breakUntil?: Date | null }, at: Date): boolean {
  if (!driver.breakUntil || at.getTime() >= driver.breakUntil.getTime()) return false;
  return !driver.breakStartedAt || at.getTime() >= driver.breakStartedAt.getTime();
}

/**
 * Away on a break (owner, 12.11.2026): from its start until he presses Ish
 * boshlandi himself — its end passing does not bring him back. Cleared by the
 * server when he ends it, starts an order, or the shift closes.
 */
export function breakHeld(input: { now: Date; breakStartedAt?: Date | null; breakUntil?: Date | null }): boolean {
  return !!input.breakUntil && (!input.breakStartedAt || input.breakStartedAt.getTime() <= input.now.getTime());
}

type WindowInput = {
  now: Date;
  onShift: boolean;
  inHand: boolean;
  day: { isDayOff: boolean; startMinutes: number; endMinutes: number } | null;
  breakStartedAt?: Date | null;
  breakUntil?: Date | null;
};

/**
 * When GPS, internet and battery saver are all watched: the working window,
 * a break included (owner, 12.11.2026, last word) — on a break he may not
 * turn off GPS or the internet, nor turn on battery saver, so that his
 * position keeps coming. Being late back brings no red screen of its own.
 */
export function gpsWindow(input: WindowInput): { from: Date; until: Date } | null {
  return baseWindow(input);
}

/**
 * GPS alone on a break (APK 1.4.2+). No longer used: on a break everything is
 * asked as at work (owner, 12.11.2026); kept so those APKs read a null.
 */
export function gpsOnlyWindow(_input: WindowInput): { from: Date; until: Date } | null {
  return null;
}

function baseWindow(input: {
  now: Date;
  onShift: boolean;
  inHand: boolean;
  day: { isDayOff: boolean; startMinutes: number; endMinutes: number } | null;
}): { from: Date; until: Date } | null {
  if (!input.onShift) return null;
  if (input.inHand) return { from: new Date(input.now.getTime() - MIN), until: new Date(input.now.getTime() + IN_HAND_HOURS * 60 * MIN) };
  if (!input.day || input.day.isDayOff) return null;
  const dayStart = tashkentDayStartUtc(tashkentDateKey(input.now)).getTime();
  const from = new Date(dayStart + input.day.startMinutes * MIN);
  const until = new Date(dayStart + input.day.endMinutes * MIN);
  return input.now.getTime() < until.getTime() ? { from, until } : null;
}
