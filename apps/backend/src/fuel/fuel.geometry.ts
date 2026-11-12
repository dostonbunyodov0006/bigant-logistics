import {
  FUEL_ARITHMETIC_TOLERANCE_SUM,
  FUEL_GPS_STALE_MS,
  FUEL_NEARBY_LIMIT,
  FUEL_NEARBY_RADIUS_M,
  FUEL_STATION_FENCE_RADIUS_M,
  FUEL_TRACKING_DISAGREE_M,
  type FuelLogFlag,
  type FuelLogOutcome,
  type FuelReading,
  type FuelType,
} from '@bigant/shared';
import { metresBetween, type GeoPoint } from '../poputi/poputi.geometry';

/** A station as the classifier needs it: a pinned point, or not pinned at all. */
export interface StationPoint {
  id: string;
  lat: number | null;
  lng: number | null;
  fuelTypes: readonly FuelType[];
  contracted: boolean;
  active: boolean;
}

/** A position with the time it was true. */
export interface TimedFix extends GeoPoint {
  at: Date;
}

/**
 * "Yaqinimda": the closest contracted stations selling this fuel, nearest
 * first, and none beyond the radius — three stations 40 km away are not
 * "near me", they are a list.
 */
export function nearestStations<S extends StationPoint>(
  at: GeoPoint,
  stations: readonly S[],
  fuelType: FuelType,
  opts: { limit?: number; radiusM?: number } = {},
): { station: S; distanceM: number }[] {
  return nearestPlaces(
    at,
    stations.filter((s) => s.fuelTypes.includes(fuelType)),
    opts,
  ).map(({ place, distanceM }) => ({ station: place, distanceM }));
}

/** A pinned, active, contracted place of any kind: what "near me" lists. */
export interface PlacePoint {
  id: string;
  lat: number | null;
  lng: number | null;
  contracted: boolean;
  active: boolean;
}

/**
 * The closest contracted places, nearest first, none beyond the radius.
 * Shared by fuel stations and service centres: the rule is the same, only
 * the list differs.
 */
export function nearestPlaces<P extends PlacePoint>(
  at: GeoPoint,
  places: readonly P[],
  opts: { limit?: number; radiusM?: number } = {},
): { place: P; distanceM: number }[] {
  const limit = opts.limit ?? FUEL_NEARBY_LIMIT;
  const radiusM = opts.radiusM ?? FUEL_NEARBY_RADIUS_M;
  return places
    .filter((p) => p.active && p.contracted && p.lat != null && p.lng != null)
    .map((p) => ({ place: p, distanceM: metresBetween(at, { lat: p.lat!, lng: p.lng! }) }))
    .filter((x) => x.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

export interface Classification {
  outcome: FuelLogOutcome;
  flags: FuelLogFlag[];
  /** The station the fill is filed under, after the fence has had its say. */
  resolvedStationId: string | null;
  /** Capture position → resolved station. Null when either is unknown. */
  distanceM: number | null;
  /** Capture position → tracked position. Null when either is unknown. */
  trackingGapM: number | null;
}

/**
 * Where was the truck, and does that agree with what the driver said?
 *
 * The driver's pick is an input, never the answer. The answer comes from the
 * best position available — the phone's fix at the shutter, falling back to
 * the app's last tracked position when the phone had none — tested against
 * every contracted station's fence.
 *
 * Nothing here refuses. The fuel is already in the tank; a refusal would only
 * lose the record. What a person needs to look at is marked, not blocked.
 */
export function classifyFill(input: {
  selectedStationId: string | null;
  capture: TimedFix | null;
  tracked: TimedFix | null;
  /** Fuel stations or service centres — the fence rule does not care which. */
  stations: readonly PlacePoint[];
  /** "Now" for staleness; injectable so tests do not depend on the clock. */
  now?: Date;
}): Classification {
  const now = input.now ?? new Date();
  const flags: FuelLogFlag[] = [];

  // Pick the position to trust. A fresh tracked fix is a real position; a
  // stale one is where the phone was, which is not the same thing.
  const trackedFresh = input.tracked && now.getTime() - input.tracked.at.getTime() <= FUEL_GPS_STALE_MS;
  let at: GeoPoint | null = null;
  if (input.capture) {
    at = input.capture;
    if (now.getTime() - input.capture.at.getTime() > FUEL_GPS_STALE_MS) flags.push('gps_stale');
  } else {
    flags.push('no_gps');
    if (trackedFresh) at = input.tracked;
  }

  // The gap is always recorded; it only counts as a disagreement when the
  // tracker is fresh. A three-day-old position says nothing about now.
  const trackingGapM = input.capture && input.tracked ? metresBetween(input.capture, input.tracked) : null;
  if (trackedFresh && trackingGapM != null && trackingGapM > FUEL_TRACKING_DISAGREE_M) {
    flags.push('tracking_disagrees');
  }

  const selected = input.selectedStationId
    ? (input.stations.find((s) => s.id === input.selectedStationId) ?? null)
    : null;
  const pinnedPlace = (p: PlacePoint): p is PlacePoint & GeoPoint => p.lat != null && p.lng != null;

  if (!at) {
    // No position at all. The pick stands, and nobody should settle on it
    // without looking.
    return {
      outcome: 'unverified',
      flags,
      resolvedStationId: selected?.id ?? null,
      distanceM: null,
      trackingGapM,
    };
  }

  // The nearest contracted fence the truck is inside. Fences may overlap at
  // adjacent stations; the closer centre wins.
  const inside = input.stations
    .filter((s) => s.active && s.contracted && pinnedPlace(s))
    .map((s) => ({ station: s, distanceM: metresBetween(at!, s as PlacePoint & GeoPoint) }))
    .filter((x) => x.distanceM <= FUEL_STATION_FENCE_RADIUS_M)
    .sort((a, b) => a.distanceM - b.distanceM)[0];

  if (inside) {
    // Inside a fence: the truck was at a contracted station. If it is the one
    // the driver picked, agree; if not, the fence is right and the pick was
    // a slip of the thumb — corrected, and said so.
    const agrees = selected?.id === inside.station.id;
    return {
      outcome: agrees ? 'matched' : 'other_station',
      flags,
      resolvedStationId: inside.station.id,
      distanceM: round(inside.distanceM),
      trackingGapM,
    };
  }

  if (selected?.contracted) {
    // Named one of ours, was nowhere near it. Held for a person.
    const d = pinnedPlace(selected) ? round(metresBetween(at, selected)) : null;
    return { outcome: 'mismatch', flags, resolvedStationId: selected.id, distanceM: d, trackingGapM };
  }

  // Inside no fence and picked nothing (Ko'cha) or a non-contracted station:
  // a fill the driver paid for.
  return { outcome: 'unlisted', flags, resolvedStationId: selected?.id ?? null, distanceM: null, trackingGapM };
}

/**
 * Does quantity × unit price make the total? On a real dispenser it does to
 * the last digit — 13.487 × 5 600.0 = 75 527.2 — so a reading that fails this
 * has a misread digit in one of the three, and that is worth saying before
 * anyone relies on it.
 */
export function arithmeticHolds(r: FuelReading, toleranceSum = FUEL_ARITHMETIC_TOLERANCE_SUM): boolean {
  return Math.abs(r.quantity * r.unit_price_sum - r.total_sum) <= toleranceSum;
}

const round = (m: number) => Math.round(m * 10) / 10;
