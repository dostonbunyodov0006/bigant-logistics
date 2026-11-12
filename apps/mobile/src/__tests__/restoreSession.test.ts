/** A cold start must not spin for minutes (owner, 07.11.2026). */
import type { RefreshOutcome } from '../lib/api';
import { RESTORE_CAP_MS, restoreSession, withCap, type RestoreDeps } from '../auth/restoreSession';

const me = { id: 'u1', role: 'driver' } as never;

function deps(refresh: RefreshOutcome[], states: ('yes' | 'no' | 'unknown')[] = [], over: Partial<RestoreDeps> = {}) {
  const d = {
    refresh: jest.fn(() => Promise.resolve(refresh.shift() ?? 'failed')),
    sessionState: jest.fn(() => Promise.resolve(states.shift() ?? 'yes')),
    loadMe: jest.fn(() => Promise.resolve(me)),
    wait: jest.fn(() => Promise.resolve()),
    stillWanted: () => true,
    ...over,
  };
  return d;
}

describe('restoreSession', () => {
  it('a refresh that works loads him', async () => {
    const d = deps(['ok']);
    await expect(restoreSession(d)).resolves.toBe(me);
    expect(d.loadMe).toHaveBeenCalledTimes(1);
  });

  it('a refused token or no token: signed out at once, no retries', async () => {
    for (const o of ['refused', 'no-token'] as const) {
      const d = deps([o]);
      await expect(restoreSession(d)).resolves.toBeNull();
      expect(d.refresh).toHaveBeenCalledTimes(1);
      expect(d.wait).not.toHaveBeenCalled();
    }
  });

  it('server away: tried again, then it works', async () => {
    const d = deps(['failed', 'failed', 'ok'], ['yes', 'yes']);
    await expect(restoreSession(d)).resolves.toBe(me);
    expect(d.refresh).toHaveBeenCalledTimes(3);
    expect(d.wait).toHaveBeenCalledTimes(2);
  });

  it('two slow store reads in a row count as no session for this start', async () => {
    const d = deps(['store-slow'], ['unknown']);
    await expect(restoreSession(d)).resolves.toBeNull();
    expect(d.refresh).toHaveBeenCalledTimes(1);
    expect(d.sessionState).toHaveBeenCalledTimes(1);
  });

  it('a slow read followed by one that answers is not two in a row', async () => {
    const d = deps(['store-slow', 'failed', 'ok'], ['yes', 'unknown']);
    await expect(restoreSession(d)).resolves.toBe(me);
    expect(d.refresh).toHaveBeenCalledTimes(3);
  });

  it('the stored session gone meanwhile: stops', async () => {
    const d = deps(['failed'], ['no']);
    await expect(restoreSession(d)).resolves.toBeNull();
    expect(d.wait).not.toHaveBeenCalled();
  });

  it('signed in by hand meanwhile: stops without loading', async () => {
    let wanted = true;
    const d = deps(['failed', 'ok'], ['yes'], {
      stillWanted: () => wanted,
      wait: jest.fn(async () => {
        wanted = false;
      }),
    });
    await expect(restoreSession(d)).resolves.toBeNull();
    expect(d.refresh).toHaveBeenCalledTimes(1);
    expect(d.loadMe).not.toHaveBeenCalled();
  });

  it('gives up after 20 tries', async () => {
    const d = deps([]);
    await expect(restoreSession(d)).resolves.toBeNull();
    expect(d.refresh).toHaveBeenCalledTimes(20);
  });
});

describe('withCap', () => {
  afterEach(() => jest.useRealTimers());

  it('the cap is about 15 seconds', () => {
    expect(RESTORE_CAP_MS).toBe(15_000);
  });

  it('work done in time comes through', async () => {
    await expect(withCap(Promise.resolve(7), 1_000)).resolves.toEqual({ settled: true, value: 7 });
  });

  it('work still running at the cap: the screen goes on, the work keeps going', async () => {
    jest.useFakeTimers();
    let finish: (v: number) => void = () => undefined;
    const work = new Promise<number>((r) => (finish = r));
    const capped = withCap(work, RESTORE_CAP_MS);
    jest.advanceTimersByTime(RESTORE_CAP_MS);
    await expect(capped).resolves.toEqual({ settled: false });
    finish(3);
    await expect(work).resolves.toBe(3);
  });
});
