import { useEffect } from 'react';
import { report } from '../lib/crashReport';
import { bootMark } from '../lib/bootTrace';

/**
 * Takes a new version when the app starts, and only then.
 *
 * The updater would otherwise run the new code at the *next* launch, so a
 * driver opens the app, sees nothing different, and concludes nothing was
 * done. Checking at start-up and restarting there and then costs a second and
 * puts the change in front of him.
 *
 * It deliberately does NOT do this when the app returns from the background.
 * The camera, the navigator and the dialer all background this app: a reload
 * on return would land exactly on the driver holding a proof photograph, or
 * halfway through a vozvrat list that lives in memory, and throw it away. An
 * update can wait for the next cold start; his work cannot be recovered.
 *
 * One attempt per version. A version the updater downloads but then cannot
 * launch comes back as "available" after every restart, and restarting into
 * it again made the phone reboot the app every three seconds (02.11.2026).
 * The version tried last is remembered on the phone; the same one again is
 * reported to the server and left alone, and the app runs what it has.
 */
const TRIED_KEY = 'bigant.update.tried';

/**
 * Never a reload in the middle of work (owner, 07.11.2026): a check or a
 * download that dragged on used to restart the app minutes later, under a
 * driver already at work. The restart happens only within RELOAD_WINDOW_MS of
 * the app starting; a later download waits on the phone and expo-updates
 * starts it at the next cold start. The check and the download each get a
 * time limit.
 */
const STARTED_AT = Date.now();
export const RELOAD_WINDOW_MS = 15_000;
const CHECK_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 60_000;

/** Pure: whether restarting into the downloaded update is still harmless. Exported for tests. */
export function mayReloadNow(startedAt: number, now: number): boolean {
  return now - startedAt <= RELOAD_WINDOW_MS;
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}_timeout`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

export type UpdateVerdict = 'reload' | 'nothing' | 'stuck';

/** Pure: what to do with what the check found. Exported for tests. */
export function decideUpdate(input: {
  available: boolean;
  manifestId: string | null;
  runningId: string | null;
  triedId: string | null;
}): UpdateVerdict {
  if (!input.available) return 'nothing';
  // The update offered is the one running: nothing new (the server's manifest lagging).
  if (input.manifestId && input.manifestId === input.runningId) return 'nothing';
  if (input.manifestId && input.manifestId === input.triedId) return 'stuck';
  return 'reload';
}

export function useAppUpdates() {
  useEffect(() => {
    let stopped = false;

    void (async () => {
      try {
        const Updates = await import('expo-updates');
        // A development build has no updater to ask.
        if (!Updates.isEnabled) return;
        bootMark('update:check');
        const found = await withTimeout(Updates.checkForUpdateAsync(), CHECK_TIMEOUT_MS, 'update_check');
        bootMark(`update:${found.isAvailable ? 'available' : 'none'}`);
        if (stopped) return;
        const SecureStore = await import('expo-secure-store');
        const manifestId = (found.manifest as { id?: string } | undefined)?.id ?? null;
        const verdict = decideUpdate({
          available: found.isAvailable,
          manifestId,
          runningId: Updates.updateId ?? null,
          triedId: await SecureStore.getItemAsync(TRIED_KEY),
        });
        if (verdict === 'stuck') {
          report(new Error(`update ${manifestId} did not launch; running ${Updates.updateId ?? 'embedded'}`));
          return;
        }
        if (verdict === 'nothing') return;
        bootMark('update:fetch');
        await withTimeout(Updates.fetchUpdateAsync(), FETCH_TIMEOUT_MS, 'update_fetch');
        if (stopped) return;
        // Marked tried only once it is on the phone (06.11.2026): a fetch that
        // threw (the updater's own start-up download already running) left the
        // version marked and never reloaded into, so every later open called it stuck.
        if (manifestId) await SecureStore.setItemAsync(TRIED_KEY, manifestId);
        // Too late to restart under him (owner, 07.11.2026): the next cold start runs it.
        if (!mayReloadNow(STARTED_AT, Date.now())) {
          bootMark('update:next-start');
          return;
        }
        bootMark('update:reload');
        await Updates.reloadAsync();
      } catch {
        // No network, or the server is not answering: the app carries on with
        // what it has. This is not something to tell the driver about.
      }
    })();

    return () => {
      stopped = true;
    };
  }, []);
}
