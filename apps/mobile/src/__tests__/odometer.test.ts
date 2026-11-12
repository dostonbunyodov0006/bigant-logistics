/** The weekly odometer at the pump: what counts as a reading. */
jest.mock('../hooks/usePhotoCapture', () => ({ takePhoto: jest.fn(), uploadPhoto: jest.fn() }));
jest.mock('../components/Icon', () => ({ Icon: () => null }));
jest.mock('../components/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { kmOf, didNotGetThrough, useSlowSend, LATER_AFTER_MS } = require('../screens/fuel/FuelOdometerScreen');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ApiError } = require('../lib/api');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, renderHook } = require('@testing-library/react-native');

describe('the km typed from the odometer', () => {
  it('takes the number with or without spaces', () => {
    expect(kmOf('152340')).toBe(152340);
    expect(kmOf('152 340')).toBe(152340);
  });
  it('nothing, letters or zero are not a reading', () => {
    expect(kmOf('')).toBeNull();
    expect(kmOf('15a')).toBeNull();
    expect(kmOf('0')).toBeNull();
  });
});

describe('"Keyinroq yuboraman" (audit, 07.11.2026)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { deferKm, kmDeferredFor } = require('../lib/kmDefer');
  it('holds for the shift it was given in, and not for the next one', () => {
    expect(kmDeferredFor('2026-11-09T04:00:00.000Z')).toBe(false);
    deferKm('2026-11-09T04:00:00.000Z');
    expect(kmDeferredFor('2026-11-09T04:00:00.000Z')).toBe(true);
    expect(kmDeferredFor('2026-11-16T04:00:00.000Z')).toBe(false);
    expect(kmDeferredFor(null)).toBe(false);
  });
});

describe('when "Keyinroq yuboraman" shows (owner, 07.11.2026)', () => {
  it('a send that did not get through counts; a refused reading never does', () => {
    expect(didNotGetThrough(new Error('Network request failed'))).toBe(true);
    expect(didNotGetThrough(new Error('photo_upload_failed'))).toBe(true);
    expect(didNotGetThrough(new ApiError(502, 'bad_gateway'))).toBe(true);
    expect(didNotGetThrough(new ApiError(408, 'timeout'))).toBe(true);
    expect(didNotGetThrough(new ApiError(429, 'too_many'))).toBe(true);
    expect(didNotGetThrough(new ApiError(400, 'odometer_mismatch'))).toBe(false);
    expect(didNotGetThrough(new ApiError(422, 'km_less_than_previous'))).toBe(false);
  });

  describe('a send still going', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('after a minute of sending, and not before; gone again when it ends', () => {
      const { result, rerender } = renderHook(({ p }: { p: boolean }) => useSlowSend(p), { initialProps: { p: true } });
      act(() => jest.advanceTimersByTime(LATER_AFTER_MS - 1));
      expect(result.current).toBe(false);
      act(() => jest.advanceTimersByTime(1));
      expect(result.current).toBe(true);
      rerender({ p: false });
      expect(result.current).toBe(false);
      // A new send starts the minute over.
      rerender({ p: true });
      expect(result.current).toBe(false);
    });
  });
});
