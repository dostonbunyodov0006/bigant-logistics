import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_ORDER_STATUSES,
  POPUTI_FENCE_RADIUS_M,
  POPUTI_FIRST_CLIENT_WITHIN_MIN,
  POPUTI_MAX_DETOUR_MIN,
  POPUTI_MAX_PER_SELLER,
  poputiDwellSeconds,
  POPUTI_TRAFFIC_FACTOR,
  POPUTI_NEAR_MISS_REASONS,
  type PoputiFit,
  type PoputiProbe,
  type PoputiRejection,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ValhallaService } from '../routing/valhalla.service';
import {
  afterCollectionSequence,
  assignToFences,
  liveFences,
  mergedSequence,
  metresBetween,
  type FenceRejection,
  type GeoPoint,
  type SequencedStop,
  type TripStop,
} from './poputi.geometry';

/** Statuses in which the running order still has driving left to share. */
const RUNNING = ['driver_accepted', 'collecting_items', 'items_collected', 'on_the_way'] as const;

/** Valhalla gets two route calls per survivor; this keeps a fleet-wide search
 *  from opening a hundred sockets at once. */
const ROUTING_CONCURRENCY = 4;
/** Beyond a handful, a near-miss list is noise rather than help. */
const NEAR_MISS_LIMIT = 5;
const NEAR_MISS = new Set<PoputiRejection>(POPUTI_NEAR_MISS_REASONS);

type VehicleRow = { id: string; model: string; plateNumber: string; capacityKg: number | null; lengthCm?: number | null };
type DriverRow = {
  id: string;
  currentStatus: string;
  locationLat: number | null;
  locationLng: number | null;
  locationUpdatedAt?: Date | null;
};

/**
 * A driver's position counts for "on his way" only while it is this fresh.
 * 6 since 11.11.2026 (owner; was 10): the phone in his pocket reports every
 * five minutes, so one missed report is the most that is let through.
 */
export const FRESH_POSITION_MIN = 6;
type OrderRow = Parameters<typeof remainingStopsOf>[0] & {
  id: string;
  kind?: string;
  poputiAllowed: boolean;
  isBackhaul: boolean;
  weightKg: number | null;
  deliveryDatetime: Date;
  deliveryTripPosition: number | null;
  geoDistrict?: { name: string } | null;
  poputiMaxDelayMin?: number | null;
  createdBySellerId?: string;
};

/** Part of a merged po puti trip already: trip positions are written only then. */
function inTrip(o: { deliveryTripPosition: number | null; pickupSources: readonly unknown[] }): boolean {
  return (
    o.deliveryTripPosition != null ||
    (o.pickupSources as { tripPosition?: number | null }[]).some((src) => src.tripPosition != null)
  );
}

/** What the search needs to describe a truck in its results. */
export interface Candidate {
  vehicle: VehicleRow & { category: string | null };
  driverName: string | null;
  /** Where the truck is already going, so the seller can see it is their way. */
  headingTo: string | null;
  /** When the order it would ride with is due — a later day means the co-load goes then too. */
  hostDeliveryAt: Date | null;
}

/** One order on the truck the cargo cleared the fences of, with everything stage 2 needs. */
export interface Staged {
  host: {
    id: string;
    deliveryDatetime: Date;
    geoDistrict?: { name: string } | null;
    poputiMaxDelayMin?: number | null;
    journeyStartedAt?: Date | null;
  };
  /** Its place in the truck's queue: 1 = the order the driver is on now. */
  reys: number;
  /** Where the driver is now, and the stops he still owes on the orders ahead
   *  of this one — what the pickup time estimate drives through first. */
  from: GeoPoint | null;
  before: TripStop[];
  driver: GeoPoint | null;
  fences: TripStop[];
  /** The host order's own stops, without any po puti already aboard: what the
   *  detour and the first client's delay are measured against. Defaults to fences. */
  base?: TripStop[];
  sequence: SequencedStop[];
}

/**
 * The stops still ahead on a merged trip — the host's and the po puti's
 * already aboard — in trip order, each knowing its order (owner, 11.11.2026).
 */
function openTripStops(orders: OrderRow[]): TripStop[] {
  const stops: (TripStop & { pos: number })[] = [];
  for (const o of orders) {
    for (const s of o.pickupSources) {
      if (s.tripPosition != null && s.legStatus !== 'arrived' && s.lat != null && s.lng != null) {
        stops.push({ kind: 'pickup', id: s.id, name: s.name, lat: s.lat, lng: s.lng, orderId: o.id, pos: s.tripPosition });
      }
    }
    if (o.deliveryTripPosition != null && o.deliveryLat != null && o.deliveryLng != null) {
      stops.push({ kind: 'client', id: null, name: o.clientName, lat: o.deliveryLat, lng: o.deliveryLng, orderId: o.id, pos: o.deliveryTripPosition });
    }
  }
  return stops.sort((a, b) => a.pos - b.pos).map(({ pos: _pos, ...s }) => s);
}


/**
 * Every rule that needs no network: the vehicle gates, cumulative weight, and
 * the fences. Shared by the single-vehicle check and the fleet-wide search so
 * the two can never disagree about what a co-load is.
 */
/**
 * A vozvrat carrying the client's goods back (owner, 11.11.2026): its stops
 * left are the return places not yet handed over, each a drop-off — the
 * goods' "client". Null when none can be routed.
 */
function returnStopsOf(order: OrderRow & { pickupSources: { returnedAt?: Date | null; returnRequired?: boolean }[] }): TripStop[] | null {
  const stops: TripStop[] = [];
  for (const s of [...order.pickupSources].sort((a, b) => a.position - b.position)) {
    if (s.returnedAt || s.returnRequired === false) continue;
    if (s.lat == null || s.lng == null) return null;
    stops.push({ kind: 'client', id: s.id, name: s.name, lat: s.lat, lng: s.lng, orderId: order.id });
  }
  return stops.length > 0 ? stops : null;
}

function stageOne(
  input: { vehicle: VehicleRow; driver: DriverRow; running: OrderRow[]; returning?: OrderRow[] },
  probe: PoputiProbe,
  onlyHost: string | null = null,
  now: Date = new Date(),
  sellerId: string | null = null,
): Staged[] | { rejection: FenceRejection } {
  const { vehicle, driver, running } = input;
  const returning = input.returning ?? [];
  // A driver not on shift yet still has his booked order — the co-load waits
  // for him with it (owner, 29.10.2026).
  if (running.length === 0 && returning.length === 0) return { rejection: { reason: 'no_active_order' } };
  // The longest piece must fit the body (owner, 10.11.2026: pipes, rebar, profiles).
  if (probe.length_cm != null && vehicle.lengthCm != null && probe.length_cm > vehicle.lengthCm) {
    return { rejection: { reason: 'too_long' } };
  }
  // One po puti on a truck at a time (owner, 10.11.2026) — except that the
  // seller already riding it may add a second client (owner, 11.11.2026, up to
  // POPUTI_MAX_PER_SELLER). The new stops are then fitted into the whole merged
  // trip, and the limits are measured against the host's order alone.
  // A vozvrat on its way back that already carries a po puti: no second one.
  if (returning.some(inTrip)) return { rejection: { reason: 'poputi_taken' } };
  const merged = running.filter(inTrip);
  let trip: { host: OrderRow; stops: TripStop[]; aboardKg: number } | null = null;
  if (merged.length > 0) {
    const coloads = merged.filter((o) => o.isBackhaul);
    const tripHost = merged.find((o) => !o.isBackhaul);
    const sameSeller =
      !!sellerId &&
      coloads.length > 0 &&
      coloads.length < POPUTI_MAX_PER_SELLER &&
      coloads.every((o) => o.createdBySellerId === sellerId);
    if (!tripHost || !sameSeller || (onlyHost && onlyHost !== tripHost.id)) return { rejection: { reason: 'poputi_taken' } };
    trip = { host: tripHost, stops: openTripStops(merged), aboardKg: coloads.reduce((a, o) => a + (o.weightKg ?? 0), 0) };
  }

  const at =
    driver.locationLat != null && driver.locationLng != null
      ? { lat: driver.locationLat, lng: driver.locationLng }
      : null;
  const pickups: GeoPoint[] = probe.pickups.map((p) => ({ lat: p.lat, lng: p.lng }));
  const delivery: GeoPoint = { lat: probe.delivery.lat, lng: probe.delivery.lng };
  // Where he is counts only while the phone has said so lately (on shift, GPS on).
  const freshAt =
    at && driver.locationUpdatedAt && now.getTime() - driver.locationUpdatedAt.getTime() <= FRESH_POSITION_MIN * 60_000
      ? at
      : null;

  // A vozvrat carrying its goods back to the warehouse, the shop or the
  // supplier (owner, 11.11.2026): the truck is on the road anyway. A pickup
  // near where the driver is is collected first; one near the return place
  // right after handing over there; the new client must be near the return
  // place and is visited after it. The return place counts as "the first
  // client" for the 35 minutes. No seller's consent is asked — the return is
  // the shop's own trip.
  const vozvratStaged: Staged[] = [];
  if (!trip && returning.length > 0 && (!onlyHost || returning.some((o) => o.id === onlyHost))) {
    const host = onlyHost ? returning.find((o) => o.id === onlyHost)! : returning[0]!;
    const drops = returnStopsOf(host as never);
    const over = vehicle.capacityKg != null && probe.weight_kg != null ? (host.weightKg ?? 0) + probe.weight_kg - vehicle.capacityKg : 0;
    if (drops && over <= 0) {
      const names = { pickups: probe.pickups.map((_, k) => `pickup ${k + 1}`), delivery: 'delivery' };
      const pickupsV: GeoPoint[] = probe.pickups.map((p) => ({ lat: p.lat, lng: p.lng }));
      const seq = afterCollectionSequence(drops, at, pickupsV, { lat: probe.delivery.lat, lng: probe.delivery.lng }, names);
      if (!('reason' in seq)) vozvratStaged.push({ host, reys: 1, driver: at, from: at, before: [], fences: drops, base: drops, sequence: seq });
    }
    if (onlyHost) return vozvratStaged.length > 0 ? vozvratStaged : { rejection: { reason: drops ? (over > 0 ? 'capacity_exceeded' : 'pickup_outside_fences') : 'missing_coordinates' } };
  }

  // Every order on the truck is a trip of its own — 1x, 2x, 3x, Polniy, bron,
  // today's or tomorrow's (owner, 10.11.2026); the driver runs them one after
  // another. The cargo is tried against each, in queue order.
  const staged: Staged[] = [];
  let gate: FenceRejection | null = null;
  let cargo: FenceRejection | null = null;
  // The stops of the orders ahead, which the driver finishes first.
  const ahead: TripStop[] = [];
  running.forEach((host, i) => {
    const owedBefore = [...ahead];
    const own = remainingStopsOf(host);
    if (!('reason' in own)) ahead.push(...(i === 0 ? liveFences(own.stops, at, POPUTI_FENCE_RADIUS_M) : own.stops));
    if (onlyHost && host.id !== onlyHost) return;
    if (trip && host.id !== trip.host.id) return;
    // A po puti order is never a host itself, and the seller must allow it.
    if (!host.poputiAllowed || host.isBackhaul) {
      gate ??= { reason: 'not_allowed' };
      return;
    }
    const remaining = remainingStopsOf(host);
    if ('reason' in remaining) {
      gate ??= { reason: remaining.reason };
      return;
    }
    // Both loads are aboard together on this trip only: the truck's other
    // orders are carried before or after it, never with it (owner, 10.11.2026).
    if (vehicle.capacityKg != null && probe.weight_kg != null) {
      const over = (host.weightKg ?? 0) + (trip?.aboardKg ?? 0) + probe.weight_kg - vehicle.capacityKg;
      if (over > 0) {
        cargo ??= { reason: 'capacity_exceeded', overCapacityKg: over };
        return;
      }
    }
    // Only the trip he is on has stops behind him; a later one starts whole.
    const all = trip ? trip.stops : remaining.stops;
    const fences = i === 0 ? liveFences(all, at, POPUTI_FENCE_RADIUS_M) : all;
    const base = i === 0 ? liveFences(remaining.stops, at, POPUTI_FENCE_RADIUS_M) : remaining.stops;
    const names = { pickups: probe.pickups.map((_, k) => `pickup ${k + 1}`), delivery: 'delivery' };
    // Everything collected, on his way to the client: still open to a po puti
    // near where he is or near that client (owner, 10.11.2026).
    if (i === 0 && fences.length > 0 && fences.every((f) => f.kind === 'client')) {
      const seq = afterCollectionSequence(fences, at, pickups, delivery, names);
      if ('reason' in seq) {
        cargo ??= seq;
        return;
      }
      staged.push({ host, reys: 1, driver: at, from: at, before: owedBefore, fences, base, sequence: seq });
      return;
    }
    const assignment = assignToFences(fences, pickups, delivery, POPUTI_FENCE_RADIUS_M);
    if ('reason' in assignment) {
      // Not near his pickups — but maybe near where he is now, on his way to
      // the first one: collected first, then his own (owner, 10.11.2026).
      const onWay = i === 0 && assignment.reason === 'pickup_outside_fences' ? onTheWay(fences, freshAt, pickups, delivery, names) : null;
      if (onWay && !('reason' in onWay)) {
        staged.push({ host, reys: 1, driver: at, from: at, before: owedBefore, fences, base, sequence: onWay });
        return;
      }
      if (assignment.reason === 'no_pickups_left') gate ??= assignment;
      else cargo ??= assignment;
      return;
    }
    const sequence = mergedSequence(fences, assignment, pickups, delivery, names);
    staged.push({ host, reys: i + 1, driver: i === 0 ? at : null, from: at, before: owedBefore, fences, base, sequence });
  });
  if (vozvratStaged.length + staged.length > 0) return [...vozvratStaged, ...staged];
  return { rejection: cargo ?? gate ?? { reason: 'not_allowed' } };
}

/**
 * Pickups near where the driver is now, before he reaches his first pickup
 * (owner, 10.11.2026): those are collected first, on his way; any others must
 * still sit in his pickups' fences, and the client in his client's. Null when
 * nothing is near him.
 */
function onTheWay(
  fences: TripStop[],
  driver: GeoPoint | null,
  pickups: GeoPoint[],
  delivery: GeoPoint,
  names: { pickups: string[]; delivery: string },
): SequencedStop[] | FenceRejection | null {
  if (!driver) return null;
  const near: number[] = [];
  const rest: number[] = [];
  pickups.forEach((p, k) => (metresBetween(p, driver) <= POPUTI_FENCE_RADIUS_M ? near : rest).push(k));
  if (near.length === 0) return null;
  const restPts = rest.map((k) => pickups[k]!);
  const assignment = assignToFences(fences, restPts, delivery, POPUTI_FENCE_RADIUS_M);
  if ('reason' in assignment) return assignment;
  const merged = mergedSequence(fences, assignment, restPts, delivery, {
    pickups: rest.map((k) => names.pickups[k] ?? `pickup ${k + 1}`),
    delivery: names.delivery,
  }).map((s) => (s.candidateIndex != null && s.kind === 'pickup' ? { ...s, candidateIndex: rest[s.candidateIndex]! } : s));
  const first: SequencedStop[] = near
    .sort((a, b) => metresBetween(pickups[a]!, driver) - metresBetween(pickups[b]!, driver))
    .map((k) => ({
      ...pickups[k]!,
      kind: 'pickup' as const,
      belongsTo: 'candidate' as const,
      name: names.pickups[k] ?? `pickup ${k + 1}`,
      pickupSourceId: null,
      candidateIndex: k,
    }));
  return [...first, ...merged];
}

/** Run an async job over a list, at most `size` in flight. */
async function inBatches<T, R>(items: T[], size: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(job))));
  }
  return out;
}

@Injectable()
export class PoputiService {
  private readonly logger = new Logger(PoputiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly valhalla: ValhallaService,
  ) {}

  /**
   * Can this cargo ride along with what the vehicle is already running — and
   * what the caller needs to persist it: which order is the host, and the
   * merged sequence with stop identities so trip positions can be written to
   * the right rows. Two stages, cheap before expensive: the fences cost no
   * routing call; only what survives them is measured against the road network.
   */
  async planForVehicle(
    vehicleId: string,
    probe: PoputiProbe,
    hostOrderId: string | null = null,
    sellerId: string | null = null,
  ): Promise<{ fit: PoputiFit; hostOrderId: string | null; sequence: SequencedStop[] }> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: { driver: true },
    });
    if (!vehicle?.driver) return plain(no('no_active_order'));

    const running = await this.prisma.order.findMany({
      where: { assignedDriverId: vehicle.driver.id, status: { in: [...RUNNING] } },
      include: { pickupSources: { orderBy: { position: 'asc' } } },
      orderBy: { queuePosition: 'asc' },
    });
    const returning = await this.prisma.order.findMany({
      where: { assignedDriverId: vehicle.driver.id, kind: 'vozvrat', status: 'returning' },
      include: { pickupSources: { orderBy: { position: 'asc' } } },
      orderBy: { queuePosition: 'asc' },
    });

    const staged = stageOne({ vehicle, driver: vehicle.driver, running, returning }, probe, hostOrderId, new Date(), sellerId);
    if ('rejection' in staged) return plain(no(staged.rejection.reason));
    return this.firstWithinCap(staged);
  }

  /** The earliest trip on the truck whose detour stays within the cap. */
  private async firstWithinCap(
    staged: Staged[],
  ): Promise<{ fit: PoputiFit; hostOrderId: string | null; sequence: SequencedStop[]; staged: Staged | null }> {
    for (const one of staged) {
      const m = await this.measure(one);
      if (m.fit.eligible) return { ...m, staged: one };
    }
    return { ...plain(no('detour_too_long')), staged: null };
  }

  /**
   * The order a co-load on this vehicle would ride with — its day and start:
   * the one the seller picked from the search, else the first in the queue.
   */
  async hostOf(
    vehicleId: string,
    hostOrderId: string | null = null,
  ): Promise<{ deliveryDatetime: Date; startAfterNine: boolean } | null> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId }, include: { driver: true } });
    if (!vehicle?.driver) return null;
    return this.prisma.order.findFirst({
      where: {
        assignedDriverId: vehicle.driver.id,
        status: { in: [...RUNNING] },
        ...(hostOrderId ? { id: hostOrderId } : {}),
      },
      select: { deliveryDatetime: true, startAfterNine: true },
      orderBy: { queuePosition: 'asc' },
    });
  }

  /**
   * Which trucks can carry this cargo — the same question asked of every
   * running vehicle at once.
   *
   * The order of work is what makes this affordable. Two queries load every
   * candidate; the fence rules then run in memory over all of them, which costs
   * nothing and discards almost everything; only the survivors reach Valhalla,
   * a few at a time. Searching the whole fleet is therefore barely dearer than
   * testing one truck, which is why the seller can be answered before they
   * commit to anything.
   */
  async search(probe: PoputiProbe, sellerId: string | null = null): Promise<{
    matches: { candidate: Candidate; fit: PoputiFit; hostOrderId: string; pickupEta: Date | null }[];
    nearMisses: { candidate: Candidate; rejection: FenceRejection }[];
  }> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { driver: { isNot: null } },
      include: { driver: { include: { user: { select: { name: true } } } } },
    });
    const driverIds = vehicles.map((v) => v.driver?.id).filter((x): x is string => !!x);
    if (driverIds.length === 0) return { matches: [], nearMisses: [] };

    const running = await this.prisma.order.findMany({
      where: { assignedDriverId: { in: driverIds }, status: { in: [...RUNNING] } },
      include: {
        pickupSources: { orderBy: { position: 'asc' } },
        geoDistrict: { select: { name: true } },
      },
      orderBy: { queuePosition: 'asc' },
    });
    // Vozvrats carrying goods back can host a po puti too (owner, 11.11.2026).
    const returningAll = await this.prisma.order.findMany({
      where: { assignedDriverId: { in: driverIds }, kind: 'vozvrat', status: 'returning' },
      include: {
        pickupSources: { orderBy: { position: 'asc' } },
        geoDistrict: { select: { name: true } },
      },
      orderBy: { queuePosition: 'asc' },
    });
    const returningByDriver = new Map<string, typeof returningAll>();
    for (const order of returningAll) {
      if (!order.assignedDriverId) continue;
      returningByDriver.set(order.assignedDriverId, [...(returningByDriver.get(order.assignedDriverId) ?? []), order]);
    }
    const runningByDriver = new Map<string, typeof running>();
    for (const order of running) {
      if (!order.assignedDriverId) continue;
      const list = runningByDriver.get(order.assignedDriverId) ?? [];
      list.push(order);
      runningByDriver.set(order.assignedDriverId, list);
    }

    const passed: { candidate: Candidate; staged: Staged[] }[] = [];
    const nearMisses: { candidate: Candidate; rejection: FenceRejection }[] = [];

    for (const vehicle of vehicles) {
      const driver = vehicle.driver!;
      const orders = runningByDriver.get(driver.id) ?? [];
      const candidate: Candidate = {
        vehicle,
        driverName: driver.user?.name ?? null,
        headingTo: orders[0]?.geoDistrict?.name ?? null,
        hostDeliveryAt: orders[0]?.deliveryDatetime ?? null,
      };
      const staged = stageOne({ vehicle, driver, running: orders, returning: returningByDriver.get(driver.id) ?? [] }, probe, null, new Date(), sellerId);
      if ('rejection' in staged) {
        // Only a cargo-level refusal is a near miss. "No running order" and
        // "seller did not allow it" mean the truck was never a candidate, and
        // listing every such truck would bury the ones that nearly worked.
        if (NEAR_MISS.has(staged.rejection.reason)) nearMisses.push({ candidate, rejection: staged.rejection });
        continue;
      }
      passed.push({ candidate, staged });
    }

    // Only now does anything touch the network. Per truck, the earliest of
    // its trips that fits within the detour cap is the one offered.
    const tried = await inBatches(passed, ROUTING_CONCURRENCY, async ({ candidate, staged }) => {
      const best = await this.firstWithinCap(staged);
      if (!best.fit.eligible || !best.staged) return null;
      const host = best.staged.host;
      return {
        candidate: { ...candidate, headingTo: host.geoDistrict?.name ?? null, hostDeliveryAt: host.deliveryDatetime },
        fit: best.fit,
        hostOrderId: best.hostOrderId!,
        pickupEta: await this.pickupEta(best.staged),
      };
    });
    const measured = tried.filter((m): m is NonNullable<typeof m> => m !== null);

    // The trip that leaves soonest first, then the smallest detour.
    measured.sort(
      (a, b) =>
        (a.fit.reys ?? 1) - (b.fit.reys ?? 1) || (a.fit.detour_km ?? Infinity) - (b.fit.detour_km ?? Infinity),
    );
    nearMisses.sort((a, b) => (a.rejection.overByM ?? Infinity) - (b.rejection.overByM ?? Infinity));
    return { matches: measured, nearMisses: nearMisses.slice(0, NEAR_MISS_LIMIT) };
  }

  /** Stage 2 for one vehicle that already cleared the fences: the road cost. */
  private async measure(
    staged: Staged,
  ): Promise<{ fit: PoputiFit; hostOrderId: string | null; sequence: SequencedStop[] }> {
    const { host, reys, driver, fences, sequence } = staged;
    const detour = await this.detour(driver, staged.base ?? fences, sequence, host.id);
    // Two limits (owner, 11.11.2026). The first seller's client gets his
    // goods no more than POPUTI_MAX_DETOUR_MIN — or what that seller allowed —
    // later than without the po puti, loading at the added stops counted. And
    // the driver's whole trip grows by no more than POPUTI_MAX_DETOUR_MIN, so
    // a far second client does not hold up his next orders.
    // The seller's 15/30/45 is gone (owner, 11.11.2026): po puti on or off, and the hour and two hours below.
    const capMin = POPUTI_MAX_DETOUR_MIN;
    // Two hours (owner, 11.11.2026): from the driver setting off for the first
    // seller's order — or from now, if he has not — to that client getting his
    // goods, the po puti's pickups and the loading at every stop included.
    const now = Date.now();
    const startedAt = reys === 1 && host.journeyStartedAt ? Math.min(host.journeyStartedAt.getTime(), now) : now;
    const beyondTwoHours =
      detour?.hostArriveSeconds != null &&
      (now - startedAt) / 1000 + detour.hostArriveSeconds > POPUTI_FIRST_CLIENT_WITHIN_MIN * 60;
    if (detour && (beyondTwoHours || detour.hostDelaySeconds > capMin * 60 || detour.seconds > POPUTI_MAX_DETOUR_MIN * 60)) {
      return plain(no('detour_too_long'));
    }
    if (!detour) {
      // The fences already said yes; a routing outage must not turn that into a
      // refusal, so the co-load stands and the number is simply absent.
      return {
        fit: {
          eligible: true,
          reason: 'routing_unavailable',
          detour_km: null,
          detour_seconds: null,
          sequence: sequence.map(toPublic),
          host_order_id: host.id,
          reys,
        },
        hostOrderId: host.id,
        sequence,
      };
    }
    return {
      fit: {
        eligible: true,
        reason: null,
        detour_km: round(detour.km, 3),
        detour_seconds: Math.round(detour.seconds),
        sequence: sequence.map(toPublic),
        host_order_id: host.id,
        reys,
        host_delay_seconds: Math.round(detour.hostDelaySeconds),
        host_deadline_seconds:
          detour.hostBaseSeconds != null
            ? Math.round(Math.min(detour.hostBaseSeconds + capMin * 60, POPUTI_FIRST_CLIENT_WITHIN_MIN * 60 - (now - startedAt) / 1000))
            : null,
      },
      hostOrderId: host.id,
      sequence,
    };
  }

  /**
   * Roughly when the truck reaches the seller's first pickup (owner,
   * 10.11.2026): from where the driver is, through every stop he still owes
   * on the orders ahead, then this trip up to that pickup — road time plus
   * the loading or unloading at each stop on the way. Null when the road cannot
   * be measured.
   */
  async pickupEta(staged: Staged, now: Date = new Date()): Promise<Date | null> {
    const first = staged.sequence.findIndex((s) => s.belongsTo === 'candidate' && s.kind === 'pickup');
    if (first === -1) return null;
    const path: GeoPoint[] = [...staged.before, ...staged.sequence.slice(0, first + 1)];
    const origin = staged.from ?? path[0];
    if (!origin) return null;
    // Every stop before the seller's pickup: loading or unloading at each.
    const standing = poputiDwellSeconds(path.slice(0, -1).map((p) => ({ kind: (p as { kind?: string }).kind ?? 'pickup' })));
    try {
      const route = await this.valhalla.route({
        locations: [origin, ...path].map((p) => ({ lat: p.lat, lon: p.lng })),
        costing: 'auto',
        language: 'ru-RU',
      });
      const seconds = route.summary.time_seconds * POPUTI_TRAFFIC_FACTOR + standing;
      return new Date(now.getTime() + seconds * 1000);
    } catch (err) {
      this.logger.warn(`po puti pickup time unavailable: ${(err as Error)?.message}`);
      return null;
    }
  }

  /**
   * Extra road distance and time the co-load costs: the merged trip minus the
   * running order on its own. Both legs start from the driver, so what is left
   * is only what the added stops cost.
   */
  private async detour(
    driver: GeoPoint | null,
    fences: TripStop[],
    sequence: SequencedStop[],
    hostId: string | null = null,
  ): Promise<{
    km: number;
    seconds: number;
    hostDelaySeconds: number;
    hostBaseSeconds: number | null;
    hostArriveSeconds: number | null;
  } | null> {
    const origin = driver ?? fences[0];
    const asLoc = (p: GeoPoint) => ({ lat: p.lat, lon: p.lng });
    try {
      const [base, merged] = await Promise.all([
        this.valhalla.route({
          locations: [asLoc(origin), ...fences.map(asLoc)],
          costing: 'auto',
          language: 'ru-RU',
        }),
        this.valhalla.route({
          locations: [asLoc(origin), ...sequence.map(asLoc)],
          costing: 'auto',
          language: 'ru-RU',
        }),
      ]);
      // When the first seller's client is reached, on each trip. Stop i is
      // reached after legs 0..i; without legs, the whole trip stands in.
      const reachedAt = (route: typeof base, index: number): number =>
        route.legs?.length ? route.legs.slice(0, index + 1).reduce((a, l) => a + l.summary.time_seconds, 0) : route.summary.time_seconds;
      // The host's client — on a merged trip, not another po puti's client.
      const isHostClient = (x: { kind: string; belongsTo?: string; orderId?: string | null }) =>
        x.kind === 'client' && x.belongsTo !== 'candidate' && (!hostId || !x.orderId || x.orderId === hostId);
      const baseAt = fences.findIndex(isHostClient);
      const mergedAt = sequence.findIndex(isHostClient);
      // Loading at every stop before him that is not his own order's: this po
      // puti's, and one already aboard (owner, 11.11.2026).
      const addedBefore =
        mergedAt === -1
          ? []
          : sequence.slice(0, mergedAt).filter((x) => x.belongsTo === 'candidate' || (hostId && x.orderId && x.orderId !== hostId));
      const hostDelaySeconds =
        baseAt === -1 || mergedAt === -1
          ? 0
          : Math.max(0, reachedAt(merged, mergedAt) - reachedAt(base, baseAt)) * POPUTI_TRAFFIC_FACTOR +
            poputiDwellSeconds(addedBefore);
      // When his client would get the goods without the po puti: the road, and
      // the loading at his own stops before him.
      const hostBaseSeconds =
        baseAt === -1 ? null : reachedAt(base, baseAt) * POPUTI_TRAFFIC_FACTOR + poputiDwellSeconds(fences.slice(0, baseAt));
      // When he gets them with the po puti: the road, and the loading at every stop before him.
      const hostArriveSeconds =
        mergedAt === -1 ? null : reachedAt(merged, mergedAt) * POPUTI_TRAFFIC_FACTOR + poputiDwellSeconds(sequence.slice(0, mergedAt));
      return {
        hostBaseSeconds,
        hostArriveSeconds,
        km: Math.max(0, merged.summary.length_km - base.summary.length_km),
        seconds: Math.max(0, merged.summary.time_seconds - base.summary.time_seconds) * POPUTI_TRAFFIC_FACTOR,
        hostDelaySeconds,
      };
    } catch (err) {
      this.logger.warn(`po puti detour unavailable: ${(err as Error)?.message}`);
      return null;
    }
  }
}

/**
 * The running order's un-visited stops, in driving order. Mirrors how the
 * driver's next action is derived, so the fences can never disagree with the
 * button the driver is looking at.
 */
export function remainingStopsOf(order: {
  id?: string;
  status: string;
  clientName: string;
  deliveryLat: number | null;
  deliveryLng: number | null;
  pickupSources: {
    id: string;
    name: string;
    position: number;
    legStatus: string;
    lat: number | null;
    lng: number | null;
    tripPosition?: number | null;
  }[];
}): { stops: TripStop[] } | { reason: PoputiRejection } {
  if (!(ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    return { reason: 'no_active_order' };
  }
  if (order.deliveryLat == null || order.deliveryLng == null) {
    return { reason: 'missing_coordinates' };
  }

  const stops: TripStop[] = [];
  const pending = [...order.pickupSources]
    .sort((a, b) => a.position - b.position)
    .filter((s) => s.legStatus !== 'arrived');
  for (const s of pending) {
    if (s.lat == null || s.lng == null) return { reason: 'missing_coordinates' };
    stops.push({ kind: 'pickup', id: s.id, name: s.name, lat: s.lat, lng: s.lng, orderId: order.id ?? null });
  }
  stops.push({
    kind: 'client',
    id: null,
    name: order.clientName,
    lat: order.deliveryLat,
    lng: order.deliveryLng,
    orderId: order.id ?? null,
  });
  return { stops };
}

function no(reason: PoputiRejection): PoputiFit {
  return { eligible: false, reason, detour_km: null, detour_seconds: null, sequence: [] };
}

/** A refusal carries no plan — there is nothing to persist. */
function plain(fit: PoputiFit) {
  return { fit, hostOrderId: null, sequence: [] as SequencedStop[] };
}

function toPublic(s: SequencedStop) {
  return { kind: s.kind, belongs_to: s.belongsTo, name: s.name, lat: s.lat, lng: s.lng };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
