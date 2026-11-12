/** The shift toggle's guard and its watchdog (owner, 07.11.2026). */
import { GUARD_WATCHDOG_MS, oneAtATime } from '../lib/oneAtATime';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('one toggle at a time', () => {
  it('a second tap while the first runs is skipped, and the guard opens when it ends', async () => {
    const g = oneAtATime();
    let finish!: () => void;
    const first = g.run(() => new Promise<void>((r) => (finish = r)));
    expect(await g.run(async () => undefined)).toBe(false);
    finish();
    expect(await first).toBe(true);
    expect(g.isBusy()).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a chain that never settles (a dialog gone without a button) lets go after 2 minutes', async () => {
    const g = oneAtATime();
    void g.run(() => new Promise<void>(() => undefined));
    jest.advanceTimersByTime(GUARD_WATCHDOG_MS - 1);
    expect(g.isBusy()).toBe(true);
    jest.advanceTimersByTime(1);
    expect(g.isBusy()).toBe(false);
    const fn = jest.fn().mockResolvedValue(undefined);
    expect(await g.run(fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('the stale chain finishing late does not open the guard over a newer one', async () => {
    const g = oneAtATime();
    let finishOld!: () => void;
    void g.run(() => new Promise<void>((r) => (finishOld = r)));
    jest.advanceTimersByTime(GUARD_WATCHDOG_MS);
    void g.run(() => new Promise<void>(() => undefined));
    finishOld();
    await Promise.resolve();
    await Promise.resolve();
    expect(g.isBusy()).toBe(true);
  });

  it('a chain that throws still opens the guard', async () => {
    const g = oneAtATime();
    await expect(g.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(g.isBusy()).toBe(false);
  });
});
