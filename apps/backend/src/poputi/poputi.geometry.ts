import { POPUTI_FENCE_RADIUS_M, type PoputiRejection } from '@bigant/shared';

/** A point on the ground. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** A stop of the running order, in driving order. Each projects a fence. */
export interface TripStop extends GeoPoint {
  kind: 'pickup' | 'client';
  /** Pickup source id; null for the client stop. */
  id: string | null;
  name: string;
  /** The order the stop belongs to — on a merged trip, the host's or a po puti's (owner, 11.11.2026). */
  orderId?: string | null;
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Great-circle distance. Straight-line on purpose: a fence is a circle on a
 * map, so a dispatcher can check the decision by eye, and it costs no routing
 * call. Road distance is used afterwards, for the detour that gets shown.
 */
export function metresBetween(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * The fences still ahead of the driver.
 *
 * `remaining` is the running order's un-visited stops in driving order. A stop
 * already arrived at is gone from that list, which covers most of the rule. The
 * driver's position covers the rest: if they are already standing inside the
 * fence of a later stop, every earlier fence is behind them and adding work
 * there would mean turning back.
 *
 * Which stop they have "reached" is the **nearest** one within the radius, not
 * the last. In Tashkent consecutive stops are routinely closer together than
 * the 4 km fence, so a driver standing at one is often inside the next one's
 * fence as well; taking the last match would close the fence of the stop they
 * are literally parked at, and refuse a co-load for that neighbourhood at the
 * one moment it is most useful.
 */
export function liveFences(
  remaining: TripStop[],
  driver: GeoPoint | null,
  radiusM: number = POPUTI_FENCE_RADIUS_M,
): TripStop[] {
  if (!driver || remaining.length === 0) return remaining;
  let reached = 0;
  let nearest = Infinity;
  remaining.forEach((stop, i) => {
    const m = metresBetween(driver, stop);
    if (m <= radiusM && m < nearest) {
      nearest = m;
      reached = i;
    }
  });
  return remaining.slice(reached);
}

/**
 * A refusal, with the number that caused it where there is one.
 *
 * The search shows near misses — "your client is 8.9 km away, the limit is 5" —
 * and that sentence is only possible if the rule reports the measurement it
 * already made rather than just the verdict.
 */
export interface FenceRejection {
  reason: PoputiRejection;
  /** Metres by which the worst stop missed its nearest eligible fence. */
  overByM?: number;
  pickupsAllowed?: number;
  pickupsOffered?: number;
  /** Kilograms the co-load would put the truck over its plate capacity. */
  overCapacityKg?: number;
}

export interface FenceAssignment {
  /** Index into the fence list → indexes of the candidate pickups added there, in visiting order. */
  pickupByFence: Map<number, number[]>;
  /** Index of the fence the candidate's client falls in. */
  clientFence: number;
}

/**
 * Places the candidate order's stops into the live fences.
 *
 * Each candidate pickup goes to the **nearest** running-order pickup still ahead
 * whose fence it is in; the client must be in the running order's client fence.
 * Several candidate pickups may share one fence (owner, 09.11.2026: "the driver
 * goes to Chilonzor anyway, so he collects both of them there"), so their number
 * is not limited by how many pickups the running order has left — only by every
 * one of them lying on the road ahead. Inside a fence they are visited nearest
 * first, from the running stop outward.
 */
export function assignToFences(
  fences: TripStop[],
  candidatePickups: GeoPoint[],
  candidateDelivery: GeoPoint,
  radiusM: number = POPUTI_FENCE_RADIUS_M,
): FenceAssignment | FenceRejection {
  const pickupFences = fences
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.kind === 'pickup');
  const clientFenceIdx = fences.findIndex((f) => f.kind === 'client');

  // Nothing left to collect: the driver would have to turn off his road.
  if (pickupFences.length === 0) return { reason: 'no_pickups_left' };

  // The client must ride to roughly the same place, or this is not a co-load.
  if (clientFenceIdx === -1) return { reason: 'delivery_outside_fence' };
  const toClient = metresBetween(candidateDelivery, fences[clientFenceIdx]);
  if (toClient > radiusM) {
    return { reason: 'delivery_outside_fence', overByM: toClient - radiusM };
  }

  const placed: { fence: number; candidate: number; m: number }[] = [];
  // On a merged trip a pickup fence can come after the first client (another
  // po puti's pickup); the candidate's client then goes after its last pickup.
  let worstOut = -1;
  candidatePickups.forEach((p, candidate) => {
    let best: { fence: number; m: number } | null = null;
    for (const { f, i } of pickupFences) {
      const m = metresBetween(p, f);
      if (m <= radiusM && (!best || m < best.m)) best = { fence: i, m };
    }
    if (best) placed.push({ fence: best.fence, candidate, m: best.m });
    else worstOut = Math.max(worstOut, nearestFenceM(p, pickupFences));
  });
  if (worstOut >= 0) {
    // How far the worst stranded pickup is from the nearest fence it could have
    // used — the one number that tells the seller whether this was close.
    return { reason: 'pickup_outside_fences', overByM: Math.max(0, worstOut - radiusM) };
  }

  const pickupByFence = new Map<number, number[]>();
  for (const { fence, candidate } of placed.sort((x, y) => x.m - y.m)) {
    pickupByFence.set(fence, [...(pickupByFence.get(fence) ?? []), candidate]);
  }
  const lastPickupFence = Math.max(-1, ...placed.map((x) => x.fence));
  return { pickupByFence, clientFence: Math.max(clientFenceIdx, lastPickupFence) };
}

function nearestFenceM(p: GeoPoint, fences: { f: TripStop }[]): number {
  return Math.min(...fences.map(({ f }) => metresBetween(p, f)));
}

export interface SequencedStop extends GeoPoint {
  kind: 'pickup' | 'client';
  belongsTo: 'running' | 'candidate';
  name: string;
  /**
   * Identity of the stop, so the caller can write the computed trip position
   * back to the right row. For a running pickup this is its pickup-source id;
   * for a candidate pickup, its index in the submitted list (the rows do not
   * exist yet when the sequence is computed).
   */
  pickupSourceId: string | null;
  candidateIndex: number | null;
  /** For a running stop: the order it belongs to (its client stop is that order's delivery). */
  orderId?: string | null;
}

/**
 * The merged trip, in driving order.
 *
 * Each added stop is visited **immediately after** the running-order stop whose
 * fence it sits in (several in one fence: nearest first). The running order is the committed job and the driver is
 * heading there anyway; the co-load is the detour, so it hangs off that leg.
 * Deterministic, and a driver can predict it without opening a map.
 */
export function mergedSequence(
  fences: TripStop[],
  assignment: FenceAssignment,
  candidatePickups: GeoPoint[],
  candidateDelivery: GeoPoint,
  candidateNames: { pickups: string[]; delivery: string },
): SequencedStop[] {
  const out: SequencedStop[] = [];
  fences.forEach((fence, i) => {
    out.push({ ...fence, belongsTo: 'running', pickupSourceId: fence.id, candidateIndex: null });
    for (const added of assignment.pickupByFence.get(i) ?? []) {
      out.push({
        ...candidatePickups[added],
        kind: 'pickup',
        belongsTo: 'candidate',
        name: candidateNames.pickups[added] ?? `pickup ${added + 1}`,
        pickupSourceId: null,
        candidateIndex: added,
      });
    }
    if (i === assignment.clientFence) {
      out.push({
        ...candidateDelivery,
        kind: 'client',
        belongsTo: 'candidate',
        name: candidateNames.delivery,
        pickupSourceId: null,
        candidateIndex: null,
      });
    }
  });
  return out;
}

/**
 * Po puti once every pickup of the running order is collected and the driver
 * is on his way to its client (owner, 10.11.2026). A new pickup is taken if it
 * lies within the radius of where the driver is now — collected on the way,
 * before the client — or of the client — collected right after handing over,
 * so the first client waits for nothing. Near both, after the client is
 * chosen. The new client must be within the radius of the running client and
 * is always visited last.
 */
export function afterCollectionSequence(
  clientOrClients: TripStop | TripStop[],
  driver: GeoPoint | null,
  candidatePickups: GeoPoint[],
  candidateDelivery: GeoPoint,
  names: { pickups: string[]; delivery: string },
  radiusM: number = POPUTI_FENCE_RADIUS_M,
): SequencedStop[] | FenceRejection {
  // Several clients left when the truck already carries a po puti (owner,
  // 11.11.2026): the first is the host's; the new client must be near it.
  const clients = Array.isArray(clientOrClients) ? clientOrClients : [clientOrClients];
  const client = clients[0]!;
  const toClient = metresBetween(candidateDelivery, client);
  if (toClient > radiusM) return { reason: 'delivery_outside_fence', overByM: toClient - radiusM };

  const before: { i: number; m: number }[] = [];
  // Collected right after the client it is nearest to.
  const after = new Map<number, { i: number; m: number }[]>();
  let worst = -1;
  candidatePickups.forEach((p, i) => {
    let best: { c: number; m: number } | null = null;
    clients.forEach((c, k) => {
      const m = metresBetween(p, c);
      if (m <= radiusM && (!best || m < best.m)) best = { c: k, m };
    });
    const byDriver = driver ? metresBetween(p, driver) : Infinity;
    const near = best as { c: number; m: number } | null;
    if (near) after.set(near.c, [...(after.get(near.c) ?? []), { i, m: near.m }]);
    else if (byDriver <= radiusM) before.push({ i, m: byDriver });
    else worst = Math.max(worst, Math.min(...clients.map((c) => metresBetween(p, c)), byDriver));
  });
  if (worst >= 0) return { reason: 'pickup_outside_fences', overByM: Math.max(0, worst - radiusM) };

  const pickupStop = (i: number): SequencedStop => ({
    ...candidatePickups[i],
    kind: 'pickup',
    belongsTo: 'candidate',
    name: names.pickups[i] ?? `pickup ${i + 1}`,
    pickupSourceId: null,
    candidateIndex: i,
  });
  const candidateClient: SequencedStop = {
    ...candidateDelivery,
    kind: 'client',
    belongsTo: 'candidate',
    name: names.delivery,
    pickupSourceId: null,
    candidateIndex: null,
  };
  // The new client goes right after the host's client, or after its own last pickup.
  const lastWithPickup = Math.max(0, ...[...after.keys()]);
  const out: SequencedStop[] = before.sort((a, b) => a.m - b.m).map((x) => pickupStop(x.i));
  clients.forEach((c, k) => {
    out.push({ ...c, belongsTo: 'running', pickupSourceId: c.id, candidateIndex: null });
    out.push(...(after.get(k) ?? []).sort((a, b) => a.m - b.m).map((x) => pickupStop(x.i)));
    if (k === lastWithPickup) out.push(candidateClient);
  });
  return out;
}
