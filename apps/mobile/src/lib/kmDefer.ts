/**
 * The shift for which he tapped "Keyinroq yuboraman" (audit, 07.11.2026).
 * On a weak signal the photo could fail again and again on a screen with no
 * way out, so he could not work at all. Kept in memory only, keyed by the
 * shift's start: going home and coming back to the app that day does not
 * bring the screen back, but a fresh start of the app (the next morning, or
 * after the phone closed it) or a new shift asks again. Nothing on disk, so
 * a "later" can never outlive the day it was given. A missed Monday is asked
 * again by the server on the following days until it is in (owner, 07.11.2026).
 */
let deferredShift: string | null = null;

export function kmDeferredFor(shiftStartedAt: string | null | undefined): boolean {
  return !!shiftStartedAt && deferredShift === shiftStartedAt;
}

export function deferKm(shiftStartedAt: string | null | undefined): void {
  deferredShift = shiftStartedAt ?? null;
}
