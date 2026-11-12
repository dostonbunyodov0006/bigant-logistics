/**
 * The arithmetic behind a driver's trail: how far apart two fixes are, whether
 * a new fix is worth keeping, and how long a trail is. Pure, so it is tested
 * without a database.
 */

import { metresBetween } from '../poputi/poputi.geometry';
export interface Fix {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function distanceM(a: Fix, b: Fix): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** A fix is kept when the truck has moved at least this far since the last kept one… */
export const PING_MIN_MOVE_M = 30;
/** …or this long has passed — so a parked truck still shows as parked, not missing. */
export const PING_MIN_GAP_MS = 60_000;

/** Whether this fix adds anything to the trail the last kept fix did not. */
export function shouldRecordPing(
  prev: (Fix & { at: Date }) | null,
  next: Fix,
  now: Date,
): boolean {
  if (!prev) return true;
  if (now.getTime() - prev.at.getTime() >= PING_MIN_GAP_MS) return true;
  return distanceM(prev, next) >= PING_MIN_MOVE_M;
}

/** Fixes further apart than this are a gap (GPS off, app closed), not driving. */
const MAX_LEG_M = 5_000;

/** The trail's length in km, skipping legs that are jumps rather than driving. */
export function trailDistanceKm(points: Fix[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const leg = distanceM(points[i - 1]!, points[i]!);
    if (leg < MAX_LEG_M) m += leg;
  }
  return Math.round(m / 100) / 10;
}

const STOP_RADIUS_M = 60;
const STOP_MIN_MINUTES = 10;
/** A hole this long in the fixes is the phone being off, not him standing there. */
const STOP_MAX_GAP_MS = 15 * 60_000;

/** Places he stood 10 minutes or more, in order, from the day's kept fixes. */
export function longStops(points: readonly { lat: number; lng: number; at: string }[]) {
  const out: { at: string; until: string; minutes: number; lat: number; lng: number }[] = [];
  let i = 0;
  while (i < points.length) {
    const first = points[i]!;
    let j = i;
    while (
      j + 1 < points.length &&
      metresBetween(first, points[j + 1]!) <= STOP_RADIUS_M &&
      new Date(points[j + 1]!.at).getTime() - new Date(points[j]!.at).getTime() <= STOP_MAX_GAP_MS
    ) {
      j++;
    }
    const minutes = Math.round((new Date(points[j]!.at).getTime() - new Date(first.at).getTime()) / 60_000);
    if (minutes >= STOP_MIN_MINUTES) {
      out.push({ at: first.at, until: points[j]!.at, minutes, lat: first.lat, lng: first.lng });
    }
    i = j + 1;
  }
  return out;
}
