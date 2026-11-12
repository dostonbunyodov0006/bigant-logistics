import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ACTIVE_ORDER_STATUSES,
  ETA_STALE_AFTER_SECONDS,
  type DriverMapTrip,
  type GeocodingResult,
  type EtaLeg,
  type EtaUnavailableReason,
  type OrderEta,
  type OrderPublic,
  type Role,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Reads across the driver's whole trip, past the caller's own visibility. */
const SYSTEM_ACTOR = { userId: '', role: 'admin' as const };
import { OrdersService } from '../orders/orders.service';
import { ValhallaService } from '../routing/valhalla.service';
import { PhotonService } from '../geo/photon.service';
import { SpeedStatsService } from '../geo/speed-stats.service';
import { decodePolyline6 } from '../geo/tashkent-city';

type Actor = { userId: string; role: Role };

/** A stop the driver still has to reach, with the coordinates to route to. */
type Stop = {
  kind: 'pickup' | 'client';
  /** Which order the stop belongs to — on a co-load the next stop may not be
   *  the order that was asked about. */
  orderId: string;
  id: string | null;
  name: string;
  lat: number;
  lng: number;
};

/**
 * Results are keyed by everything that goes into them, so a hit is an identical
 * computation, not a possibly-outdated one. The TTL only bounds memory. Fine
 * for a single instance, which this backend is by design (see realtime).
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 2_000;

@Injectable()
export class EtaService {
  private readonly logger = new Logger(EtaService.name);
  private readonly cache = new Map<string, { value: OrderEta; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly valhalla: ValhallaService,
    private readonly photon: PhotonService,
    private readonly speed: SpeedStatsService,
  ) {}

  async forOrder(orderId: string, actor: Actor): Promise<OrderEta> {
    // Access is enforced here on every call — the cache below is never consulted
    // before it, so a cached ETA cannot leak an order the caller may not see.
    const order = await this.orders.findOneForActor(orderId, actor);
    const now = new Date();

    // On a co-load the driver drives one merged route across two orders, so the
    // ETA has to follow that route — otherwise it would name a next stop the
    // driver is not going to, while the trip strip beside it says otherwise.
    const stops = await this.tripStops(order);
    if ('reason' in stops) return this.unavailable(order.id, now, stops.reason);

    if (!order.assigned_driver_id) return this.unavailable(order.id, now, 'no_driver');
    const driver = await this.prisma.driver.findUnique({
      where: { id: order.assigned_driver_id },
      select: { locationLat: true, locationLng: true, locationUpdatedAt: true },
    });
    if (!driver?.locationLat || !driver.locationLng || !driver.locationUpdatedAt) {
      return this.unavailable(order.id, now, 'no_driver_position');
    }

    const ageSeconds = Math.max(0, Math.floor((now.getTime() - driver.locationUpdatedAt.getTime()) / 1000));
    const position = {
      lat: driver.locationLat,
      lng: driver.locationLng,
      updated_at: driver.locationUpdatedAt.toISOString(),
      age_seconds: ageSeconds,
    };
    const state = ageSeconds > ETA_STALE_AFTER_SECONDS ? 'stale' : 'ok';

    // Already at the customer: nothing left to drive.
    if (stops.length === 0) {
      return {
        order_id: order.id,
        state,
        reason: null,
        computed_at: now.toISOString(),
        driver_position: position,
        next_stop: {
          kind: 'client',
          order_id: order.id,
          pickup_source_id: null,
          name: order.client_name,
          distance_km: 0,
          eta_seconds: 0,
        },
        delivery: { distance_km: 0, eta_seconds: 0 },
        trip_total: { distance_km: 0, eta_seconds: 0 },
        legs: [],
      };
    }

    const key = [
      order.id,
      order.status,
      stops.map((s) => s.id ?? 'client').join(','),
      driver.locationUpdatedAt.getTime(),
    ].join('|');
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now.getTime()) {
      // Re-stamp: the numbers are identical, but the age keeps advancing.
      return { ...hit.value, state, driver_position: position, computed_at: now.toISOString() };
    }

    let legs: EtaLeg[];
    let total: { distance_km: number; eta_seconds: number };
    try {
      const route = await this.valhalla.route({
        locations: [{ lat: position.lat, lon: position.lng }, ...stops.map((s) => ({ lat: s.lat, lon: s.lng }))],
        costing: 'auto',
        language: 'ru-RU',
        // The same road the map draws (the shortest), so the minutes on the
        // order and on the map are one number (owner, 30.10.2026).
        shortest: true,
      });
      if (route.legs.length !== stops.length) {
        // A leg per stop is the contract; anything else means the route did
        // not visit what we asked for, and a partial ETA would mislead.
        this.logger.warn(`Valhalla returned ${route.legs.length} legs for ${stops.length} stops (order ${order.id})`);
        return this.unavailable(order.id, now, 'routing_unavailable', position);
      }
      // Our lorries' real speed at this hour, once enough of it is known.
      const factor = this.speed.factor(
        [position, ...stops],
        route.summary.length_km,
        route.summary.time_seconds,
        now,
      );
      legs = route.legs.map((leg, i) => ({
        kind: stops[i].kind,
        order_id: stops[i].orderId,
        pickup_source_id: stops[i].id,
        name: stops[i].name,
        distance_km: leg.summary.length_km,
        eta_seconds: Math.round(leg.summary.time_seconds * factor),
      }));
      total = { distance_km: route.summary.length_km, eta_seconds: Math.round(route.summary.time_seconds * factor) };
    } catch (err) {
      // Valhalla down, timed out, or rejected the request: the order page must
      // still load. Log once at warn; the UI shows "ETA unavailable".
      const msg = err instanceof HttpException ? err.message : (err as Error)?.message;
      this.logger.warn(`ETA routing failed for order ${order.id}: ${msg}`);
      return this.unavailable(order.id, now, 'routing_unavailable', position);
    }

    // "delivery" keeps meaning this order's own client, which on a co-load sits
    // partway along the merged route; the seller's "delivers in ~35 min" must
    // not silently become the other order's客 stop.
    const mine = legs.findIndex((l) => l.kind === 'client' && l.order_id === order.id);
    const upTo = (n: number) =>
      legs.slice(0, n + 1).reduce(
        (acc, l) => ({
          distance_km: round(acc.distance_km + l.distance_km, 3),
          eta_seconds: Math.round(acc.eta_seconds + l.eta_seconds),
        }),
        { distance_km: 0, eta_seconds: 0 },
      );

    const value: OrderEta = {
      order_id: order.id,
      state,
      reason: null,
      computed_at: now.toISOString(),
      driver_position: position,
      next_stop: legs[0],
      delivery: mine === -1 ? null : upTo(mine),
      trip_total: total,
      legs,
    };
    this.remember(key, value, now.getTime());
    return value;
  }

  /**
   * The stops the driver will actually drive next, in driving order.
   *
   * An ordinary order contributes only its own. A co-load merges every order on
   * the trip and orders them by trip position — the same sequence the driver's
   * buttons follow, so the ETA can never name a next stop the trip strip
   * disagrees with.
   */
  private async tripStops(order: OrderPublic): Promise<Stop[] | { reason: EtaUnavailableReason }> {
    const own = remainingStops(order);
    if ('reason' in own) return own;

    const inTrip =
      order.delivery_trip_position != null ||
      order.pickup_sources.some((s) => s.trip_position != null);
    if (!inTrip || !order.assigned_driver_id) return own;

    const siblings = await this.orders.findAllForActor(
      { userId: SYSTEM_ACTOR.userId, role: SYSTEM_ACTOR.role },
      { driver_id: order.assigned_driver_id, statuses: [...ACTIVE_ORDER_STATUSES] },
    );

    const merged: { at: number; stop: Stop }[] = [];
    for (const sibling of siblings) {
      // A vozvrat carrying its goods back with this po puti (owner, 11.11.2026):
      // its stop on the trip is the return place, pinned by the trip position.
      const stops: Stop[] | { reason: EtaUnavailableReason } =
        sibling.id !== order.id && sibling.kind === 'vozvrat' && sibling.status === 'returning'
          ? sibling.pickup_sources
              .filter((p) => p.trip_position != null && !p.returned_at && p.lat != null && p.lng != null)
              .map((p) => ({ kind: 'pickup' as const, orderId: sibling.id, id: p.id, name: p.name, lat: p.lat!, lng: p.lng! }))
          : remainingStops(sibling);
      // A sibling that cannot be routed (no pins yet) must not silently drop out
      // of the sequence — the remaining numbers would understate the run.
      if ('reason' in stops) {
        return sibling.id === order.id ? stops : { reason: 'missing_coordinates' };
      }
      for (const stop of stops) {
        const at =
          stop.kind === 'client'
            ? sibling.delivery_trip_position
            : (sibling.pickup_sources.find((p) => p.id === stop.id)?.trip_position ?? null);
        // No trip position means this order is not part of the co-load after
        // all; fall back to its own sequence rather than guessing an order.
        if (at == null) return own;
        merged.push({ at, stop });
      }
    }
    merged.sort((a, b) => a.at - b.at);
    return merged.map((m) => m.stop);
  }

  /**
   * A lorry pressed on the office map: where it is now in words, and the road
   * from there through every stop its driver still has to reach. Built from
   * the same stop sequence as the order ETA, so map and order page agree.
   */
  async driverTrip(driverId: string, actor: Actor): Promise<DriverMapTrip> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { locationLat: true, locationLng: true },
    });
    if (!driver) throw new NotFoundException('driver_not_found');
    if (driver.locationLat == null || driver.locationLng == null) return { here: null, trip: null };
    const pos = { lat: driver.locationLat, lng: driver.locationLng };

    const here = await this.photon
      .reverse({ lat: pos.lat, lon: pos.lng, limit: 1, lang: 'uz' })
      .then(([r]) => (r ? placeLine(r) : null))
      .catch(() => null);

    const active = await this.orders.findAllForActor(
      { userId: SYSTEM_ACTOR.userId, role: SYSTEM_ACTOR.role },
      { driver_id: driverId, statuses: [...ACTIVE_ORDER_STATUSES] },
    );
    // The order he is furthest into leads; tripStops merges a co-load behind it.
    const lead = [...active].sort((a, b) => stage(b.status) - stage(a.status))[0];
    if (!lead) return { here, trip: null };

    let stops: MapStop[];
    if (lead.status === 'returning') {
      // Bringing goods back: the road to where each return goes.
      stops = returnStops(lead);
    } else {
      // A seller's booking waits for the driver to accept it, but the road is
      // already his: show it from the first pickup, as once he has accepted.
      const ahead = await this.tripStops(
        lead.status === 'assigned_to_driver' ? { ...lead, status: 'driver_accepted' } : lead,
      );
      if ('reason' in ahead) return { here, trip: null };
      stops = ahead;
    }
    if (stops.length === 0) return { here, trip: null };

    // The office sees the whole run. A seller sees only his own orders' stops
    // and the road up to his last one — never where another seller's client
    // lives (owner, 30.10.2026). His minutes still count the stops before his.
    const staff = actor.role === 'admin' || actor.role === 'manager';
    const sellerOf = new Map(active.map((o) => [o.id, o.created_by_seller_id]));
    const shown = stops.map((s) => staff || sellerOf.get(s.orderId) === actor.userId);
    const last = shown.lastIndexOf(true);
    if (last === -1) return { here, busy_elsewhere: true, trip: null };

    try {
      const route = await this.valhalla.route({
        locations: [{ lat: pos.lat, lon: pos.lng }, ...stops.map((s) => ({ lat: s.lat, lon: s.lng }))],
        costing: 'auto',
        language: 'ru-RU',
        // The nearest road, the one the map draws and the order ETA uses.
        shortest: true,
      });
      if (route.legs.length !== stops.length) return { here, trip: null };
      const factor = this.speed.factor([pos, ...stops], route.summary.length_km, route.summary.time_seconds);
      const legs: NonNullable<DriverMapTrip['trip']>['legs'] = [];
      let km = 0;
      let sec = 0;
      route.legs.forEach((leg, i) => {
        km += leg.summary.length_km;
        sec += leg.summary.time_seconds * factor;
        if (!shown[i]) return;
        // From the last stop he may see (or from the lorry) to this one.
        legs.push({
          kind: stops[i]!.kind,
          name: stops[i]!.name,
          km: round(km, 1),
          seconds: Math.round(sec),
          lat: stops[i]!.lat,
          lng: stops[i]!.lng,
        });
        km = 0;
        sec = 0;
      });
      const upTo = route.legs.slice(0, last + 1);
      const first = legs[0]!;
      return {
        here,
        trip: {
          next_kind: first.kind,
          next_name: first.name,
          next_km: first.km,
          next_seconds: first.seconds,
          total_km: round(upTo.reduce((a, l) => a + l.summary.length_km, 0), 1),
          total_seconds: Math.round(upTo.reduce((a, l) => a + l.summary.time_seconds, 0) * factor),
          stops: legs.length,
          legs,
          coordinates: upTo.flatMap((leg) => decodePolyline6(leg.shape).map((p) => [p.lon, p.lat] as [number, number])),
        },
      };
    } catch (err) {
      this.logger.warn(`map trip routing failed for driver ${driverId}: ${(err as Error)?.message}`);
      return { here, trip: null };
    }
  }

  private unavailable(
    orderId: string,
    now: Date,
    reason: EtaUnavailableReason,
    position: OrderEta['driver_position'] = null,
  ): OrderEta {
    return {
      order_id: orderId,
      state: 'unavailable',
      reason,
      computed_at: now.toISOString(),
      driver_position: position,
      next_stop: null,
      delivery: null,
      trip_total: null,
      legs: [],
    };
  }

  private remember(key: string, value: OrderEta, nowMs: number): void {
    if (this.cache.size >= CACHE_MAX) {
      // Cheap eviction: drop expired entries, then the oldest insertions.
      for (const [k, v] of this.cache) if (v.expiresAt <= nowMs) this.cache.delete(k);
      while (this.cache.size >= CACHE_MAX) {
        const first = this.cache.keys().next().value;
        if (first === undefined) break;
        this.cache.delete(first);
      }
    }
    this.cache.set(key, { value, expiresAt: nowMs + CACHE_TTL_MS });
  }
}

/**
 * The remaining stops the driver will actually drive, in driving order.
 *
 * For an ordinary order that is just its own stops. For a co-load the stops of
 * every order on the trip are merged and ordered by their trip position — the
 * same sequence the driver's buttons follow, so the ETA and the trip strip can
 * never name different next stops.
 */


/**
 * What the driver still has to reach, in driving order, derived the same way
 * computeNextAction() derives the next button: from status plus per-stop
 * leg_status. Exported for tests.
 */
export function remainingStops(order: OrderPublic): Stop[] | { reason: EtaUnavailableReason } {
  const client = (): Stop | { reason: EtaUnavailableReason } =>
    order.delivery_lat != null && order.delivery_lng != null
      ? {
          kind: 'client',
          orderId: order.id,
          id: null,
          name: order.client_name,
          lat: order.delivery_lat,
          lng: order.delivery_lng,
        }
      : { reason: 'missing_coordinates' };

  switch (order.status) {
    case 'driver_accepted':
    case 'collecting_items': {
      const pending = [...order.pickup_sources]
        .sort((a, b) => a.position - b.position)
        .filter((s) => s.leg_status !== 'arrived');
      const stops: Stop[] = [];
      for (const s of pending) {
        if (s.lat == null || s.lng == null) return { reason: 'missing_coordinates' };
        stops.push({ kind: 'pickup', orderId: order.id, id: s.id, name: s.name, lat: s.lat, lng: s.lng });
      }
      const c = client();
      if ('reason' in c) return c;
      return [...stops, c];
    }
    case 'items_collected':
    case 'on_the_way': {
      const c = client();
      return 'reason' in c ? c : [c];
    }
    case 'arrived_at_customer':
      return [];
    case 'returning':
      // Return destinations are warehouse/store/supplier — categories, not
      // places with coordinates. Nothing to route to until that changes.
      return { reason: 'returns_not_routable' };
    default:
      return { reason: 'order_not_active' };
  }
}

/** A stop on the office map's road: an order stop, or where a return goes. */
type MapStop = Omit<Stop, 'kind'> & { kind: Stop['kind'] | 'return' };

/**
 * Where the goods of a returning order go, in stop order: each stop still to
 * be brought back, to its return place (BIGANT sklad / do'kon), or to the stop
 * itself for a supplier — as the driver's app navigates. Exported for tests.
 */
export function returnStops(order: OrderPublic): MapStop[] {
  const out: MapStop[] = [];
  for (const s of [...order.pickup_sources].sort((a, b) => a.position - b.position)) {
    if (!s.return_required || s.returned_at) continue;
    const place = s.return_place;
    const lat = place?.lat ?? s.lat;
    const lng = place?.lng ?? s.lng;
    if (lat == null || lng == null) continue;
    out.push({ kind: 'return', orderId: order.id, id: s.id, name: place?.name ?? s.name, lat, lng });
  }
  return out;
}

/** How far into its work an order is, for picking the one a driver is on. */
function stage(status: string): number {
  const order = ['assigned_to_driver', 'driver_accepted', 'collecting_items', 'items_collected', 'on_the_way', 'arrived_at_customer', 'returning'];
  return order.indexOf(status);
}

/** "Street, district, region" from what the address service knows of a point. */
export function placeLine(r: GeocodingResult): string | null {
  const parts = [r.street ?? r.name, r.district ?? r.county, r.state ?? r.city];
  const seen = new Set<string>();
  const out = parts.filter((p): p is string => !!p && !seen.has(p) && !!seen.add(p));
  return out.length ? out.join(', ') : null;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
