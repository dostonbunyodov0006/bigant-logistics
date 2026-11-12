import { FUEL_STATION_FENCE_RADIUS_M } from '@bigant/shared';
import { metresBetween } from '../poputi/poputi.geometry';
import { arithmeticHolds, classifyFill, nearestStations, type StationPoint, type TimedFix } from './fuel.geometry';

/**
 * The fence rules as scenarios. Each one is a place a truck can be, told
 * against what the driver said, and the answer the log must carry.
 *
 * Distances are built, not guessed: 0.001° of latitude is 111 m everywhere,
 * so offsets below are chosen to land clearly inside or outside a 150 m fence.
 */

// Two contracted stations 1.3 km apart, one non-contracted, one unpinned.
const A: StationPoint = { id: 'A', lat: 41.2810, lng: 69.2040, fuelTypes: ['gaz', 'propan'], contracted: true, active: true };
const B: StationPoint = { id: 'B', lat: 41.2900, lng: 69.2130, fuelTypes: ['gaz'], contracted: true, active: true };
const X: StationPoint = { id: 'X', lat: 41.2500, lng: 69.2500, fuelTypes: ['gaz'], contracted: false, active: true };
const U: StationPoint = { id: 'U', lat: null, lng: null, fuelTypes: ['gaz'], contracted: true, active: true };
const OFF: StationPoint = { id: 'OFF', lat: 41.2810, lng: 69.2040, fuelTypes: ['gaz'], contracted: true, active: false };
const STATIONS = [A, B, X, U];

const NOW = new Date('2026-09-21T10:00:00Z');
const at = (lat: number, lng: number, agoMs = 0): TimedFix => ({ lat, lng, at: new Date(NOW.getTime() - agoMs) });
/** A point `m` metres north of a station. */
const north = (s: StationPoint, m: number, agoMs = 0) => at(s.lat! + m / 111_000, s.lng!, agoMs);

describe('fence geometry sanity', () => {
  it('places the fixtures where the scenarios assume', () => {
    expect(metresBetween(A as never, B as never)).toBeGreaterThan(1_000);
    expect(metresBetween(A as never, north(A, 60))).toBeCloseTo(60, -1);
    expect(metresBetween(A as never, north(A, 400))).toBeCloseTo(400, -1);
    expect(FUEL_STATION_FENCE_RADIUS_M).toBe(150);
  });
});

describe('classifyFill — where the truck was vs what the driver said', () => {
  it('matched: picked A, standing on A', () => {
    const r = classifyFill({ selectedStationId: 'A', capture: north(A, 40), tracked: north(A, 30), stations: STATIONS, now: NOW });
    expect(r).toMatchObject({ outcome: 'matched', resolvedStationId: 'A', flags: [] });
    expect(r.distanceM).toBeCloseTo(40, -1);
  });

  it('matched at the edge: 140 m is inside, 160 m is not', () => {
    expect(classifyFill({ selectedStationId: 'A', capture: north(A, 140), tracked: null, stations: STATIONS, now: NOW }).outcome).toBe('matched');
    expect(classifyFill({ selectedStationId: 'A', capture: north(A, 160), tracked: null, stations: STATIONS, now: NOW }).outcome).toBe('mismatch');
  });

  it('other_station: picked A, standing on B — the fence corrects the pick', () => {
    const r = classifyFill({ selectedStationId: 'A', capture: north(B, 20), tracked: null, stations: STATIONS, now: NOW });
    expect(r).toMatchObject({ outcome: 'other_station', resolvedStationId: 'B' });
  });

  it("other_station: Ko'cha path but actually standing on a contracted station", () => {
    // The driver said "not one of ours"; the fence says it is. Filed under B,
    // so the station's invoice and our log agree.
    const r = classifyFill({ selectedStationId: null, capture: north(B, 50), tracked: null, stations: STATIONS, now: NOW });
    expect(r).toMatchObject({ outcome: 'other_station', resolvedStationId: 'B' });
  });

  it('mismatch: picked A, 400 m from anything of ours', () => {
    const r = classifyFill({ selectedStationId: 'A', capture: north(A, 400), tracked: null, stations: STATIONS, now: NOW });
    expect(r).toMatchObject({ outcome: 'mismatch', resolvedStationId: 'A' });
    expect(r.distanceM).toBeCloseTo(400, -1);
  });

  it("unlisted: Ko'cha path, inside no fence", () => {
    const r = classifyFill({ selectedStationId: null, capture: at(41.3000, 69.3000), tracked: null, stations: STATIONS, now: NOW });
    expect(r).toMatchObject({ outcome: 'unlisted', resolvedStationId: null, distanceM: null });
  });

  it('unlisted: a non-contracted station never matches, even standing on it', () => {
    const r = classifyFill({ selectedStationId: 'X', capture: north(X, 10), tracked: null, stations: STATIONS, now: NOW });
    expect(r).toMatchObject({ outcome: 'unlisted', resolvedStationId: 'X' });
  });

  it('an inactive station has no fence', () => {
    const r = classifyFill({ selectedStationId: 'OFF', capture: north(OFF, 10), tracked: null, stations: [OFF, B], now: NOW });
    // OFF sits exactly on A's coordinates but A is not in this list, so
    // nothing matches; OFF is contracted, so the pick reads as a mismatch.
    expect(r.outcome).toBe('mismatch');
  });

  it('an unpinned contracted station can be picked but never confirmed', () => {
    const r = classifyFill({ selectedStationId: 'U', capture: at(41.3000, 69.3000), tracked: null, stations: STATIONS, now: NOW });
    expect(r).toMatchObject({ outcome: 'mismatch', resolvedStationId: 'U', distanceM: null });
  });

  it('two fences overlapping: the nearer centre wins', () => {
    const C: StationPoint = { ...B, id: 'C', lat: B.lat! + 100 / 111_000 }; // 100 m north of B
    const r = classifyFill({ selectedStationId: 'B', capture: north(B, 80), tracked: null, stations: [A, B, C], now: NOW });
    // 80 m from B, 20 m from C: inside both fences, C is closer.
    expect(r).toMatchObject({ outcome: 'other_station', resolvedStationId: 'C' });
  });
});

describe('classifyFill — the flags', () => {
  it('gps_stale when the capture fix is older than five minutes', () => {
    const r = classifyFill({ selectedStationId: 'A', capture: north(A, 10, 6 * 60_000), tracked: null, stations: STATIONS, now: NOW });
    expect(r.outcome).toBe('matched');
    expect(r.flags).toEqual(['gps_stale']);
  });

  it('tracking_disagrees when the phone says A and the tracker says B', () => {
    const r = classifyFill({ selectedStationId: 'A', capture: north(A, 10), tracked: north(B, 10), stations: STATIONS, now: NOW });
    expect(r.outcome).toBe('matched');
    expect(r.flags).toEqual(['tracking_disagrees']);
    expect(r.trackingGapM).toBeGreaterThan(1_000);
  });

  it('a stale tracker is not a disagreement — the gap is kept, the flag is not raised', () => {
    const r = classifyFill({ selectedStationId: 'A', capture: north(A, 10), tracked: north(B, 10, 3 * 24 * 60 * 60_000), stations: STATIONS, now: NOW });
    expect(r.flags).toEqual([]);
    expect(r.trackingGapM).toBeGreaterThan(1_000);
  });

  it('no_gps + fresh tracked fix: the tracker stands in, outcome still decided', () => {
    const r = classifyFill({ selectedStationId: 'A', capture: null, tracked: north(A, 30, 60_000), stations: STATIONS, now: NOW });
    expect(r).toMatchObject({ outcome: 'matched', resolvedStationId: 'A', flags: ['no_gps'] });
  });

  it('no_gps + stale tracked fix: unverified, the pick stands', () => {
    const r = classifyFill({ selectedStationId: 'A', capture: null, tracked: north(B, 10, 20 * 60_000), stations: STATIONS, now: NOW });
    expect(r).toMatchObject({ outcome: 'unverified', resolvedStationId: 'A', flags: ['no_gps'], distanceM: null });
  });

  it("no position at all on the Ko'cha path: unverified with nothing resolved", () => {
    const r = classifyFill({ selectedStationId: null, capture: null, tracked: null, stations: STATIONS, now: NOW });
    expect(r).toMatchObject({ outcome: 'unverified', resolvedStationId: null, trackingGapM: null });
  });
});

describe('nearestStations — Yaqinimda', () => {
  it('lists contracted, pinned stations selling that fuel, nearest first', () => {
    const r = nearestStations(north(A, 200), STATIONS, 'gaz');
    expect(r.map((x) => x.station.id)).toEqual(['A', 'B']); // X not contracted, U unpinned
    expect(r[0].distanceM).toBeCloseTo(200, -1);
  });

  it('filters by fuel: propan is only at A', () => {
    expect(nearestStations(north(B, 10), STATIONS, 'propan').map((x) => x.station.id)).toEqual(['A']);
  });

  it('returns nothing when nothing is within range — that is a list, not "near me"', () => {
    expect(nearestStations(at(41.5, 69.6), STATIONS, 'gaz')).toEqual([]);
  });

  it('caps at the limit', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...A, id: `S${i}`, lat: A.lat! + (i * 100) / 111_000 }));
    expect(nearestStations(north(A, 0), many, 'gaz')).toHaveLength(3);
  });
});

describe('arithmeticHolds — quantity × unit price = total', () => {
  it('holds on the real dispenser reading', () => {
    expect(arithmeticHolds({ total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600 })).toBe(true);
  });

  it('fails when a digit was misread', () => {
    expect(arithmeticHolds({ total_sum: 75527.2, quantity: 13.437, unit_price_sum: 5600 })).toBe(false);
    expect(arithmeticHolds({ total_sum: 15527.2, quantity: 13.487, unit_price_sum: 5600 })).toBe(false);
  });

  it('tolerates the rounding a display does', () => {
    expect(arithmeticHolds({ total_sum: 75527, quantity: 13.487, unit_price_sum: 5600 })).toBe(true);
  });
});
