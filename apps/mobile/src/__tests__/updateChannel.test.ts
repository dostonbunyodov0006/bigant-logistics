/** Test phones get a new update first (owner, 09.11.2026). */
jest.mock('../lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

import { applyUpdateChannel, testerParamValue, TESTER_PARAM } from '../hooks/useUpdateChannel';

const updater = (isEnabled = true) => ({ isEnabled, setExtraParamAsync: jest.fn().mockResolvedValue(undefined) });

describe('which update channel the phone asks for', () => {
  it('only a plain true makes a tester', () => {
    expect(testerParamValue({ tester: true })).toBe('1');
    expect(testerParamValue({ tester: false })).toBeNull();
    expect(testerParamValue({ tester: 'true' })).toBeNull();
    expect(testerParamValue(null)).toBeNull();
    expect(testerParamValue(undefined)).toBeNull();
  });

  it('a tester sets tester="1" for the updater', async () => {
    const u = updater();
    await expect(applyUpdateChannel(u, async () => ({ tester: true }))).resolves.toBe('1');
    expect(u.setExtraParamAsync).toHaveBeenCalledWith(TESTER_PARAM, '1');
  });

  it('anyone else clears it (a phone handed from a tester to a driver)', async () => {
    const u = updater();
    await expect(applyUpdateChannel(u, async () => ({ tester: false }))).resolves.toBeNull();
    expect(u.setExtraParamAsync).toHaveBeenCalledWith(TESTER_PARAM, null);
  });

  it('no answer from the server changes nothing', async () => {
    const u = updater();
    await expect(applyUpdateChannel(u, async () => { throw new Error('offline'); })).resolves.toBe('skipped');
    expect(u.setExtraParamAsync).not.toHaveBeenCalled();
  });

  it('a development build (no updater) is left alone', async () => {
    const u = updater(false);
    const fetch = jest.fn();
    await expect(applyUpdateChannel(u, fetch)).resolves.toBe('skipped');
    expect(fetch).not.toHaveBeenCalled();
    expect(u.setExtraParamAsync).not.toHaveBeenCalled();
  });

  it('an updater that refuses does not throw', async () => {
    const u = { isEnabled: true, setExtraParamAsync: jest.fn().mockRejectedValue(new Error('no')) };
    await expect(applyUpdateChannel(u, async () => ({ tester: true }))).resolves.toBe('skipped');
  });
});
