/** A chain that has not finished by then no longer blocks the button. */
export const GUARD_WATCHDOG_MS = 2 * 60_000;

/**
 * One run at a time, with a watchdog (owner, 07.11.2026): on Android a dialog
 * can vanish without a button (another alert, a call, the activity rebuilt)
 * and a permission promise may never settle — the guard used to stay shut and
 * "Ishni boshlash" did nothing until the app was killed. After `ms` the guard
 * opens again; the stale run finishing later does not reopen a newer one.
 */
export function oneAtATime(ms: number = GUARD_WATCHDOG_MS) {
  let current = 0;
  let busy = false;
  return {
    isBusy: () => busy,
    /** Runs `fn` unless a run is already going; false when it was skipped. */
    async run(fn: () => Promise<unknown>): Promise<boolean> {
      if (busy) return false;
      busy = true;
      const id = ++current;
      const timer = setTimeout(() => {
        if (current === id) busy = false;
      }, ms);
      try {
        await fn();
      } finally {
        clearTimeout(timer);
        if (current === id) busy = false;
      }
      return true;
    },
  };
}
