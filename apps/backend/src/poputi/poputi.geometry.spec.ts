import { assignToFences, liveFences, mergedSequence, metresBetween, type TripStop } from './poputi.geometry';

// Real Tashkent points, so the distances mean something.
const CHILONZOR = { lat: 41.2856, lng: 69.2034 };
const AMIR_TEMUR = { lat: 41.3111, lng: 69.2797 };
const YUNUSOBOD = { lat: 41.3667, lng: 69.2897 };
const SERGELI = { lat: 41.2213, lng: 69.2189 };

/** A point `m` metres due east of `from` — handy for building exact fence cases. */
function east(from: { lat: number; lng: number }, m: number) {
  return { lat: from.lat, lng: from.lng + (m / (111_320 * Math.cos((from.lat * Math.PI) / 180))) };
}

const pickup = (id: string, name: string, p: { lat: number; lng: number }): TripStop => ({
  kind: 'pickup', id, name, ...p,
});
const client = (name: string, p: { lat: number; lng: number }): TripStop => ({
  kind: 'client', id: null, name, ...p,
});

describe('metresBetween', () => {
  it('matches known Tashkent distances', () => {
    // Chilonzor → Amir Temur square is ~7 km straight line.
    expect(Math.round(metresBetween(CHILONZOR, AMIR_TEMUR) / 100) * 100).toBeWithinRange(6500, 7500);
    expect(Math.round(metresBetween(CHILONZOR, CHILONZOR))).toBe(0);
  });

  it('is exact enough to trust a 5 km fence edge', () => {
    expect(Math.round(metresBetween(CHILONZOR, east(CHILONZOR, 4999)))).toBeWithinRange(4980, 5020);
  });
});

describe('liveFences — rule 2, the driver’s progress', () => {
  const remaining = [pickup('b', 'B', AMIR_TEMUR), client('C', YUNUSOBOD)];

  it('keeps every remaining fence when the driver is nowhere near one', () => {
    expect(liveFences(remaining, SERGELI).map((f) => f.name)).toEqual(['B', 'C']);
  });

  it('drops fences behind the driver once they are standing in a later one', () => {
    const three = [pickup('a', 'A', CHILONZOR), pickup('b', 'B', AMIR_TEMUR), client('C', YUNUSOBOD)];
    // Driver inside B's fence → A is behind them; adding work at A means turning back.
    expect(liveFences(three, AMIR_TEMUR).map((f) => f.name)).toEqual(['B', 'C']);
  });

  it('keeps A live while the driver is still inside A’s fence', () => {
    const three = [pickup('a', 'A', CHILONZOR), pickup('b', 'B', AMIR_TEMUR), client('C', YUNUSOBOD)];
    expect(liveFences(three, east(CHILONZOR, 1000)).map((f) => f.name)).toEqual(['A', 'B', 'C']);
  });

  it('is a no-op when the driver has never reported a position', () => {
    expect(liveFences(remaining, null).map((f) => f.name)).toEqual(['B', 'C']);
  });
});

describe('assignToFences — rules 1 and 3', () => {
  const fences = [pickup('a', 'A', CHILONZOR), pickup('b', 'B', AMIR_TEMUR), client('C', YUNUSOBOD)];

  it('accepts a co-load whose stops sit inside distinct fences', () => {
    const r = assignToFences(fences, [east(CHILONZOR, 2000)], YUNUSOBOD);
    expect('reason' in r).toBe(false);
    if ('reason' in r) return;
    expect(r.pickupByFence.get(0)).toEqual([0]); // candidate pickup 0 → fence A
    expect(r.clientFence).toBe(2);
  });

  it('accepts more pickups than the running order has left when all are on the road (owner, 09.11.2026)', () => {
    const oneLeft = [pickup('b', 'B', AMIR_TEMUR), client('C', YUNUSOBOD)];
    const two = [east(AMIR_TEMUR, 2000), east(AMIR_TEMUR, 1000)];
    const r = assignToFences(oneLeft, two, YUNUSOBOD);
    expect('reason' in r).toBe(false);
    if ('reason' in r) return;
    expect(r.pickupByFence.get(0)).toEqual([1, 0]); // nearest first
  });

  it('refuses once every pickup is collected — the rule closes po puti', () => {
    const clientOnly = [client('C', YUNUSOBOD)];
    expect(assignToFences(clientOnly, [YUNUSOBOD], YUNUSOBOD)).toEqual({ reason: 'no_pickups_left' });
  });

  it('refuses a pickup outside every fence', () => {
    expect(assignToFences(fences, [SERGELI], YUNUSOBOD)).toMatchObject({
      reason: 'pickup_outside_fences',
    });
  });

  it('refuses a delivery outside the client fence, however good the pickups are', () => {
    expect(assignToFences(fences, [east(CHILONZOR, 1000)], SERGELI)).toMatchObject({
      reason: 'delivery_outside_fence',
    });
  });

  it('puts two pickups near the same running pickup into that one stop (owner, 09.11.2026)', () => {
    // Both near A: the driver goes to A anyway and collects both there.
    const bothNearA = [east(CHILONZOR, 1500), east(CHILONZOR, 500)];
    const r = assignToFences(fences, bothNearA, YUNUSOBOD);
    expect('reason' in r).toBe(false);
    if ('reason' in r) return;
    expect(r.pickupByFence.get(0)).toEqual([1, 0]);
    expect(r.pickupByFence.get(1)).toBeUndefined();
  });

  it('gives each pickup the nearest running pickup it is close to', () => {
    const a = CHILONZOR;
    const b = east(CHILONZOR, 3000);
    const twoFences = [pickup('a', 'A', a), pickup('b', 'B', b), client('C', YUNUSOBOD)];
    const nearB = east(b, -200); // inside both, nearer B
    const r = assignToFences(twoFences, [nearB], YUNUSOBOD);
    if ('reason' in r) throw new Error(r.reason);
    expect(r.pickupByFence.get(1)).toEqual([0]);
    expect(r.pickupByFence.get(0)).toBeUndefined();
  });

  it('treats the fence edge as inclusive and just past it as out', () => {
    const one = [pickup('a', 'A', CHILONZOR), client('C', YUNUSOBOD)];
    expect('reason' in assignToFences(one, [east(CHILONZOR, 3900)], YUNUSOBOD)).toBe(false);
    expect(assignToFences(one, [east(CHILONZOR, 4200)], YUNUSOBOD)).toMatchObject({
      reason: 'pickup_outside_fences',
    });
  });

  // The near-miss list turns these numbers into "your client is 4.9 km too far",
  // so a wrong one is a wrong sentence in front of the seller.
  it('reports how far past the fence the refused stop landed', () => {
    const far = assignToFences(fences, [east(CHILONZOR, 1000)], east(YUNUSOBOD, 8900));
    expect(far).toMatchObject({ reason: 'delivery_outside_fence' });
    if (!('reason' in far)) return;
    expect(far.overByM).toBeGreaterThan(4800);
    expect(far.overByM).toBeLessThan(5000);

    const one = [pickup('a', 'A', CHILONZOR), client('C', YUNUSOBOD)];
    const justOut = assignToFences(one, [east(CHILONZOR, 4200)], YUNUSOBOD);
    if (!('reason' in justOut)) return;
    expect(justOut.overByM).toBeGreaterThan(150);
    expect(justOut.overByM).toBeLessThan(260);
  });
});

describe('mergedSequence', () => {
  it('hangs each added stop off the running stop whose fence it is in', () => {
    const fences = [pickup('a', 'A', CHILONZOR), pickup('b', 'B', AMIR_TEMUR), client('C', YUNUSOBOD)];
    const cand = [east(AMIR_TEMUR, 1000)];
    const r = assignToFences(fences, cand, east(YUNUSOBOD, 1000));
    if ('reason' in r) throw new Error(r.reason);
    const seq = mergedSequence(fences, r, cand, east(YUNUSOBOD, 1000), {
      pickups: ['Q'],
      delivery: 'D',
    });
    expect(seq.map((s) => `${s.name}:${s.belongsTo}`)).toEqual([
      'A:running',
      'B:running',
      'Q:candidate', // in B's fence → straight after B
      'C:running',
      'D:candidate', // in C's fence → straight after C
    ]);
  });
});

expect.extend({
  toBeWithinRange(received: number, min: number, max: number) {
    const pass = received >= min && received <= max;
    return { pass, message: () => `expected ${received} to be within ${min}..${max}` };
  },
});
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(min: number, max: number): R;
    }
  }
}
