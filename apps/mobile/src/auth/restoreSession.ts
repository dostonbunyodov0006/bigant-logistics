import type { UserPublic } from '@bigant/shared';
import type { RefreshOutcome } from '../lib/api';

/**
 * The cold start's restore (owner, 07.11.2026). Up to 20 tries of (refresh +
 * session check + 3 s wait) could keep the spinner up for minutes; now the
 * screen waits at most RESTORE_CAP_MS and the rest goes on in the background.
 */
export const RESTORE_CAP_MS = 15_000;
const MAX_TRIES = 20;
const RETRY_WAIT_MS = 3_000;

export interface RestoreDeps {
  refresh: () => Promise<RefreshOutcome>;
  sessionState: () => Promise<'yes' | 'no' | 'unknown'>;
  loadMe: () => Promise<UserPublic | null>;
  wait: (ms: number) => Promise<void>;
  /** False once he signed in or out by hand meanwhile: stop, touch nothing. */
  stillWanted: () => boolean;
  mark?: (step: string) => void;
}

/**
 * The signed-in user, or null. A refused token (401) or no token ends it at
 * once. A slow secure store or a server away is tried again — but two slow
 * store reads in a row count as "no session" for this start only (owner,
 * 07.11.2026): the token is not deleted, so the next start signs him back in.
 */
export async function restoreSession(deps: RestoreDeps): Promise<UserPublic | null> {
  let slowInARow = 0;
  const slow = (wasSlow: boolean) => {
    slowInARow = wasSlow ? slowInARow + 1 : 0;
    return slowInARow >= 2;
  };
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if (!deps.stillWanted()) return null;
    const outcome = await deps.refresh();
    deps.mark?.(`auth:restore-${outcome}`);
    if (outcome === 'ok') return deps.stillWanted() ? deps.loadMe() : null;
    if (outcome === 'refused' || outcome === 'no-token') return null;
    if (slow(outcome === 'store-slow')) return null;
    if (!deps.stillWanted()) return null;
    const state = await deps.sessionState();
    if (state === 'no') return null;
    if (slow(state === 'unknown')) return null;
    await deps.wait(RETRY_WAIT_MS);
  }
  return null;
}

/**
 * The work, or `{ settled: false }` once `ms` passed without it (owner,
 * 07.11.2026). The work itself is not stopped.
 */
export function withCap<T>(
  work: Promise<T>,
  ms: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.then((value) => ({ settled: true as const, value })),
    new Promise<{ settled: false }>((resolve) => {
      timer = setTimeout(() => resolve({ settled: false }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
