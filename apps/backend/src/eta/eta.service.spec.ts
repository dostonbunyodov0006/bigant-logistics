import { ServiceUnavailableException } from '@nestjs/common';
import type { OrderPublic } from '@bigant/shared';
import { EtaService, remainingStops } from './eta.service';

const actor = { userId: 'u1', role: 'admin' as const };

function source(over: Partial<OrderPublic['pickup_sources'][number]> = {}) {
  return {
    id: 'ps1', pickup_place_id: 'pp1', name: 'Sklad', position: 0, leg_status: 'pending' as const,
    region_name: null, district_name: null, lat: 41.2856, lng: 69.2034, load_photo_url: null,
    return_required: false, return_destination: null, return_stage: null, return_proof_photo_url: null, returned_at: null,
    ...over,
  };
}

function order(over: Partial<OrderPublic> = {}): OrderPublic {
  return {
    id: 'o1', status: 'driver_accepted', assigned_driver_id: 'd1', client_name: 'Barakat',
    delivery_lat: 41.3111, delivery_lng: 69.2797,
    pickup_sources: [source()],
    ...over,
  } as OrderPublic;
}

function leg(km: number, s: number) {
  return { summary: { length_km: km, time_seconds: s, has_toll: false, has_highway: false, has_ferry: false, has_time_restrictions: false }, shape: '', maneuvers: [] };
}

function make(opts: { order?: OrderPublic; driver?: unknown; legs?: ReturnType<typeof leg>[]; fail?: Error } = {}) {
  const o = opts.order ?? order();
  const legs = opts.legs ?? [leg(6.2, 840), leg(9.1, 1260)];
  const prisma = { driver: { findUnique: jest.fn().mockResolvedValue(
    'driver' in opts ? opts.driver : { locationLat: 41.29, locationLng: 69.20, locationUpdatedAt: new Date(Date.now() - 20_000) },
  ) } };
  const orders = { findOneForActor: jest.fn().mockResolvedValue(o) };
  const valhalla = { route: opts.fail
    ? jest.fn().mockRejectedValue(opts.fail)
    : jest.fn().mockResolvedValue({
        units: 'kilometers',
        summary: { length_km: legs.reduce((a, l) => a + l.summary.length_km, 0), time_seconds: legs.reduce((a, l) => a + l.summary.time_seconds, 0), has_toll: false, has_highway: false, has_ferry: false, has_time_restrictions: false },
        legs,
      }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new EtaService(prisma as any, orders as any, valhalla as any, {} as any, { factor: () => 1 } as any), prisma, orders, valhalla };
}

describe('remainingStops — what is still to be driven, per status', () => {
  it('before collection: every un-arrived pickup in position order, then the client', () => {
    const o = order({
      pickup_sources: [
        source({ id: 'b', position: 1, name: 'B' }),
        source({ id: 'a', position: 0, name: 'A', leg_status: 'arrived' }),
        source({ id: 'c', position: 2, name: 'C' }),
      ],
    });
    const stops = remainingStops(o);
    expect(Array.isArray(stops) && stops.map((s) => s.id)).toEqual(['b', 'c', null]);
  });

  it('after collection: only the client remains', () => {
    for (const status of ['items_collected', 'on_the_way'] as const) {
      const stops = remainingStops(order({ status }));
      expect(Array.isArray(stops) && stops.map((s) => s.kind)).toEqual(['client']);
    }
  });

  it('at the customer: nothing left to drive', () => {
    expect(remainingStops(order({ status: 'arrived_at_customer' }))).toEqual([]);
  });

  it('returns are not routable — destinations are categories, not places', () => {
    expect(remainingStops(order({ status: 'returning' }))).toEqual({ reason: 'returns_not_routable' });
  });

  it('finished or not-yet-started orders have no ETA', () => {
    for (const status of ['created', 'assigned_to_driver', 'delivered', 'cancelled', 'returned'] as const) {
      expect(remainingStops(order({ status }))).toEqual({ reason: 'order_not_active' });
    }
  });

  it('a legacy order without pins is unavailable, whichever stop is missing them', () => {
    expect(remainingStops(order({ delivery_lat: null, delivery_lng: null }))).toEqual({ reason: 'missing_coordinates' });
    expect(remainingStops(order({ pickup_sources: [source({ lat: null, lng: null })] }))).toEqual({ reason: 'missing_coordinates' });
    // An already-arrived pickup without pins does not matter: nobody drives there again.
    const arrivedUnpinned = order({ pickup_sources: [source({ leg_status: 'arrived', lat: null, lng: null })] });
    expect(Array.isArray(remainingStops(arrivedUnpinned))).toBe(true);
  });
});

describe('EtaService.forOrder', () => {
  it('routes driver → each remaining stop and reports next stop + total to delivery', async () => {
    const { svc, valhalla } = make();
    const eta = await svc.forOrder('o1', actor);

    expect(eta.state).toBe('ok');
    // Origin is the driver, then the stops in order.
    expect(valhalla.route.mock.calls[0][0].locations).toEqual([
      { lat: 41.29, lon: 69.2 },
      { lat: 41.2856, lon: 69.2034 },
      { lat: 41.3111, lon: 69.2797 },
    ]);
    expect(eta.next_stop).toEqual({
      kind: 'pickup',
      order_id: 'o1',
      pickup_source_id: 'ps1',
      name: 'Sklad',
      distance_km: 6.2,
      eta_seconds: 840,
    });
    // `delivery` is to *this* order's own client; `trip_total` is the whole run.
    // For a single order they agree.
    expect(eta.delivery).toEqual({ distance_km: 15.3, eta_seconds: 2100 });
    expect(eta.trip_total).toEqual({ distance_km: 15.3, eta_seconds: 2100 });
    expect(eta.legs.map((l) => l.kind)).toEqual(['pickup', 'client']);
  });

  it('flags a position older than 3 minutes as stale but still computes', async () => {
    const { svc } = make({ driver: { locationLat: 41.29, locationLng: 69.2, locationUpdatedAt: new Date(Date.now() - 10 * 60_000) } });
    const eta = await svc.forOrder('o1', actor);
    expect(eta.state).toBe('stale');
    expect(eta.driver_position?.age_seconds).toBeGreaterThanOrEqual(600);
    // The number is still there — last known position beats nothing.
    expect(eta.next_stop?.eta_seconds).toBe(840);
  });

  it('at the customer returns zeros rather than calling the router', async () => {
    const { svc, valhalla } = make({ order: order({ status: 'arrived_at_customer' }) });
    const eta = await svc.forOrder('o1', actor);
    expect(eta.state).toBe('ok');
    expect(eta.next_stop).toMatchObject({ kind: 'client', eta_seconds: 0 });
    expect(valhalla.route).not.toHaveBeenCalled();
  });

  it('is unavailable with a distinct reason for each missing input', async () => {
    const noDriver = await make({ order: order({ assigned_driver_id: null }) }).svc.forOrder('o1', actor);
    expect(noDriver).toMatchObject({ state: 'unavailable', reason: 'no_driver', next_stop: null });

    const noPosition = await make({ driver: { locationLat: null, locationLng: null, locationUpdatedAt: null } }).svc.forOrder('o1', actor);
    expect(noPosition).toMatchObject({ state: 'unavailable', reason: 'no_driver_position' });

    const noPins = await make({ order: order({ delivery_lat: null, delivery_lng: null }) }).svc.forOrder('o1', actor);
    expect(noPins).toMatchObject({ state: 'unavailable', reason: 'missing_coordinates' });
  });

  it('survives Valhalla being down: unavailable, never a 5xx from the order page', async () => {
    const { svc } = make({ fail: new ServiceUnavailableException('routing_service_unavailable') });
    const eta = await svc.forOrder('o1', actor);
    expect(eta).toMatchObject({ state: 'unavailable', reason: 'routing_unavailable' });
    // The position is still reported so the UI can at least say "last seen".
    expect(eta.driver_position).not.toBeNull();
  });

  it('rejects a route whose leg count does not match the stops asked for', async () => {
    const { svc } = make({ legs: [leg(6.2, 840)] }); // two stops requested, one leg back
    const eta = await svc.forOrder('o1', actor);
    expect(eta).toMatchObject({ state: 'unavailable', reason: 'routing_unavailable' });
  });

  it('caches by inputs: same order+status+stops+position → one Valhalla call', async () => {
    const { svc, valhalla } = make();
    await svc.forOrder('o1', actor);
    await svc.forOrder('o1', actor);
    expect(valhalla.route).toHaveBeenCalledTimes(1);
  });

  it('a newer driver position is a different input and is not served from cache', async () => {
    const { svc, prisma, valhalla } = make();
    await svc.forOrder('o1', actor);
    prisma.driver.findUnique.mockResolvedValue({ locationLat: 41.3, locationLng: 69.21, locationUpdatedAt: new Date() });
    await svc.forOrder('o1', actor);
    expect(valhalla.route).toHaveBeenCalledTimes(2);
  });

  it('always runs the access check before touching the cache', async () => {
    const { svc, orders } = make();
    await svc.forOrder('o1', actor);
    await svc.forOrder('o1', actor);
    expect(orders.findOneForActor).toHaveBeenCalledTimes(2);
  });
});

describe('EtaService — a co-loaded trip', () => {
  /** Host #1: pickup at trip 0, client at trip 2. Co-load #2: 1 and 3. */
  const host = order({
    id: 'o1',
    delivery_trip_position: 2,
    pickup_sources: [source({ id: 'ps1', name: 'Sklad A', trip_position: 0 })],
  });
  const coload = order({
    id: 'o2',
    client_name: 'Dilnoza',
    delivery_lat: 41.32,
    delivery_lng: 69.29,
    delivery_trip_position: 3,
    pickup_sources: [source({ id: 'ps2', name: 'Bozor Q', lat: 41.29, lng: 69.21, trip_position: 1 })],
  });

  function tripService(legs: ReturnType<typeof leg>[]) {
    const m = make({ order: host, legs });
    m.orders.findAllForActor = jest.fn().mockResolvedValue([host, coload]);
    return m;
  }

  it('routes the merged trip, so the next stop is whichever the driver reaches first', async () => {
    const { svc, valhalla } = tripService([leg(3, 300), leg(2, 200), leg(5, 500), leg(4, 400)]);
    const eta = await svc.forOrder('o1', actor);

    // Four stops in trip order, not just this order's two.
    expect(eta.legs.map((l) => l.name)).toEqual(['Sklad A', 'Bozor Q', 'Barakat', 'Dilnoza']);
    expect(eta.legs.map((l) => l.order_id)).toEqual(['o1', 'o2', 'o1', 'o2']);
    expect(valhalla.route.mock.calls[0][0].locations).toHaveLength(5); // driver + 4 stops
  });

  it('reports this order\'s own client for delivery, and the whole run for the total', async () => {
    const { svc } = tripService([leg(3, 300), leg(2, 200), leg(5, 500), leg(4, 400)]);
    const eta = await svc.forOrder('o1', actor);

    // The seller of #1 asks "when does MY client get it": stops 1..3 of 4.
    expect(eta.delivery).toEqual({ distance_km: 10, eta_seconds: 1000 });
    // The driver asks "when am I done": all four.
    expect(eta.trip_total).toEqual({ distance_km: 14, eta_seconds: 1400 });
  });

  it('falls back to its own stops when the sibling has no trip position after all', async () => {
    const loose = order({ id: 'o2', delivery_trip_position: null });
    const m = make({ order: host, legs: [leg(3, 300), leg(5, 500)] });
    m.orders.findAllForActor = jest.fn().mockResolvedValue([host, loose]);
    const eta = await m.svc.forOrder('o1', actor);
    expect(eta.legs.map((l) => l.order_id)).toEqual(['o1', 'o1']);
  });

  it('refuses rather than quietly shortening the run when a sibling is unpinned', async () => {
    const unpinned = order({ id: 'o2', delivery_lat: null, delivery_lng: null, delivery_trip_position: 3 });
    const m = make({ order: host, legs: [leg(3, 300)] });
    m.orders.findAllForActor = jest.fn().mockResolvedValue([host, unpinned]);
    const eta = await m.svc.forOrder('o1', actor);
    // Dropping the sibling would understate the driver's remaining work.
    expect(eta).toMatchObject({ state: 'unavailable', reason: 'missing_coordinates' });
  });
});

describe('EtaService.driverTrip — a lorry pressed on the office map', () => {
  function makeTrip(role: 'admin' | 'seller', active: OrderPublic[], speedFactor = 1) {
    const prisma = { driver: { findUnique: jest.fn().mockResolvedValue({ locationLat: 41.29, locationLng: 69.2 }) } };
    const orders = { findAllForActor: jest.fn().mockResolvedValue(active) };
    const valhalla = {
      route: jest.fn().mockResolvedValue({
        summary: { length_km: 15.3, time_seconds: 2100 },
        legs: [
          { summary: { length_km: 6.24, time_seconds: 840 }, shape: '' },
          { summary: { length_km: 9.06, time_seconds: 1260 }, shape: '' },
        ],
      }),
    };
    const photon = {
      reverse: jest.fn().mockResolvedValue([
        { street: "Amir Temur ko'chasi", name: null, district: 'Yunusobod tumani', county: null, state: 'Toshkent', city: 'Toshkent' },
      ]),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new EtaService(prisma as any, orders as any, valhalla as any, photon as any, { factor: () => speedFactor } as any);
    return { run: () => svc.driverTrip('d1', { userId: 'u1', role }), valhalla };
  }

  it('says where he is and the road through every stop ahead, named for the office', async () => {
    const res = await makeTrip('admin', [order()]).run();
    expect(res.here).toBe("Amir Temur ko'chasi, Yunusobod tumani, Toshkent");
    expect(res.trip).toMatchObject({ next_kind: 'pickup', next_name: 'Sklad', next_km: 6.2, next_seconds: 840, total_km: 15.3, stops: 2 });
    // Each stop with its own leg: to the pickup from where he is, then on to the client.
    expect(res.trip?.legs).toEqual([
      { kind: 'pickup', name: 'Sklad', km: 6.2, seconds: 840, lat: 41.2856, lng: 69.2034 },
      { kind: 'client', name: 'Barakat', km: 9.1, seconds: 1260, lat: 41.3111, lng: 69.2797 },
    ]);
  });

  it('stretches the minutes by the real speed, and leaves the km alone', async () => {
    const res = await makeTrip('admin', [order()], 2).run();
    expect(res.trip).toMatchObject({ next_km: 6.2, next_seconds: 1680, total_km: 15.3, total_seconds: 4200 });
  });

  it('draws the road for a booking the driver has not accepted yet', async () => {
    const res = await makeTrip('admin', [order({ status: 'assigned_to_driver' })]).run();
    expect(res.trip).toMatchObject({ next_kind: 'pickup', next_name: 'Sklad', stops: 2 });
  });

  it("shows a seller his own order's road", async () => {
    const res = await makeTrip('seller', [order({ created_by_seller_id: 'u1' })]).run();
    expect(res.trip).toMatchObject({ next_name: 'Sklad', stops: 2, total_km: 15.3 });
  });

  it("shows a seller no road, and no name, for another seller's order", async () => {
    const res = await makeTrip('seller', [order({ created_by_seller_id: 'someone-else' })]).run();
    expect(res.trip).toBeNull();
    expect(res.busy_elsewhere).toBe(true);
  });

  it('on a returning order, draws the road to where the goods go back', async () => {
    const returning = order({
      status: 'returning',
      pickup_sources: [
        source({
          return_required: true,
          return_place: { name: 'BIGANT sklad', address: null, lat: 41.33, lng: 69.25 },
        }),
      ],
    });
    const t = makeTrip('admin', [returning]);
    t.valhalla.route.mockResolvedValueOnce({
      summary: { length_km: 4.2, time_seconds: 600 },
      legs: [{ summary: { length_km: 4.2, time_seconds: 600 }, shape: '' }],
    });
    const res = await t.run();
    expect(res.trip?.legs[0]).toMatchObject({ kind: 'return', name: 'BIGANT sklad', lat: 41.33, lng: 69.25 });
    expect(t.valhalla.route.mock.calls[0][0]).toMatchObject({ shortest: true });
  });

  it('has no road to draw when he has no work', async () => {
    const t = makeTrip('admin', []);
    const res = await t.run();
    expect(res.trip).toBeNull();
    expect(res.here).not.toBeNull();
    expect(t.valhalla.route).not.toHaveBeenCalled();
  });
});
