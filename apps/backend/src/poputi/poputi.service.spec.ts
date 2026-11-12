import { PoputiService } from './poputi.service';

// Tashkent, roughly. Fences are 5 km, so these are chosen to sit clearly inside
// or clearly outside one.
const CHILONZOR = { lat: 41.2756, lng: 69.2034 };
const YUNUSOBOD = { lat: 41.3478, lng: 69.2896 };
const SERGELI = { lat: 41.2211, lng: 69.2203 };

/** `metres` east of `p` — latitude is unchanged, so the distance is exact enough. */
function east(p: { lat: number; lng: number }, metres: number) {
  return { lat: p.lat, lng: p.lng + metres / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

function vehicle(over: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    model: 'Isuzu',
    plateNumber: '01A123BC',
    category: 'katta',
    capacityKg: 3000,
    driver: {
      id: 'd1',
      currentStatus: 'busy',
      locationLat: CHILONZOR.lat,
      locationLng: CHILONZOR.lng,
      user: { name: 'Bahodir' },
    },
    ...over,
  };
}

function order(over: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    assignedDriverId: 'd1',
    status: 'collecting_items',
    poputiAllowed: true,
    weightKg: 500,
    clientName: 'Akmal',
    deliveryLat: YUNUSOBOD.lat,
    deliveryLng: YUNUSOBOD.lng,
    geoDistrict: { name: 'Yunusobod' },
    pickupSources: [
      { id: 'ps1', name: 'Sklad A', position: 0, legStatus: 'pending', lat: CHILONZOR.lat, lng: CHILONZOR.lng },
    ],
    ...over,
  };
}

function make(vehicles: ReturnType<typeof vehicle>[], orders: ReturnType<typeof order>[], km = 4) {
  const prisma = {
    vehicle: { findMany: jest.fn().mockResolvedValue(vehicles) },
    order: {
      findMany: jest.fn().mockImplementation(({ where }: { where?: { kind?: string } }) =>
        Promise.resolve(where?.kind === 'vozvrat' ? [] : orders),
      ),
    },
  };
  // Every route call answers the same length, so the detour is a fixed number;
  // what these tests care about is which vehicles get there at all.
  const valhalla = {
    route: jest.fn().mockImplementation((req: { locations: unknown[] }) =>
      Promise.resolve({
        summary: { length_km: km * req.locations.length, time_seconds: 60 * req.locations.length },
      }),
    ),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new PoputiService(prisma as any, valhalla as any), prisma, valhalla };
}

const probe = (over: Record<string, unknown> = {}) => ({
  pickups: [east(CHILONZOR, 1000)],
  delivery: east(YUNUSOBOD, 1000),
  weight_kg: 400,
  ...over,
});

describe('PoputiService.search', () => {
  it('finds the trucks whose run the cargo fits', async () => {
    const { svc } = make([vehicle()], [order()]);
    const { matches, nearMisses } = await svc.search(probe());
    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.vehicle.plateNumber).toBe('01A123BC');
    expect(matches[0].candidate.driverName).toBe('Bahodir');
    expect(matches[0].candidate.headingTo).toBe('Yunusobod');
    expect(matches[0].fit.eligible).toBe(true);
    expect(nearMisses).toHaveLength(0);
  });

  it('routes only what cleared the fences', async () => {
    // Two trucks: one whose client is in Yunusobod, one out in Sergeli.
    const far = order({ id: 'o2', assignedDriverId: 'd2', deliveryLat: SERGELI.lat, deliveryLng: SERGELI.lng });
    const { svc, valhalla } = make(
      [vehicle(), vehicle({ id: 'v2', plateNumber: '01B222BB', driver: { ...vehicle().driver, id: 'd2' } })],
      [order(), far],
    );
    const { matches } = await svc.search(probe());
    expect(matches).toHaveLength(1);
    // Three calls for the one survivor (base + merged detour, and the pickup
    // time estimate — owner, 10.11.2026), none for the other.
    expect(valhalla.route).toHaveBeenCalledTimes(3);
    expect(matches[0]!.pickupEta).toBeInstanceOf(Date);
  });

  it('sorts matches by the cheapest detour', async () => {
    const second = order({ id: 'o2', assignedDriverId: 'd2' });
    const { svc } = make(
      [vehicle(), vehicle({ id: 'v2', plateNumber: '01B222BB', driver: { ...vehicle().driver, id: 'd2' } })],
      [order(), second],
    );
    const { matches } = await svc.search(probe());
    const km = matches.map((m) => m.fit.detour_km ?? Infinity);
    expect([...km].sort((a, b) => a - b)).toEqual(km);
  });

  it('reports a cargo-level refusal as a near miss, with the distance', async () => {
    const { svc } = make([vehicle()], [order()]);
    const { matches, nearMisses } = await svc.search(probe({ delivery: east(YUNUSOBOD, 9000) }));
    expect(matches).toHaveLength(0);
    expect(nearMisses).toHaveLength(1);
    expect(nearMisses[0].rejection.reason).toBe('delivery_outside_fence');
    expect(nearMisses[0].rejection.overByM).toBeGreaterThan(3500);
  });

  it('reports the cumulative weight that would not fit', async () => {
    const { svc } = make([vehicle({ capacityKg: 800 })], [order({ weightKg: 600 })]);
    const { nearMisses } = await svc.search(probe({ weight_kg: 400 }));
    expect(nearMisses[0].rejection.reason).toBe('capacity_exceeded');
    // 600 aboard + 400 offered against an 800 kg plate.
    expect(nearMisses[0].rejection.overCapacityKg).toBe(200);
  });

  it.each([
    ['idle', [] as ReturnType<typeof order>[]],
    ['consent withheld', [order({ poputiAllowed: false })]],
  ])('leaves a truck that was never a candidate out of the near misses (%s)', async (_label, orders) => {
    const { svc } = make([vehicle()], orders);
    const { matches, nearMisses } = await svc.search(probe());
    expect(matches).toHaveLength(0);
    // These are not "nearly" anything — listing them would bury the real ones.
    expect(nearMisses).toHaveLength(0);
  });

  it('leaves an offline driver out of the near misses', async () => {
    const off = vehicle({ driver: { ...vehicle().driver, currentStatus: 'offline' } });
    const { svc } = make([off], [order()]);
    const { nearMisses } = await svc.search(probe());
    expect(nearMisses).toHaveLength(0);
  });

  it('caps the near-miss list and keeps the closest', async () => {
    const vehicles = [];
    const orders = [];
    for (let i = 0; i < 9; i++) {
      const id = `d${i}`;
      vehicles.push(vehicle({ id: `v${i}`, plateNumber: `01A00${i}`, driver: { ...vehicle().driver, id } }));
      // Each client sits progressively further from the probe's delivery.
      orders.push(order({ id: `o${i}`, assignedDriverId: id, deliveryLat: YUNUSOBOD.lat, deliveryLng: east(YUNUSOBOD, 7000 + i * 2000).lng }));
    }
    const { svc } = make(vehicles, orders);
    const { nearMisses } = await svc.search(probe());
    expect(nearMisses).toHaveLength(5);
    const over = nearMisses.map((n) => n.rejection.overByM ?? 0);
    expect([...over].sort((a, b) => a - b)).toEqual(over);
  });

  it('keeps the co-load when routing is down, without a number', async () => {
    const { svc, valhalla } = make([vehicle()], [order()]);
    valhalla.route.mockRejectedValue(new Error('valhalla down'));
    const { matches } = await svc.search(probe());
    expect(matches).toHaveLength(1);
    expect(matches[0].fit.eligible).toBe(true);
    expect(matches[0].fit.detour_km).toBeNull();
  });

  it('answers empty when no vehicle has a driver', async () => {
    const { svc, prisma } = make([], []);
    await expect(svc.search(probe())).resolves.toEqual({ matches: [], nearMisses: [] });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});
