import { borderCrossing, shouldWarnSilent, silentGaps } from './location-silence';
import { insideTashkentCity } from '../geo/tashkent-city';

const tas = (hhmm: string) => new Date(new Date(`2026-11-04T${hhmm}:00.000Z`).getTime() - 5 * 3_600_000);

describe('silentGaps — stretches of no position on a shift (owner, 04.11.2026)', () => {
  it('fixes every five minutes: no gap', () => {
    const fixes = ['09:00', '09:05', '09:10', '09:15'].map(tas);
    expect(silentGaps(fixes, tas('09:00'), tas('09:20'))).toEqual([]);
    expect(silentGaps([tas('09:00'), tas('09:10')], tas('09:00'), tas('09:12'))).toEqual([]);
  });
  it('GPS off from 10:00 to 11:00: one gap of an hour; the end of an open shift counts too', () => {
    const fixes = ['09:00', '09:05', '10:00', '11:00', '11:05'].map(tas);
    expect(silentGaps(fixes, tas('09:00'), tas('11:10')).map((g) => g.minutes)).toEqual([55, 60]);
    expect(silentGaps([tas('09:00')], tas('09:00'), tas('09:30'))[0].minutes).toBe(30);
  });
});

describe('shouldWarnSilent', () => {
  const base = { clockInAt: tas('09:00'), onBreak: false, warnedAt: null };
  it('eleven minutes with nothing — two background fixes missed: told', () => {
    expect(shouldWarnSilent({ ...base, now: tas('10:10'), lastFixAt: tas('10:00') })).toBe(false);
    expect(shouldWarnSilent({ ...base, now: tas('10:11'), lastFixAt: tas('10:00') })).toBe(true);
  });
  it('told once per silence; a new silence after a fix is told again', () => {
    expect(shouldWarnSilent({ ...base, now: tas('10:30'), lastFixAt: tas('10:00'), warnedAt: tas('10:15') })).toBe(false);
    expect(shouldWarnSilent({ ...base, now: tas('11:20'), lastFixAt: tas('11:00'), warnedAt: tas('10:15') })).toBe(true);
  });
  it('on a break: not told', () => {
    expect(shouldWarnSilent({ ...base, now: tas('10:30'), lastFixAt: tas('10:00'), onBreak: true })).toBe(false);
  });
  it('no fix since clock-in: counted from clock-in', () => {
    expect(shouldWarnSilent({ ...base, now: tas('09:12'), lastFixAt: null })).toBe(true);
  });
});

describe('borderCrossing', () => {
  const inCity = (f: { lat: number; lng: number }) => insideTashkentCity({ lat: f.lat, lon: f.lng });
  it('the first fix inside after the last one outside, whatever order they arrived in', () => {
    const fixes = [
      { lat: 41.31, lng: 69.28, recordedAt: tas('20:40') },
      { lat: 40.84, lng: 68.66, recordedAt: tas('19:50') },
      { lat: 41.31, lng: 69.28, recordedAt: tas('20:15') },
    ];
    expect(borderCrossing(fixes, inCity)).toEqual(tas('20:15'));
  });
  it('never outside, or not back yet: null', () => {
    expect(borderCrossing([{ lat: 41.31, lng: 69.28, recordedAt: tas('20:00') }], inCity)).toBeNull();
    expect(borderCrossing([{ lat: 40.84, lng: 68.66, recordedAt: tas('20:00') }], inCity)).toBeNull();
  });
});
