import { PoputiService } from './poputi.service';

/**
 * The po puti test plan, executable.
 *
 * The unit specs beside this one test each rule in isolation with hand-built
 * fences. These drive the whole decision through `planForVehicle` — the entry
 * point `fill()` and the search both use — from order rows to verdict, with
 * fixtures at measured distances. Case numbers match the written plan, so a
 * failure here names the scenario a person would have clicked through.
 *
 * Distances are due east of each anchor, which makes them exact rather than
 * approximate: 3.5 km is inside a 4 km fence and 4.5 km is outside, with no
 * argument about rounding.
 */

// The running order: pickups A then B, client C.
const A = { lat: 41.2756, lng: 69.2034 }; // Sklad A, Chilonzor
const B = { lat: 41.3478, lng: 69.2896 }; // Bozor B, Yunusobod
const C = { lat: 41.3111, lng: 69.2797 }; // its client

const A15 = { lat: 41.2756, lng: 69.221329 }; // 1.5 km from A
const A35 = { lat: 41.2756, lng: 69.245235 }; // 3.5 km — inside
const A45 = { lat: 41.2756, lng: 69.257188 }; // 4.5 km — outside
const B15 = { lat: 41.3478, lng: 69.307549 }; // 1.5 km from B
const C15 = { lat: 41.3111, lng: 69.297639 }; // 1.5 km from C
const C90 = { lat: 41.3111, lng: 69.387334 }; // 9.0 km from C — outside

/**
 * A client far from both pickups (9 km east of B), used where a case has to
 * isolate one fence closing. With the real client C the anchors are only
 * 4.16 km apart, which makes several fences overlap — true to Tashkent, and
 * the subject of its own case below.
 */
const FAR = { lat: 41.3478, lng: 69.397295 };
const FAR15 = { lat: 41.3478, lng: 69.415224 }; // 1.5 km from FAR

interface HostOpts {
  poputiAllowed?: boolean;
  status?: string;
  /** Which pickups the driver has already collected. */
  collected?: ('A' | 'B')[];
  weightKg?: number;
}

function hostOrder(o: HostOpts & { id?: string } = {}) {
  const collected = o.collected ?? [];
  return {
    id: o.id ?? 'host',
    isBackhaul: false,
    deliveryTripPosition: null as number | null,
    deliveryDatetime: new Date('2026-11-10T05:00:00Z'),
    assignedDriverId: 'd1',
    status: o.status ?? 'collecting_items',
    poputiAllowed: o.poputiAllowed ?? true,
    weightKg: o.weightKg ?? 1000,
    clientName: 'Akmal',
    deliveryLat: C.lat,
    deliveryLng: C.lng,
    geoDistrict: { name: 'Chilonzor' },
    pickupSources: [
      { id: 'A', name: 'Sklad A', position: 0, legStatus: collected.includes('A') ? 'arrived' : 'pending', ...A },
      { id: 'B', name: 'Bozor B', position: 1, legStatus: collected.includes('B') ? 'arrived' : 'pending', ...B },
    ],
  };
}

interface Setup {
  host?: ReturnType<typeof hostOrder> | null;
  /** Where the driver is standing. Defaults to A, at the start of the run. */
  driverAt?: { lat: number; lng: number } | null;
  driverStatus?: string;
  capacityKg?: number;
  /** Several orders on the truck, in queue order (2x, 3x, bron). Overrides `host`. */
  orders?: Record<string, unknown>[];
  /** Seconds the routing engine charges per waypoint. */
  perStop?: number;
  /** When the phone last sent the driver's position (default: now). */
  locationAt?: Date | null;
  /** The truck's body length, cm. */
  lengthCm?: number;
}

function service(s: Setup = {}) {
  const at = s.driverAt === undefined ? A : s.driverAt;
  const vehicle = {
    id: 'v1',
    model: 'Isuzu',
    plateNumber: '01A123BC',
    category: 'katta',
    capacityKg: s.capacityKg ?? 3000,
    lengthCm: s.lengthCm ?? null,
    driver: {
      id: 'd1',
      currentStatus: s.driverStatus ?? 'busy',
      locationLat: at?.lat ?? null,
      locationLng: at?.lng ?? null,
      locationUpdatedAt: s.locationAt === undefined ? new Date() : s.locationAt,
      user: { name: 'Bahodir' },
    },
  };
  const orders = s.orders ?? (s.host === null ? [] : [s.host ?? hostOrder()]);
  const prisma = {
    vehicle: { findUnique: jest.fn().mockResolvedValue(vehicle) },
    // The vozvrats on their way back are asked for separately (kind: 'vozvrat').
    order: {
      findMany: jest.fn().mockImplementation(({ where }: { where?: { kind?: string } }) =>
        Promise.resolve(
          where?.kind === 'vozvrat'
            ? (orders as { kind?: string; status?: string }[]).filter((o) => o.kind === 'vozvrat' && o.status === 'returning')
            : (orders as { kind?: string; status?: string }[]).filter((o) => !(o.kind === 'vozvrat' && o.status === 'returning')),
        ),
      ),
    },
  };
  // A fixed length per waypoint, so the detour is a stable number: what these
  // cases assert is the verdict, not the routing engine's arithmetic.
  const valhalla = {
    route: jest.fn().mockImplementation((req: { locations: unknown[] }) =>
      Promise.resolve({
        summary: { length_km: 5 * req.locations.length, time_seconds: (s.perStop ?? 300) * req.locations.length },
        legs: req.locations.slice(1).map(() => ({ summary: { length_km: 5, time_seconds: s.perStop ?? 300 } })),
      }),
    ),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PoputiService(prisma as any, valhalla as any);
}

const cargo = (pickups: { lat: number; lng: number }[], delivery: { lat: number; lng: number }, weight = 500) => ({
  pickups,
  delivery,
  weight_kg: weight,
});

describe('po puti — part 1, the gates', () => {
  it('case 1 · refuses when the running order withheld consent', async () => {
    const svc = service({ host: hostOrder({ poputiAllowed: false }) });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit).toMatchObject({ eligible: false, reason: 'not_allowed' });
  });

  it('case 2 · a driver not on shift yet still takes it with his booked order', async () => {
    const svc = service({ driverStatus: 'offline' });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit).toMatchObject({ eligible: true });
  });

  it('case 3 · refuses when the truck is running nothing', async () => {
    const svc = service({ host: null });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit).toMatchObject({ eligible: false, reason: 'no_active_order' });
  });

  it('case 4 · everything collected: a pickup far from both the driver and the client is refused', async () => {
    const svc = service({ host: hostOrder({ collected: ['A', 'B'] }), driverAt: C });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit).toMatchObject({ eligible: false, reason: 'pickup_outside_fences' });
  });

  it('case 4a · everything collected, pickup near where the driver is: taken on the way, before his client (owner, 10.11.2026)', async () => {
    const svc = service({ host: hostOrder({ collected: ['A', 'B'] }), driverAt: B });
    const { fit } = await svc.planForVehicle('v1', cargo([B15], C15));
    expect(fit).toMatchObject({ eligible: true, reys: 1 });
    expect(fit.sequence.map((x) => `${x.belongs_to}:${x.kind}`)).toEqual([
      'candidate:pickup',
      'running:client',
      'candidate:client',
    ]);
  });

  it('case 4b · everything collected, pickup near his client: taken right after handing over', async () => {
    const svc = service({ host: hostOrder({ collected: ['A', 'B'] }), driverAt: A });
    const { fit } = await svc.planForVehicle('v1', cargo([C15], C15));
    expect(fit).toMatchObject({ eligible: true, reys: 1 });
    expect(fit.sequence.map((x) => `${x.belongs_to}:${x.kind}`)).toEqual([
      'running:client',
      'candidate:pickup',
      'candidate:client',
    ]);
  });
});

describe('po puti — part 2, the three rules', () => {
  it('case 5 · accepts a cargo well inside both fences', async () => {
    const { fit } = await service().planForVehicle('v1', cargo([A15], C15));
    expect(fit.eligible).toBe(true);
    expect(fit.reason).toBeNull();
    expect(fit.detour_km).not.toBeNull();
  });

  it('case 6 · accepts a pickup at 3.5 km — inside the fence', async () => {
    const { fit } = await service().planForVehicle('v1', cargo([A35], C15));
    expect(fit.eligible).toBe(true);
  });

  it('case 7 · refuses a pickup at 4.5 km, and says how far over', async () => {
    const { fit } = await service().planForVehicle('v1', cargo([A45], C15));
    expect(fit).toMatchObject({ eligible: false, reason: 'pickup_outside_fences' });
  });

  it('case 8 · refuses a client 9 km from the running order’s client', async () => {
    const { fit } = await service().planForVehicle('v1', cargo([A15], C90));
    expect(fit).toMatchObject({ eligible: false, reason: 'delivery_outside_fence' });
  });

  it('case 9 · accepts two pickups that both land in A’s fence — collected at A (owner, 09.11.2026)', async () => {
    // Short hops: two loadings (30 min) before the first client still fit 35.
    const { fit } = await service({ perStop: 60 }).planForVehicle('v1', cargo([A15, A35], C15));
    expect(fit.eligible).toBe(true);
  });

  it('case 10 · accepts two pickups when each has a fence of its own', async () => {
    const { fit } = await service({ perStop: 60 }).planForVehicle('v1', cargo([A15, B15], C15));
    expect(fit.eligible).toBe(true);
  });

  it('case 11 · three pickups before the first client: 66 min of loading (22 each), over the hour — refused (owner, 11.11.2026)', async () => {
    const { fit } = await service({ perStop: 60 }).planForVehicle('v1', cargo([A15, B15, A35], C15));
    expect(fit).toMatchObject({ eligible: false, reason: 'detour_too_long' });
  });
});

describe('po puti — part 3, fences the driver has passed', () => {
  // Spread fixture: A→B is 10.8 km and B→FAR is 9 km, so each fence closes on
  // its own and the rule can be read without overlap muddying it.
  const spread = (driverAt: { lat: number; lng: number }, collected: ('A' | 'B')[] = []) =>
    service({
      driverAt,
      host: {
        ...hostOrder({ collected }),
        deliveryLat: FAR.lat,
        deliveryLng: FAR.lng,
      },
    });

  it('case 12 · accepts a stop near A while the driver is still at A', async () => {
    const { fit } = await spread(A).planForVehicle('v1', cargo([A15], FAR15));
    expect(fit.eligible).toBe(true);
  });

  it('case 13a · refuses the same stop once A has been collected', async () => {
    const { fit } = await spread(B, ['A']).planForVehicle('v1', cargo([A15], FAR15));
    expect(fit).toMatchObject({ eligible: false, reason: 'pickup_outside_fences' });
  });

  it('case 13b · refuses it even when A is still pending, if the driver stands at B', async () => {
    // Rule 2 proper: the stop is not collected, but going back for it would mean
    // turning round, so its fence is closed by the driver's own position.
    const { fit } = await spread(B).planForVehicle('v1', cargo([A15], FAR15));
    expect(fit).toMatchObject({ eligible: false, reason: 'pickup_outside_fences' });
  });

  it('still takes a stop near B, which the driver has reached but not collected', async () => {
    const { fit } = await spread(B).planForVehicle('v1', cargo([B15], FAR15));
    expect(fit.eligible).toBe(true);
  });

  it('treats a driver who has never reported a position as being at the start', async () => {
    const { fit } = await service({ driverAt: null }).planForVehicle('v1', cargo([A15], C15));
    expect(fit.eligible).toBe(true);
  });

  /**
   * The case that prompted the rule to be sharpened. Stops here are 4.16 km
   * apart — the ordinary spacing in Tashkent — so a driver parked at B is
   * inside C's fence as well. "Reached" is the nearest stop within range, not
   * the last, so B keeps its own fence and a co-load for B's neighbourhood is
   * offered at the moment it is most useful.
   */
  it('keeps the fence of the stop the driver is parked at, even with the next one in range', async () => {
    const { fit } = await service({ driverAt: B }).planForVehicle('v1', cargo([B15], C15));
    expect(fit.eligible).toBe(true);
  });

  it('still closes the fence of a stop the driver has driven past', async () => {
    // Same dense fixture, but the candidate is back at A — behind the driver.
    const { fit } = await service({ driverAt: B }).planForVehicle('v1', cargo([A15], C15));
    expect(fit).toMatchObject({ eligible: false, reason: 'pickup_outside_fences' });
  });
});

describe('po puti — part 4, capacity is cumulative', () => {
  it('case 14 · accepts 1 000 aboard + 1 500 offered against a 3 000 kg truck', async () => {
    const { fit } = await service().planForVehicle('v1', cargo([A15], C15, 1500));
    expect(fit.eligible).toBe(true);
  });

  it('case 15 · refuses 1 000 aboard + 2 500 offered against the same truck', async () => {
    const { fit } = await service().planForVehicle('v1', cargo([A15], C15, 2500));
    expect(fit).toMatchObject({ eligible: false, reason: 'capacity_exceeded' });
  });

  it('accepts what a sequential 2x booking would allow, only because it rides alone', async () => {
    // Same 2 500 kg against an empty truck of the same size: the refusal above
    // is about both loads being aboard at once, not about the cargo.
    const svc = service({ host: hostOrder({ weightKg: 0 }) });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15, 2500));
    expect(fit.eligible).toBe(true);
  });
});

describe('po puti — part 5, the merged trip', () => {
  it('hangs each added stop off the running stop whose fence took it', async () => {
    const { fit } = await service({ perStop: 60 }).planForVehicle('v1', cargo([A15, B15], C15));
    expect(fit.sequence.map((s) => `${s.belongs_to}:${s.kind}`)).toEqual([
      'running:pickup', // Sklad A
      'candidate:pickup', // the stop inside A's fence, immediately after it
      'running:pickup', // Bozor B
      'candidate:pickup', // the stop inside B's fence
      'running:client', // the host's client
      'candidate:client', // ours, in the same fence
    ]);
  });

  it('names the host order, so the caller knows which trip it joined', async () => {
    const { hostOrderId } = await service().planForVehicle('v1', cargo([A15], C15));
    expect(hostOrderId).toBe('host');
  });

  it('carries the co-load even when the detour cannot be measured', async () => {
    const svc = service();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((svc as any).valhalla.route as jest.Mock).mockRejectedValue(new Error('valhalla down'));
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit.eligible).toBe(true);
    expect(fit.reason).toBe('routing_unavailable');
    expect(fit.detour_km).toBeNull();
  });
});

/** A second order on the truck, nowhere near the first: Yunusobod pickup, far client. */
function farOrder(id: string, o: Partial<{ weightKg: number; poputiAllowed: boolean }> = {}) {
  return {
    ...hostOrder({ id, status: 'driver_accepted', weightKg: o.weightKg ?? 1000, poputiAllowed: o.poputiAllowed ?? true }),
    deliveryLat: FAR.lat,
    deliveryLng: FAR.lng,
    pickupSources: [{ id: `${id}-B`, name: 'Bozor B', position: 0, legStatus: 'pending', ...B }],
  };
}

describe('po puti — every order on the truck is a trip of its own (owner, 10.11.2026)', () => {
  it('2x zanyat: the cargo fits only the second order → offered on it, as reys 2', async () => {
    const first = hostOrder({ id: 'o1' });
    const second = farOrder('o2');
    const svc = service({ orders: [first, second] });
    const { fit, hostOrderId } = await svc.planForVehicle('v1', cargo([B15], FAR15));
    expect(fit).toMatchObject({ eligible: true, reys: 2, host_order_id: 'o2' });
    expect(hostOrderId).toBe('o2');
  });

  it('fits both: the earlier trip is taken', async () => {
    const svc = service({ orders: [hostOrder({ id: 'o1' }), hostOrder({ id: 'o2', status: 'driver_accepted' })] });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit).toMatchObject({ eligible: true, reys: 1 });
  });

  it("weight counts that trip's load only, not the truck's whole queue", async () => {
    // 1500 kg truck, 1000 kg on each of two trips, 300 kg more on the first: 1300, it fits.
    const svc = service({ capacityKg: 1500, orders: [hostOrder({ id: 'o1' }), farOrder('o2')] });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15, 300));
    expect(fit).toMatchObject({ eligible: true, reys: 1 });
    // 600 kg does not fit the first trip (1600), and is nowhere near the second.
    const over = await svc.planForVehicle('v1', cargo([A15], C15, 600));
    expect(over.fit).toMatchObject({ eligible: false, reason: 'capacity_exceeded' });
  });

  it('a trip the seller did not open to po puti is skipped, the next one is tried', async () => {
    const svc = service({ orders: [hostOrder({ id: 'o1', poputiAllowed: false }), farOrder('o2')] });
    const { fit } = await svc.planForVehicle('v1', cargo([B15], FAR15));
    expect(fit).toMatchObject({ eligible: true, reys: 2 });
  });

  it('the picked trip only: asked for o1, a cargo that fits only o2 is refused', async () => {
    const svc = service({ orders: [hostOrder({ id: 'o1' }), farOrder('o2')] });
    const { fit } = await svc.planForVehicle('v1', cargo([B15], FAR15), 'o1');
    expect(fit.eligible).toBe(false);
  });

  it('one po puti on a truck at a time: a merged trip already aboard closes it', async () => {
    const merged = { ...hostOrder({ id: 'o1' }), deliveryTripPosition: 2 };
    const svc = service({ orders: [merged] });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit).toMatchObject({ eligible: false, reason: 'poputi_taken' });
  });

  it('more than an hour added to the driver: refused (owner, 11.11.2026; was 35 min)', async () => {
    // Two added stops at 21 min each = 42 min on the map, 63 with traffic.
    const svc = service({ perStop: 1260 });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit).toMatchObject({ eligible: false, reason: 'detour_too_long' });
  });

  it('road time counts one and a half times over (owner, 11.11.2026): the seller sees the map minutes x1.5', async () => {
    // Two added stops at 5 min each = 10 min on the map, 15 with traffic.
    const ok = await service({ perStop: 300 }).planForVehicle('v1', cargo([A15], C15));
    expect(ok.fit).toMatchObject({ eligible: true, detour_seconds: 900 });
  });

  it('two hours (owner, 11.11.2026): set off 100 minutes ago, his client 75 minutes from now — refused', async () => {
    // From the driver at A: A, the po puti pickup, B, then his client C — 4 legs at
    // 5 min x1.5 (30 min) and 3 stops' loading (45 min) = 75 min from now.
    const started = { ...hostOrder(), journeyStartedAt: new Date(Date.now() - 100 * 60_000) };
    const late = await service({ host: started as never, perStop: 300 }).planForVehicle('v1', cargo([A15], C15));
    expect(late.fit).toMatchObject({ eligible: false, reason: 'detour_too_long' });
    // Set off 20 minutes ago: 20 + 75 is within two hours.
    const fresh = { ...hostOrder(), journeyStartedAt: new Date(Date.now() - 20 * 60_000) };
    const ok = await service({ host: fresh as never, perStop: 300 }).planForVehicle('v1', cargo([A15], C15));
    expect(ok.fit.eligible).toBe(true);
  });

  it('the first client’s wait counts the loading too (owner, 11.11.2026): 2 map minutes + 22 loading', async () => {
    // One added pickup before his client: 2 min × 1.5 = 3 min road + 22 min loading = 25; his seller is told 25.
    const ok = await service({ perStop: 120 }).planForVehicle('v1', cargo([A15], C15));
    expect(ok.fit).toMatchObject({ eligible: true, host_delay_seconds: 1500 });
  });

  it('the first client’s latest time is set when the po puti joins (owner, 11.11.2026)', async () => {
    const { fit } = await service({ perStop: 120 }).planForVehicle('v1', cargo([A15], C15));
    // At most two hours from now (the driver has not set off in this fixture).
    expect(fit.host_deadline_seconds).toBeGreaterThan(30 * 60);
    expect(fit.host_deadline_seconds).toBeLessThanOrEqual(120 * 60);
  });
});

describe('po puti — on the driver’s way to his first pickup (owner, 10.11.2026)', () => {
  it('a pickup near where he is now: collected first, then his own pickups', async () => {
    const svc = service({ driverAt: FAR });
    const { fit } = await svc.planForVehicle('v1', cargo([FAR15], C15));
    expect(fit).toMatchObject({ eligible: true, reys: 1 });
    expect(fit.sequence[0]).toMatchObject({ belongs_to: 'candidate', kind: 'pickup' });
    expect(fit.sequence.map((x) => x.belongs_to)).toEqual(['candidate', 'running', 'running', 'running', 'candidate']);
  });

  it('his position is old (phone silent): it does not count', async () => {
    const svc = service({ driverAt: FAR, locationAt: new Date(Date.now() - 30 * 60_000) });
    const { fit } = await svc.planForVehicle('v1', cargo([FAR15], C15));
    expect(fit.eligible).toBe(false);
  });
});

describe('po puti — length and the first seller’s own limit (owner, 10.11.2026)', () => {
  it('a 6 m pipe does not go into a 4.2 m body; a 4 m one does', async () => {
    const svc = service({ lengthCm: 420 });
    const long = await svc.planForVehicle('v1', { ...cargo([A15], C15), length_cm: 600 });
    expect(long.fit).toMatchObject({ eligible: false, reason: 'too_long' });
    const fits = await svc.planForVehicle('v1', { ...cargo([A15], C15), length_cm: 400 });
    expect(fits.fit.eligible).toBe(true);
  });

  it('a 15/30/45 left on an older order no longer limits (owner, 11.11.2026): po puti is on or off', async () => {
    const host = { ...hostOrder(), poputiMaxDelayMin: 15 };
    // 3 min road + 22 loading = 25 — over the old 15, within the hour.
    const { fit } = await service({ host: host as never, perStop: 120 }).planForVehicle('v1', cargo([A15], C15));
    expect(fit.eligible).toBe(true);
  });
});

describe('po puti — the same seller’s second client on one trip (owner, 11.11.2026)', () => {
  // The truck already carries s1's po puti: host pickups A(0), B(2); s1's pickup near A (1);
  // host client C (3), s1's client near C (4).
  const merged = (coloads: Record<string, unknown>[]) => [
    {
      ...hostOrder(),
      createdBySellerId: 'host-seller',
      deliveryTripPosition: 3,
      pickupSources: [
        { id: 'A', name: 'Sklad A', position: 0, legStatus: 'pending', tripPosition: 0, ...A },
        { id: 'B', name: 'Bozor B', position: 1, legStatus: 'pending', tripPosition: 2, ...B },
      ],
    },
    ...coloads,
  ];
  const coload = (id: string, seller: string, posPickup: number, posClient: number) => ({
    ...hostOrder({ id, weightKg: 300 }),
    isBackhaul: true,
    poputiAllowed: false,
    createdBySellerId: seller,
    clientName: `Mijoz ${id}`,
    deliveryLat: C15.lat,
    deliveryLng: C15.lng,
    deliveryTripPosition: posClient,
    pickupSources: [{ id: `${id}-p`, name: 'Ombor', position: 0, legStatus: 'pending', tripPosition: posPickup, ...A15 }],
  });

  it('the seller already aboard adds a second client: fitted into the whole trip, after the host’s client', async () => {
    const svc = service({ orders: merged([coload('co1', 's1', 1, 4)]), perStop: 60 });
    const { fit, sequence } = await svc.planForVehicle('v1', cargo([A35], C15), null, 's1');
    expect(fit).toMatchObject({ eligible: true, host_order_id: 'host' });
    const hostClient = sequence.findIndex((x) => x.kind === 'client' && x.orderId === 'host');
    const newClient = sequence.findIndex((x) => x.belongsTo === 'candidate' && x.kind === 'client');
    expect(newClient).toBeGreaterThan(hostClient);
    // The first po puti's stops are still on the trip.
    expect(sequence.some((x) => x.pickupSourceId === 'co1-p')).toBe(true);
    expect(sequence.some((x) => x.kind === 'client' && x.orderId === 'co1')).toBe(true);
  });

  it('another seller: refused, the truck already carries a po puti', async () => {
    const svc = service({ orders: merged([coload('co1', 's1', 1, 4)]), perStop: 60 });
    const { fit } = await svc.planForVehicle('v1', cargo([A35], C15), null, 's2');
    expect(fit).toMatchObject({ eligible: false, reason: 'poputi_taken' });
  });

  it('a third client of the same seller: refused (two at most)', async () => {
    const svc = service({ orders: merged([coload('co1', 's1', 1, 4), coload('co2', 's1', 5, 6)]), perStop: 60 });
    const { fit } = await svc.planForVehicle('v1', cargo([A35], C15), null, 's1');
    expect(fit).toMatchObject({ eligible: false, reason: 'poputi_taken' });
  });

  it('the weight of what is already aboard counts', async () => {
    // host 1000 + aboard 300 + 1800 = 3100 > 3000
    const svc = service({ orders: merged([coload('co1', 's1', 1, 4)]), perStop: 60 });
    const { fit } = await svc.planForVehicle('v1', cargo([A35], C15, 1800), null, 's1');
    expect(fit).toMatchObject({ eligible: false, reason: 'capacity_exceeded' });
  });
});

describe('po puti — a vozvrat carrying its goods back (owner, 11.11.2026)', () => {
  // The vozvrat's return place: the warehouse at C. The driver is at A, on his way there.
  const vozvrat = (over: Record<string, unknown> = {}) => ({
    ...hostOrder({ id: 'voz', weightKg: 400 }),
    kind: 'vozvrat',
    status: 'returning',
    poputiAllowed: false,
    deliveryTripPosition: null,
    pickupSources: [
      { id: 'ret', name: 'Ombor', position: 0, legStatus: 'pending', returnRequired: true, returnedAt: null, tripPosition: null, ...C },
    ],
    ...over,
  });

  it('a pickup near the driver and a client near the return place: picked up first, delivered after the drop', async () => {
    const svc = service({ orders: [vozvrat()], perStop: 60 });
    const { fit, sequence, hostOrderId } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit).toMatchObject({ eligible: true });
    expect(hostOrderId).toBe('voz');
    expect(sequence.map((x) => `${x.belongsTo}:${x.kind}`)).toEqual(['candidate:pickup', 'running:client', 'candidate:client']);
    expect(sequence[1]).toMatchObject({ pickupSourceId: 'ret' });
  });

  it('the new client far from the return place: refused', async () => {
    const svc = service({ orders: [vozvrat()], perStop: 60 });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C90));
    expect(fit.eligible).toBe(false);
  });

  it('the vozvrat’s goods count in the weight', async () => {
    // 400 aboard + 2700 = 3100 > 3000
    const svc = service({ orders: [vozvrat()], perStop: 60 });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15, 2700));
    expect(fit.eligible).toBe(false);
  });

  it('a vozvrat already carrying a po puti: no second one', async () => {
    const taken = vozvrat({
      pickupSources: [{ id: 'ret', name: 'Ombor', position: 0, legStatus: 'pending', returnRequired: true, returnedAt: null, tripPosition: 1, ...C }],
    });
    const svc = service({ orders: [taken], perStop: 60 });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit).toMatchObject({ eligible: false, reason: 'poputi_taken' });
  });

  it('a vozvrat still on its way to the client is not a host (unchanged)', async () => {
    const svc = service({ orders: [vozvrat({ status: 'on_the_way' })], perStop: 60 });
    const { fit } = await svc.planForVehicle('v1', cargo([A15], C15));
    expect(fit.eligible).toBe(false);
  });
});
