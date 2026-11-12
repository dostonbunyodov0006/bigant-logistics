import { decodePolyline6, insideTashkentCity, type LatLon } from './tashkent-city';

const AMIR_TEMUR: LatLon = { lat: 41.3111, lon: 69.2797 };
const CHIRCHIQ: LatLon = { lat: 41.4689, lon: 69.5822 };
const GULISTON: LatLon = { lat: 40.4897, lon: 68.7842 };

/** Polyline6 encoder — the inverse of what Valhalla sends — to test the decoder. */
function encode6(points: LatLon[]): string {
  let out = '';
  let pLat = 0;
  let pLon = 0;
  const one = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e6);
    const lon = Math.round(p.lon * 1e6);
    one(lat - pLat);
    one(lon - pLon);
    pLat = lat;
    pLon = lon;
  }
  return out;
}

describe('tashkent-city', () => {
  it('knows Tashkent city from the regions — Tashkent viloyati is outside the city', () => {
    expect(insideTashkentCity(AMIR_TEMUR)).toBe(true);
    expect(insideTashkentCity(CHIRCHIQ)).toBe(false);
    expect(insideTashkentCity(GULISTON)).toBe(false);
  });

  it('decodes a polyline6 shape', () => {
    const pts = [AMIR_TEMUR, CHIRCHIQ, GULISTON];
    const back = decodePolyline6(encode6(pts));
    back.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(pts[i].lat, 6);
      expect(p.lon).toBeCloseTo(pts[i].lon, 6);
    });
  });
});
