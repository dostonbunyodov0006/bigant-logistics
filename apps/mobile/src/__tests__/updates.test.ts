/** One attempt per version: the updater must never reboot the app in a loop. */
import { decideUpdate, mayReloadNow, RELOAD_WINDOW_MS } from '../hooks/useAppUpdates';

describe('taking an update at start-up', () => {
  it('reloads into a version not tried before', () => {
    expect(decideUpdate({ available: true, manifestId: 'v2', runningId: 'v1', triedId: null })).toBe('reload');
    expect(decideUpdate({ available: true, manifestId: 'v3', runningId: 'v2', triedId: 'v2' })).toBe('reload');
  });

  it('does nothing when there is nothing new', () => {
    expect(decideUpdate({ available: false, manifestId: null, runningId: 'v1', triedId: null })).toBe('nothing');
    expect(decideUpdate({ available: true, manifestId: 'v1', runningId: 'v1', triedId: 'v1' })).toBe('nothing');
  });

  it('the version it already tried and is not running: stuck — reported, not reloaded again', () => {
    expect(decideUpdate({ available: true, manifestId: 'v2', runningId: 'embedded', triedId: 'v2' })).toBe('stuck');
  });
});

describe('never a reload in the middle of work (owner, 07.11.2026)', () => {
  const start = 1_000_000;
  it('restarts only within the first 15 seconds after the app started', () => {
    expect(RELOAD_WINDOW_MS).toBe(15_000);
    expect(mayReloadNow(start, start + 2_000)).toBe(true);
    expect(mayReloadNow(start, start + 15_000)).toBe(true);
  });
  it('later: the downloaded update waits for the next cold start', () => {
    expect(mayReloadNow(start, start + 15_001)).toBe(false);
    expect(mayReloadNow(start, start + 10 * 60_000)).toBe(false);
  });
});
