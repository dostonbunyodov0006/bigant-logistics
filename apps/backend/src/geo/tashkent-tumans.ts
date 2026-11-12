import type { GeocodingResult } from '@bigant/shared';
import { TASHKENT_TUMANS } from './tashkent-tumans.data';

/**
 * Which tuman of Toshkent a point falls in, by its boundary rather than by
 * whatever the map happens to call the neighbourhood.
 *
 * The map's reverse lookup names a mahalla or a daha as often as a tuman
 * ("Qorasuv", "Qoraqamish", "Beshyog'och"), in three scripts, and for
 * Yangihayot still says Sergeli. The official list is twelve names, and
 * every delivery address has to land on exactly one of them, because the
 * tuman is what the pay is reckoned by. So the point is tested against the
 * twelve boundaries and the answer is the boundary's own name.
 */
export function tumanAt(lat: number, lng: number): { code: string; name: string } | null {
  for (const t of TASHKENT_TUMANS) {
    if (t.polygons.some((poly) => inPolygon(lng, lat, poly))) {
      return { code: t.code, name: t.name };
    }
  }
  return null;
}

/** Ray casting: inside the outer ring and in none of the holes. */
function inPolygon(x: number, y: number, rings: number[][][]): boolean {
  if (rings.length === 0 || !inRing(x, y, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(x, y, hole));
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * A geocoding result, corrected by the boundaries: inside the city the tuman
 * is stated by its official name and the result is marked as the city's;
 * a place the map files under "Toshkent" that lies outside every tuman is in
 * Toshkent viloyati, not the city.
 */
export function placeInTashkent(r: GeocodingResult): GeocodingResult {
  const tuman = tumanAt(r.latitude, r.longitude);
  if (tuman) {
    return { ...r, district: tuman.name, city: 'Toshkent', state: null };
  }
  if (!r.state && r.city && /^(toshkent|tashkent|ташкент|тошкент)$/i.test(r.city.trim())) {
    return { ...r, state: 'Toshkent viloyati' };
  }
  return r;
}
