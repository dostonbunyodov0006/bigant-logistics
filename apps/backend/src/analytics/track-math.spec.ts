import { distanceM, shouldRecordPing, trailDistanceKm } from './track-math';
import { dayRange, monthRange, oneDay } from './date-range';

const A = { lat: 41.2995, lng: 69.2401 }; // Tashkent centre
const NOW = new Date('2026-10-15T06:00:00Z');

describe('track math', () => {
  it('measures distance on the ground', () => {
    // ~111 m per 0.001° of latitude
    expect(distanceM(A, { lat: 41.3005, lng: 69.2401 })).toBeCloseTo(111, -1);
    expect(distanceM(A, A)).toBe(0);
  });

  it('keeps the first fix, a move of 30 m, or a minute of standing still', () => {
    expect(shouldRecordPing(null, A, NOW)).toBe(true);
    const prev = { ...A, at: new Date(NOW.getTime() - 15_000) };
    expect(shouldRecordPing(prev, A, NOW)).toBe(false);
    expect(shouldRecordPing(prev, { lat: 41.2995, lng: 69.2405 }, NOW)).toBe(true); // ~33 m
    expect(shouldRecordPing({ ...A, at: new Date(NOW.getTime() - 60_000) }, A, NOW)).toBe(true);
  });

  it('adds up the trail but not jumps', () => {
    const trail = [A, { lat: 41.3005, lng: 69.2401 }, { lat: 41.3015, lng: 69.2401 }];
    expect(trailDistanceKm(trail)).toBeCloseTo(0.2, 1);
    expect(trailDistanceKm([A, { lat: 41.4, lng: 69.6 }])).toBe(0); // 30 km jump: GPS was off
    expect(trailDistanceKm([])).toBe(0);
  });
});

describe('date ranges (Tashkent, UTC+5)', () => {
  it('covers whole calendar days', () => {
    expect(oneDay('2026-10-15')).toEqual({
      gte: new Date('2026-10-14T19:00:00Z'),
      lt: new Date('2026-10-15T19:00:00Z'),
    });
    expect(dayRange('2026-10-01', '2026-10-15')).toEqual({
      gte: new Date('2026-09-30T19:00:00Z'),
      lt: new Date('2026-10-15T19:00:00Z'),
    });
    expect(dayRange(undefined, undefined)).toEqual({});
  });

  it('covers a month, rolling over the year', () => {
    expect(monthRange('2026-12')).toEqual({
      gte: new Date('2026-11-30T19:00:00Z'),
      lt: new Date('2026-12-31T19:00:00Z'),
    });
  });
});
