import { GeoController } from './geo.controller';

describe('GeoController — the office map', () => {
  // Valhalla's polyline6 for (41.3, 69.24) → (41.31, 69.25).
  const shape = encode([[41.3, 69.24], [41.31, 69.25]]);
  function encode(points: [number, number][]): string {
    let out = '';
    let pl = 0;
    let pn = 0;
    const enc = (v: number) => {
      let n = v < 0 ? ~(v << 1) : v << 1;
      while (n >= 0x20) {
        out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
        n >>= 5;
      }
      out += String.fromCharCode(n + 63);
    };
    for (const [lat, lon] of points) {
      const a = Math.round(lat * 1e6);
      const b = Math.round(lon * 1e6);
      enc(a - pl);
      enc(b - pn);
      pl = a;
      pn = b;
    }
    return out;
  }

  it('draws the road as [lon, lat] pairs with its length and time', async () => {
    const valhalla = {
      route: jest.fn().mockResolvedValue({ summary: { length_km: 1.4, time_seconds: 240 }, legs: [{ shape }] }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new GeoController({} as any, {} as any, {} as any, valhalla as any, { factor: () => 1 } as any);
    const res = await c.route({ from_lat: 41.3, from_lon: 69.24, to_lat: 41.31, to_lon: 69.25 });
    expect(res.length_km).toBe(1.4);
    expect(res.time_seconds).toBe(240);
    expect(res.coordinates[0]![0]).toBeCloseTo(69.24, 5);
    expect(res.coordinates[1]![1]).toBeCloseTo(41.31, 5);
  });

  it('measures every lorry to the point, 25 a call, in the order given', async () => {
    const valhalla = {
      matrix: jest.fn().mockImplementation(({ sources }: { sources: unknown[] }) =>
        Promise.resolve({
          distances_km: sources.map((_, i) => [i + 1]),
          times_seconds: sources.map((_, i) => [(i + 1) * 60]),
        }),
      ),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new GeoController({} as any, {} as any, {} as any, valhalla as any, { factor: () => 1 } as any);
    const from = Array.from({ length: 30 }, () => ({ lat: 41.3, lon: 69.2 }));
    const res = await c.nearest({ to: { lat: 41.31, lon: 69.25 }, from });
    expect(valhalla.matrix).toHaveBeenCalledTimes(2);
    expect(res.legs).toHaveLength(30);
    expect(res.legs[25]).toEqual({ length_km: 1, time_seconds: 60 });
  });
});
