import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';

/**
 * Test phones get a new update first (owner, 09.11.2026).
 *
 * A bad update once reached every driver at the same moment and broke every
 * phone. Now tools/publish-update.sh publishes to `test`, and only phones that
 * send `tester="1"` in the updater's Expo-Extra-Params header are given it by
 * nginx; everyone else keeps `current` until the owner runs
 * tools/promote-update.sh.
 *
 * The server says whether this account is a tester (OTA_TESTER_USER_IDS). The
 * answer is stored by expo-updates itself and sent on every later update
 * request — the native check at launch too — so it takes effect from the next
 * check, typically the next cold start.
 */
export const TESTER_PARAM = 'tester';

/** Pure: the extra param's value for the server's answer. Exported for tests. */
export function testerParamValue(answer: unknown): '1' | null {
  return (answer as { tester?: unknown } | null | undefined)?.tester === true ? '1' : null;
}

type UpdatesLike = {
  isEnabled: boolean;
  setExtraParamAsync: (key: string, value: string | null) => Promise<void>;
};

/**
 * Asks the server and tells the updater. Exported for tests.
 *
 * A failed request changes nothing: a tester without signal stays a tester,
 * and an ordinary driver stays ordinary. Never throws.
 */
export async function applyUpdateChannel(
  updates: UpdatesLike,
  fetchChannel: () => Promise<unknown>,
): Promise<'1' | null | 'skipped'> {
  if (!updates.isEnabled) return 'skipped';
  let value: '1' | null;
  try {
    value = testerParamValue(await fetchChannel());
  } catch {
    return 'skipped';
  }
  try {
    await updates.setExtraParamAsync(TESTER_PARAM, value);
  } catch {
    return 'skipped';
  }
  return value;
}

export function useUpdateChannel() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    // Signed out: the last answer stays until the next account says otherwise.
    if (!userId) return;
    void (async () => {
      try {
        const Updates = await import('expo-updates');
        await applyUpdateChannel(Updates, () => api.get<{ tester: boolean }>('/app-updates/channel'));
      } catch {
        // No updater in this build: nothing to tell.
      }
    })();
  }, [userId]);
}
