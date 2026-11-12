import { TASHKENT_CITY_RINGS } from './tashkent-city-boundary';

/**
 * Small pure geometry helpers: is a point inside Tashkent city, and Valhalla's
 * route shape decoded to points. (Moved here from the removed per-km Viloyat
 * overtime, 09.11.2026 — the city check and the decoder are still used.)
 */

export type LatLon = { lat: number; lon: number };

/** Ray casting over [lon, lat] rings. */
function inRing(p: LatLon, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside Tashkent city (not Tashkent viloyati). */
export function insideTashkentCity(p: LatLon): boolean {
  return TASHKENT_CITY_RINGS.some((ring) => inRing(p, ring));
}

/** Valhalla's polyline6 shape → points. */
export function decodePolyline6(encoded: string): LatLon[] {
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / 1e6, lon: lon / 1e6 });
  }
  return points;
}
