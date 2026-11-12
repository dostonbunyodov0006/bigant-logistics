import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  BoardResponse,
  BoardVehicle,
  BoardView,
  BookingKind,
  BookingMode,
  BookingSession,
  BookingSlot,
  CargoTypePublic,
  FillOrderInput,
  ReserveInput,
  ReserveResult,
  SellerOrder,
  VehicleCategory,
  VehicleRequiredField,
  VehicleQueue,
} from '@bigant/shared';
import { ACTIVE_ORDER_STATUSES, POPUTI_MAX_PER_SELLER, VEHICLE_REQUIRED_DOCS, type CarryOverReason } from '@bigant/shared';
import { tashkentDateKey, tashkentDateLabel, tashkentDayStartUtc } from '../common/tashkent-time';
import { settleDriverStatus } from '../drivers/driver-status';
import { clientVisibleTo, type ClientActor } from '../clients/clients.service';
import { driverActionsAvailableAt, isActionable, type TimedOrder } from '../orders/order-timing';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PoputiService } from '../poputi/poputi.service';
import { ClientAddressesService, clientAddressText } from '../clients/client-addresses.service';
import type {
  PoputiProbe,
  PoputiSearchInput,
  PoputiSearchResult,
} from '@bigant/shared';
import { emitOrderEvent, OrderEventType } from '../outbox/events';

const FILL_WINDOW_MS = 7 * 60 * 1000;
/** A probe far outside any fence: it can only fail on the vehicle-level rules,
 *  never on geometry, which is exactly what the reserve-time precheck wants. */
const PRECHECK_PROBE: PoputiProbe = {
  pickups: [{ lat: 0, lng: 0 }],
  delivery: { lat: 0, lng: 0 },
  weight_kg: null,
};
/** Reasons that no amount of form-filling could fix. */
const PRECHECK_BLOCKERS: readonly string[] = [
  'no_active_order',
  'not_allowed',
  'missing_coordinates',
  'no_pickups_left',
  'poputi_taken',
];
const DAY_MS = 86_400_000;
/** The statuses in which a running order still has driving left to share. Kept
 *  beside PoputiService's own list — both answer the same question. */
const POPUTI_HOST_STATUSES: readonly string[] = [
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
];
/**
 * How many different sellers may share one truck on a day. Was 2; raised to 3
 * for now — Polniy still takes the whole truck for one seller.
 */
const MAX_SELLERS_PER_TRUCK = 3;
/** A Polniy booking is one seller's whole lorry; this is only a guard against a
 *  stuck finger, not a rule about how many drops a day can hold. */
const MAX_FULL_BOOKING_ORDERS = 10;
/** Statuses in which a committed booking still occupies its vehicle. */
const OCCUPYING = [
  'driver_accepted',
  'collecting_items',
  'items_collected',
  'on_the_way',
  'arrived_at_customer',
  // A return written up at the client is still that lorry's work: the goods
  // ride back on it, and the seller has to see it (and confirm it) in its
  // queue, not find the lorry among the free ones for anyone to book.
  'returning',
] as const;
/** Journey progression, so the board can show the furthest-along active order. */
const JOURNEY_RANK: Record<string, number> = {
  assigned_to_driver: 1,
  driver_accepted: 2,
  collecting_items: 3,
  items_collected: 4,
  on_the_way: 5,
  arrived_at_customer: 6,
};

/** Today in Tashkent, as the UTC-midnight label scheduled days are stored under. */
function today(now: Date = new Date()): Date {
  return tashkentDateLabel(now);
}
/**
 * Drivers who ended today's shift with "Polniy" (owner, 12.11.2026): the day
 * off, asked for. A shift opened again clears it.
 */
async function dayOffDrivers(
  db: Pick<PrismaService, 'workLog'>,
  driverIds: string[],
  now: Date,
): Promise<Set<string>> {
  if (!driverIds.length) return new Set();
  const rows = await db.workLog.findMany({
    where: {
      driverId: { in: driverIds },
      dayOff: true,
      clockOutAt: { gte: tashkentDayStartUtc(tashkentDateKey(now)) },
    },
    select: { driverId: true },
  });
  return new Set(rows.map((r) => r.driverId));
}

/** Parse YYYY-MM-DD to its date label; default = today (Tashkent). */
function parseDay(s?: string): Date {
  return s ? new Date(`${s}T00:00:00.000Z`) : today();
}

type OccupancyOrder = TimedOrder;

/**
 * A return set aside with Ojidaniya rides along, but the lorry is no longer
 * its to hold (owner, 02.11.2026): it shows as Bo'sh and takes a new booking;
 * a Polniy with nothing else on it ends there.
 */
function holdsLorry(o: { status: string; returnDeferredAt?: Date | null }): boolean {
  return !(o.status === 'returning' && o.returnDeferredAt);
}

/**
 * Whether an open order takes up the truck on the day being booked.
 *
 * Today it is anything the driver is working on now — which includes an order
 * from yesterday he has not closed yet — plus today's own bookings before their
 * 00:01 opening. Counting only orders dated today made a truck still carrying
 * yesterday's load show as Bo'sh, and bookable, from the moment the day turned.
 * Tomorrow it is tomorrow's bookings; today's unfinished work is expected done.
 */
function occupiesDay(o: OccupancyOrder, day: Date, now: Date): boolean {
  const t = o.deliveryDatetime.getTime();
  const onDay = t >= day.getTime() && t < day.getTime() + DAY_MS;
  if (day.getTime() !== today(now).getTime()) return onDay && o.bookingKind !== null;
  return onDay || isActionable(o, now);
}

type Actor = { userId: string; role: string };

/**
 * Which of a driver's orders are riding together rather than queueing.
 *
 * Trip positions are written only when a po puti co-load merges two orders into
 * one route, so an order carrying them is never alone: the earliest in the
 * queue is the host and everything after it is aboard with it. Returns the host
 * id keyed by co-load id; an order absent from the map is queueing normally.
 *
 * `orders` must already be ordered by queue position.
 */
function coloadHosts(
  orders: readonly {
    id: string;
    deliveryTripPosition: number | null;
    pickupSources: readonly { tripPosition: number | null }[];
  }[],
): Map<string, string> {
  const merged = orders.filter(
    (o) => o.deliveryTripPosition != null || o.pickupSources.some((s) => s.tripPosition != null),
  );
  const out = new Map<string, string>();
  const [host, ...coloads] = merged;
  if (!host) return out;
  for (const o of coloads) out.set(o.id, host.id);
  return out;
}

const SELLER_ORDER_INCLUDE = {
  cargoType: { select: { name: true } },
  geoDistrict: { select: { name: true } },
  createdBySeller: { select: { name: true } },
  pickupSources: { include: { geoDistrict: { select: { name: true } } }, orderBy: { position: 'asc' as const } },
  carryOvers: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { reason: true, comment: true, createdAt: true },
  },
  // Whether a write-up is sitting on the seller's desk, and whether he has
  // already answered it.
  _count: { select: { returnItems: true } },
};

@Injectable()
export class SellerBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly poputi: PoputiService,
    private readonly clientAddresses: ClientAddressesService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // --- "Ishxona ishi bilan" (owner, 12.11.2026) ---

  /**
   * An admin or the dispatcher sends a lorry on the company's errands: what
   * for, and about how long. Written on its card; sellers may still book it.
   * Not while the driver is carrying an order.
   */
  async startCompanyJob(vehicleId: string, input: { tasks: string[]; minutes: number }, actor: Actor) {
    const now = new Date();
    const todayLabel = today(now);
    const dayEnd = new Date(todayLabel.getTime() + DAY_MS);
    const tasks = input.tasks.map((t) => t.trim()).filter(Boolean);
    if (tasks.length === 0) throw new BadRequestException('company_job_tasks_required');
    const job = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`;
      const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId }, include: { driver: { select: { id: true, userId: true } } } });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      if (!vehicle.driver) throw new BadRequestException('vehicle_has_no_driver');
      if (vehicle.status === 'maintenance') throw new ConflictException('vehicle_in_repair');
      if ((await tx.companyJob.count({ where: { vehicleId, endedAt: null, until: { gt: now } } })) > 0) {
        throw new ConflictException('vehicle_company_job');
      }
      const inHand = await tx.order.count({
        where: { assignedDriverId: vehicle.driver.id, status: { in: [...ACTIVE_ORDER_STATUSES] }, deliveryDatetime: { lt: dayEnd } },
      });
      if (inHand > 0) throw new ConflictException('vehicle_busy');
      const by = await tx.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
      return tx.companyJob.create({
        data: {
          vehicleId,
          driverId: vehicle.driver.id,
          tasks,
          minutes: input.minutes,
          startedAt: now,
          until: new Date(now.getTime() + input.minutes * 60_000),
          createdById: actor.userId,
          createdByName: by?.name ?? '',
        },
      });
    });
    this.realtime.driverStatusChanged(job.driverId ?? '');
    // The driver is told what for and for how long; a failed push undoes nothing.
    try {
      const driver = job.driverId
        ? await this.prisma.driver.findUnique({ where: { id: job.driverId }, select: { userId: true } })
        : null;
      if (driver && this.notifications) {
        const h = Math.floor(job.minutes / 60);
        const m = job.minutes % 60;
        const long = [h ? `${h} soat` : '', m ? `${m} daqiqa` : ''].filter(Boolean).join(' ');
        await this.notifications.notify(driver.userId, {
          type: 'company_job.started',
          title: 'Ishxona ishi',
          body: `${job.tasks.map((t, i) => (job.tasks.length > 1 ? `${i + 1}. ${t}` : t)).join('\n')}\nTaxminan ${long}.`,
        });
      }
    } catch {
      // The push is a courtesy; the lorry is taken either way.
    }
    return { id: job.id, until: job.until.toISOString() };
  }

  /** The "Nima ish bilan?" list, A to Z (owner, 12.11.2026). */
  async companyJobOptions(): Promise<{ id: string; name: string }[]> {
    const rows = await this.prisma.companyJobOption.findMany({ orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  /** A new entry; one already there (any case) is returned as it is. */
  async addCompanyJobOption(nameIn: string): Promise<{ id: string; name: string }> {
    const name = nameIn.trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('company_job_option_name');
    const same = await this.prisma.companyJobOption.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (same) return { id: same.id, name: same.name };
    const r = await this.prisma.companyJobOption.create({ data: { name } });
    return { id: r.id, name: r.name };
  }

  async removeCompanyJobOption(id: string): Promise<{ deleted: true }> {
    await this.prisma.companyJobOption.deleteMany({ where: { id } });
    return { deleted: true };
  }

  /** Back before the time: the lorry is free again (owner, 12.11.2026). */
  async endCompanyJob(jobId: string) {
    const job = await this.prisma.companyJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('company_job_not_found');
    if (!job.endedAt) {
      await this.prisma.companyJob.update({ where: { id: jobId }, data: { endedAt: new Date() } });
      if (job.driverId) this.realtime.driverStatusChanged(job.driverId);
    }
    return { ended: true };
  }

  // --- Cargo types ---
  async listCargoTypes(): Promise<CargoTypePublic[]> {
    const rows = await this.prisma.cargoType.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    return rows.map((t) => ({ id: t.id, name: t.name, active: t.active }));
  }

  // --- Board (date-scoped: today for free/mine/busy, tomorrow for the Ertangi tab) ---
  async board(view: BoardView, actor: Actor): Promise<BoardResponse> {
    const now = new Date();
    const todayLabel = today(now);
    const targetDay = view === 'tomorrow' ? new Date(todayLabel.getTime() + DAY_MS) : todayLabel;
    const dayEnd = new Date(targetDay.getTime() + DAY_MS);

    const vehicles = await this.prisma.vehicle.findMany({
      include: {
        driver: { include: { user: { select: { name: true } } } },
        documents: { select: { type: true, expiresAt: true } },
      },
      orderBy: { plateNumber: 'asc' },
    });
    const driverIds = vehicles.map((v) => v.driver?.id).filter((x): x is string => !!x);

    const [rawHolds, orders, leaves, activeOrders, dayOffs, companyJobs] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { status: 'awaiting', scheduledDate: { gte: targetDay, lt: dayEnd } },
        select: { vehicleId: true, sellerId: true, fullBooking: true, fillDeadline: true },
      }),
      this.prisma.order
        .findMany({
          where: {
            assignedDriverId: { in: driverIds },
            deliveryDatetime: { lt: dayEnd },
            // A return booked from the board waits for the driver's accept and
            // holds the lorry from the moment it is booked, not from his tap.
            OR: [{ status: { in: [...OCCUPYING] } }, { kind: 'vozvrat', status: 'assigned_to_driver' }],
          },
          select: {
            id: true,
            status: true,
            returnDeferredAt: true,
            assignedDriverId: true,
            createdBySellerId: true,
            fullBooking: true,
            queuePosition: true,
            deliveryDatetime: true,
            bookingKind: true,
            startAfterNine: true,
            kind: true,
          },
        })
        .then((rows) => rows.filter((o) => holdsLorry(o) && occupiesDay(o, targetDay, now))),
      // Approved leave overlapping the target day → the vehicle shows as excused.
      this.prisma.leaveRequest.findMany({
        where: {
          driverId: { in: driverIds },
          status: 'approved',
          startDate: { lt: dayEnd },
          endDate: { gte: targetDay },
        },
        select: { driverId: true, startDate: true, endDate: true },
      }),
      // The driver's current active orders (not date-scoped — an in-progress order
      // is "now"). Drives the card's order-status label + the carried-return "!"
      // + the place-aware return-trip stage.
      this.prisma.order.findMany({
        where: { assignedDriverId: { in: driverIds }, status: { in: [...ACTIVE_ORDER_STATUSES] } },
        select: {
          assignedDriverId: true,
          status: true,
          returnStage: true,
          returnDestination: true,
          // For the po puti chip: whether the running order permits a co-load
          // and still has collecting left to share.
          poputiAllowed: true,
          queuePosition: true,
          pickupSources: { select: { legStatus: true } },
        },
      }),
      // "Polniy" today (owner, 12.11.2026); only today's board cares.
      view === 'tomorrow' ? Promise.resolve(new Set<string>()) : dayOffDrivers(this.prisma, driverIds, now),
      // "Ishxona ishi bilan" running now (owner, 12.11.2026); today's board only.
      view === 'tomorrow'
        ? Promise.resolve([] as { id: string; vehicleId: string; tasks: string[]; until: Date; createdByName: string }[])
        : this.prisma.companyJob.findMany({
            where: { endedAt: null, until: { gt: now } },
            select: { id: true, vehicleId: true, tasks: true, until: true, createdByName: true },
          }),
    ]);
    const jobOf = new Map(companyJobs.map((j) => [j.vehicleId, j]));
    // Expired-but-not-yet-swept holds don't occupy the truck.
    const holds = rawHolds.filter((h) => !h.fillDeadline || h.fillDeadline.getTime() > now.getTime());
    const onLeave = new Set(leaves.map((l) => l.driverId));
    const leaveOf = new Map(leaves.map((l) => [l.driverId, l]));
    // The order a co-load would ride with: the running one, lowest in the queue.
    const hostByDriver = new Map<string, (typeof activeOrders)[number]>();
    for (const o of activeOrders) {
      if (!o.assignedDriverId || !POPUTI_HOST_STATUSES.includes(o.status)) continue;
      const cur = hostByDriver.get(o.assignedDriverId);
      if (!cur || (o.queuePosition ?? 0) < (cur.queuePosition ?? 0)) {
        hostByDriver.set(o.assignedDriverId, o);
      }
    }
    // Per driver: the furthest-along *delivery* order status (returns are shown
    // separately as the "!" + trip stage, not as the primary order status).
    const orderStatusByDriver = new Map<string, string>();
    const returnByDriver = new Map<string, { stage: string | null; destination: string | null }>();
    const hasReturn = new Set<string>();
    const stageRank = (s: string | null) => (s === 'arrived' ? 2 : s === 'heading' ? 1 : 0);
    for (const o of activeOrders) {
      if (!o.assignedDriverId) continue;
      if (o.status === 'returning') {
        hasReturn.add(o.assignedDriverId);
        const cur = returnByDriver.get(o.assignedDriverId);
        if (!cur || stageRank(o.returnStage) > stageRank(cur.stage)) {
          returnByDriver.set(o.assignedDriverId, { stage: o.returnStage ?? null, destination: o.returnDestination ?? null });
        }
        continue;
      }
      const cur = orderStatusByDriver.get(o.assignedDriverId);
      if (!cur || (JOURNEY_RANK[o.status] ?? 0) > (JOURNEY_RANK[cur] ?? 0)) {
        orderStatusByDriver.set(o.assignedDriverId, o.status);
      }
    }

    const cards: BoardVehicle[] = [];
    for (const v of vehicles) {
      if (!v.driver) continue; // not bookable without a driver
      const vHolds = holds.filter((h) => h.vehicleId === v.id);
      const vOrders = orders.filter((o) => o.assignedDriverId === v.driver!.id);
      const confirmedSellers = new Set<string>(vOrders.map((o) => o.createdBySellerId));
      const confirmedSlots = vOrders.length;
      const confirmedFullBooking = vOrders.some((o) => o.fullBooking);
      const loadCount = vHolds.length + vOrders.length;
      const occupied = loadCount > 0;
      // The company's own errand is written on the card; sellers may still book
      // the lorry (owner, 12.11.2026).
      const job = jobOf.get(v.id) ?? null;
      const full =
        vHolds.some((h) => h.fullBooking) ||
        vOrders.some((o) => o.fullBooking);
      // Off-duty only matters for today; tomorrow's shift is unknown.
      const offduty = view !== 'tomorrow' && v.driver.currentStatus === 'offline';
      const status = offduty ? 'offduty' : !occupied ? 'free' : full ? 'full' : 'booked';

      // Seven-colour card state, by precedence (today only for shift/break/leave).
      const isToday = view !== 'tomorrow';
      const repair = v.status === 'maintenance';
      const retired = v.status === 'inactive';
      const expiredDocs = (v.documents ?? [])
        .filter((d) => d.expiresAt.getTime() < now.getTime())
        .map((d) => d.type);
      const docIssue = expiredDocs.length > 0;
      // A lorry with no inspection or insurance on file at all is as grounded
      // as one whose paper ran out; the office is told which is which.
      const held = new Set((v.documents ?? []).map((d) => d.type));
      const missingDocs = VEHICLE_REQUIRED_DOCS.filter((d) => !held.has(d));
      const licenseExpired =
        !!v.driver.licenseExpiresAt && v.driver.licenseExpiresAt.getTime() < now.getTime();
      // What the office never filled in. Still reported, because the fill
      // form's limit banner reads "— kg" without it, but it no longer colours
      // the card: a gap in our own paperwork is the office's problem, and
      // painting twenty-two working lorries red taught the seller to read red
      // as "normal" — which is the one thing red must never mean.
      const missing: VehicleRequiredField[] = [
        ...(v.capacityKg == null ? (['capacity'] as const) : []),
        // Every lorry and van needs its body measured; only the Cobalt, which
        // carries no cargo, is let off (owner, 27.10.2026).
        ...(!/cobalt/i.test(v.model) && (v.lengthCm == null || v.widthCm == null || v.heightCm == null)
          ? (['dimensions'] as const)
          : []),
        ...(v.driver.licenseCategory ? [] : (['license_category'] as const)),
      ];
      // A break no longer greys the card (owner, 12.11.2026): he shows as free
      // and can be booked; the card counts down to his return, and counts the
      // lateness in red once its end has passed and he is not back. A break
      // set for later is not shown until its start.
      const breakShown =
        isToday &&
        v.driver.currentStatus !== 'offline' &&
        !!v.driver.breakUntil &&
        (!v.driver.breakStartedAt || v.driver.breakStartedAt.getTime() <= now.getTime());
      const dayOff = dayOffs.has(v.driver.id) && v.driver.currentStatus === 'offline';
      // Leave is dated, so it colours tomorrow's card too; "Polniy" is today's.
      const excused = onLeave.has(v.driver.id) || dayOff;
      const workStarted = v.driver.currentStatus !== 'offline';
      // Paperwork never paints the card red: the reason is written on it,
      // and that is enough. Red is for a lorry that is physically out — at
      // the repair shop or taken off the fleet.
      const cardState = repair || retired
        ? 'blocked'
        : excused
          ? 'excused'
          : full
            ? 'full'
            : loadCount >= 2
              ? 'multi_load'
              : loadCount === 1
                ? 'one_load'
                : isToday && workStarted
                  ? 'available_working'
                  : 'available_idle';
      const mineHolds = vHolds.filter((h) => h.sellerId === actor.userId);
      const inQueueOrder = [...vOrders].sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
      const myOrders = inQueueOrder.filter((o) => o.createdBySellerId === actor.userId);
      const mySlots = myOrders.length;
      const deadlines = mineHolds.map((h) => h.fillDeadline).filter((d): d is Date => !!d);
      const awaitingUntil = deadlines.length
        ? new Date(Math.min(...deadlines.map((d) => d.getTime()))).toISOString()
        : null;

      cards.push({
        id: v.id,
        model: v.model,
        plate_number: v.plateNumber,
        category: this.categoryOf(v),
        capacity_kg: v.capacityKg,
        length_cm: v.lengthCm,
        width_cm: v.widthCm,
        height_cm: v.heightCm,
        driver_id: v.driver.id,
        driver_name: v.driver.user?.name ?? null,
        board_status: status,
        card_state: cardState,
        on_leave: onLeave.has(v.driver.id),
        driver_not_started: v.driver.currentStatus === 'offline',
        leave_from: leaveOf.get(v.driver.id)?.startDate.toISOString().slice(0, 10) ?? null,
        leave_to: leaveOf.get(v.driver.id)?.endDate.toISOString().slice(0, 10) ?? null,
        // The red dot says "do not book this one"; these two say why, so the
        // seller knows whether to wait an hour or pick another truck.
        blocked_reason: repair
          ? 'repair'
          : retired
            ? 'inactive'
            : licenseExpired
              ? 'license_expired'
              : docIssue
                ? 'documents'
                : missingDocs.length > 0
                  ? 'missing_documents'
                  : null,
        expired_docs: expiredDocs,
        missing_docs: [...missingDocs],
        missing_fields: missing,
        // Today's trip is today's: on Ertangi buyurtmalar the lorry shows only
        // tomorrow's bookings — no "Qabul qilindi", no Po puti (owner, 07.11.2026).
        order_status: (view === 'tomorrow' ? null : (orderStatusByDriver.get(v.driver.id) ?? null)) as BoardVehicle['order_status'],
        poputi_open: view !== 'tomorrow' && isPoputiOpen(hostByDriver.get(v.driver.id)),
        has_pending_return: hasReturn.has(v.driver.id),
        return_stage: (returnByDriver.get(v.driver.id)?.stage ?? null) as BoardVehicle['return_stage'],
        return_destination: (returnByDriver.get(v.driver.id)?.destination ??
          null) as BoardVehicle['return_destination'],
        my_slots: mySlots,
        vozvrat_slots: vOrders.filter((o) => o.kind === 'vozvrat').length,
        current_order_id: view === 'tomorrow' ? null : (inQueueOrder[0]?.id ?? null),
        my_order_ids: myOrders.map((o) => o.id),
        // Saved orders and holds still being filled: a second seller who has
        // just pressed Bron already shares the truck (owner, 09.11.2026).
        seller_count: new Set([...confirmedSellers, ...vHolds.map((h) => h.sellerId)]).size,
        confirmed_slots: confirmedSlots,
        confirmed_full_booking: confirmedFullBooking,
        has_pending_hold: vHolds.length > 0,
        pending_holds: vHolds.length,
        has_my_pending_hold: mineHolds.length > 0,
        awaiting_until: awaitingUntil,
        break_until: breakShown ? v.driver.breakUntil!.toISOString() : null,
        break_from: breakShown ? (v.driver.breakStartedAt?.toISOString() ?? null) : null,
        day_off: dayOff,
        company_job: job
          ? { id: job.id, tasks: job.tasks, until: job.until.toISOString(), created_by_name: job.createdByName }
          : null,
      });
    }

    const filtered = cards.filter((c) => {
      // A driver on leave is not for hire that day: he is never offered as
      // free; the busy list and Ertangi show him, greyed, with his dates.
      if (c.on_leave && view === 'free') return false;
      // "Polniy": not for hire today; the busy list shows him, greyed (owner, 12.11.2026).
      if (c.day_off && view === 'free') return false;
      if (c.day_off && view === 'busy') return true;
      if (c.on_leave && view === 'tomorrow') return true;
      // An off-shift lorry with work on it is a booked lorry whose driver has
      // not clocked in yet: it belongs with the busy ones, not the free ones.
      const loaded = c.confirmed_slots > 0 || c.has_pending_hold;
      if (view === 'free') return c.board_status === 'free' || (c.board_status === 'offduty' && !loaded);
      if (view === 'tomorrow') return c.board_status === 'free' || c.board_status === 'booked'; // pre-bookable
      if (view === 'mine') return c.my_slots > 0 || c.has_my_pending_hold;
      if (c.on_leave) return true;
      if (c.board_status === 'offduty' && loaded) return true;
      // Busy means carrying work. An off-shift truck is not busy, and it was
      // appearing in both lists: with nobody clocked in, "free" and "busy"
      // showed the same 21 trucks and the seller had to hunt. Off-shift ones
      // stay in the free list, under their own heading, where they can still
      // be booked for later.
      return c.board_status === 'booked' || c.board_status === 'full'; // busy
    });

    // Ertangi: the free lorries on top, the ones already booked below them.
    // Still bookable — a second seller's bron queues after the first.
    if (view === 'tomorrow') {
      // On leave goes last of all, under its own line.
      const rank = (c: (typeof filtered)[number]) =>
        c.on_leave || c.day_off ? 2 : c.confirmed_slots > 0 || c.has_pending_hold ? 1 : 0;
      filtered.sort((a, b) => rank(a) - rank(b));
    }

    return {
      // Two columns by size, as the seller sees the lorries: KATTA is the
      // Gazels and the Isuzu (orta + katta), YENGIL the Damas, Labo and Cobalt
      // (kichik). The pay class is separate — a Gazel is paid as orta (30.10.2026).
      katta: filtered.filter((c) => c.category === 'katta' || c.category === 'orta'),
      yengil: filtered.filter((c) => c.category !== 'katta' && c.category !== 'orta'),
    };
  }

  // --- Vehicle queue (orders + awaiting holds) ---
  async vehicleQueue(vehicleId: string, actor: Actor): Promise<VehicleQueue> {
    const now = new Date();
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId }, include: { driver: true } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    const orders = vehicle.driver
      ? await this.prisma.order.findMany({
          where: {
            assignedDriverId: vehicle.driver.id,
            // Bookings carry a kind; a return booked from the board carries
            // none, is on the lorry all the same, and may still await the accept.
            OR: [
              { bookingKind: { not: null }, status: { in: [...OCCUPYING] } },
              { kind: 'vozvrat', status: { in: [...OCCUPYING, 'assigned_to_driver'] } },
            ],
          },
          include: SELLER_ORDER_INCLUDE,
          orderBy: { queuePosition: 'asc' },
        })
      : [];
    const rawHolds = await this.prisma.reservation.findMany({
      where: { vehicleId, status: 'awaiting' },
      include: { seller: { select: { name: true } } },
      orderBy: { queuePosition: 'asc' },
    });
    // Drop expired-but-not-yet-swept holds.
    const holds = rawHolds.filter((h) => !h.fillDeadline || h.fillDeadline.getTime() > now.getTime());

    const hostOf = coloadHosts(orders);
    // The Polniy holder's way back in (owner, 02.11.2026): once his first
    // order was saved and the window closed, the card said "to'ldi" and
    // offered him nothing, though the whole lorry is his for the day. The
    // group his committed order belongs to is where the next slot is added.
    const myFull = orders.find((o) => o.fullBooking && o.createdBySellerId === actor.userId && holdsLorry(o));
    const myGroup = myFull
      ? await this.prisma.reservation.findFirst({ where: { orderId: myFull.id, mode: 'full' }, select: { groupId: true } })
      : null;

    return {
      my_full_group_id: myGroup?.groupId ?? null,
      orders: orders.map((o) => this.toSellerOrder(o, actor.userId, hostOf.get(o.id) ?? null, actor.role !== 'seller')),
      holds: holds.map((h) => ({
        reservation_id: h.id,
        group_id: h.groupId ?? null,
        kind: h.kind as BookingKind,
        full_booking: h.fullBooking,
        is_backhaul: h.isBackhaul,
        booked_by_name: h.seller?.name ?? null,
        fill_deadline: h.fillDeadline ? h.fillDeadline.toISOString() : null,
        mine: h.sellerId === actor.userId,
      })),
    };
  }

  // --- Reserve (creates a booking session) ---
  async reserve(vehicleId: string, input: ReserveInput, actor: Actor): Promise<ReserveResult> {
    return this.createSession(vehicleId, actor, {
      kind: input.kind,
      mode: input.mode,
      backhaul: false,
      scheduledDate: parseDay(input.scheduled_date),
      startAfterNine: input.start_after_nine === true,
    });
  }

  /** Add a backhaul (po puti) session — requires an existing order on the truck that allows it. */
  /**
   * Which trucks can take this cargo as a co-load.
   *
   * The seller describes the load first and picks a truck from the answer —
   * the reverse of reservePoputi, where a truck is chosen and held for seven
   * minutes before anyone knows whether the cargo fits. Nothing is reserved
   * here, so a search that finds nothing costs the seller nothing.
   */
  async searchPoputi(input: PoputiSearchInput, actor: Actor): Promise<PoputiSearchResult> {
    const client = await this.prisma.client.findUnique({ where: { id: input.client_id } });
    if (!client || !clientVisibleTo(client, actor as ClientActor)) throw new BadRequestException('client_not_found');
    if (client.lat == null || client.lng == null) {
      throw new BadRequestException('poputi_missing_coordinates');
    }

    const placeIds = [...new Set(input.pickup_place_ids)];
    const places = await this.prisma.pickupPlace.findMany({ where: { id: { in: placeIds } } });
    if (places.length !== placeIds.length) throw new BadRequestException('unknown_pickup_place');
    if (places.some((p) => p.lat == null || p.lng == null)) {
      throw new BadRequestException('poputi_missing_coordinates');
    }

    const probe: PoputiProbe = {
      pickups: places.map((p) => ({ lat: p.lat!, lng: p.lng! })),
      delivery: { lat: client.lat, lng: client.lng },
      weight_kg: input.weight_kg ?? null,
      length_cm: input.length_cm ?? null,
    };

    const { matches, nearMisses } = await this.poputi.search(probe, actor.userId);
    const todayLabel = today();
    const laterDay = (at: Date | null) => {
      if (!at) return null;
      const day = tashkentDateLabel(at);
      return day.getTime() > todayLabel.getTime() ? day.toISOString().slice(0, 10) : null;
    };
    return {
      matches: matches.map(({ candidate, fit, pickupEta }) => ({
        vehicle_id: candidate.vehicle.id,
        model: candidate.vehicle.model,
        plate_number: candidate.vehicle.plateNumber,
        category: (candidate.vehicle.category ?? 'kichik') as PoputiSearchResult['matches'][number]['category'],
        capacity_kg: candidate.vehicle.capacityKg,
        driver_name: candidate.driverName,
        heading_to: candidate.headingTo,
        detour_km: fit.detour_km,
        detour_seconds: fit.detour_seconds,
        sequence: fit.sequence,
        later_day: laterDay(candidate.hostDeliveryAt),
        host_order_id: fit.host_order_id ?? null,
        reys: fit.reys ?? null,
        // A later day's trip shows its date instead of a time.
        pickup_eta: laterDay(candidate.hostDeliveryAt) ? null : (pickupEta?.toISOString() ?? null),
      })),
      near_misses: nearMisses.map(({ candidate, rejection }) => ({
        vehicle_id: candidate.vehicle.id,
        model: candidate.vehicle.model,
        plate_number: candidate.vehicle.plateNumber,
        driver_name: candidate.driverName,
        reason: rejection.reason as PoputiSearchResult['near_misses'][number]['reason'],
        // Metres are what the rule measures; kilometres are what a seller reads.
        over_by_km: rejection.overByM != null ? round1(rejection.overByM / 1000) : null,
        pickups_allowed: rejection.pickupsAllowed ?? null,
        pickups_offered: rejection.pickupsOffered ?? null,
        over_capacity_kg: rejection.overCapacityKg ?? null,
      })),
    };
  }

  async reservePoputi(vehicleId: string, actor: Actor, hostOrderId: string | null = null): Promise<ReserveResult> {
    // Cheap precheck only: the full fence test needs the cargo's coordinates,
    // which arrive at fill(). This catches the cases no form could satisfy —
    // nothing running, consent withheld, offline, or every pickup collected.
    const gate = (await this.poputi.planForVehicle(vehicleId, PRECHECK_PROBE, hostOrderId, actor.userId)).fit;
    if (gate.reason && PRECHECK_BLOCKERS.includes(gate.reason)) {
      throw new BadRequestException(`poputi_${gate.reason}`);
    }
    // The co-load goes on the day the truck's own order goes: a truck booked
    // for tomorrow takes it tomorrow (owner, 29.10.2026).
    // The day of the order the seller picked it to ride with (owner, 10.11.2026).
    const host = await this.poputi.hostOf(vehicleId, hostOrderId);
    const hostDay = host ? tashkentDateLabel(host.deliveryDatetime) : today();
    const later = hostDay.getTime() > today().getTime();
    return this.createSession(vehicleId, actor, {
      kind: 'bron',
      mode: 'single',
      backhaul: true,
      scheduledDate: later ? hostDay : today(),
      startAfterNine: later ? host!.startAfterNine : false,
    });
  }

  private async createSession(
    vehicleId: string,
    actor: Actor,
    opts: { kind: BookingKind; mode: BookingMode; backhaul: boolean; scheduledDate: Date; startAfterNine?: boolean },
  ): Promise<ReserveResult> {
    const now = new Date();
    const todayLabel = today(now);
    if (opts.scheduledDate.getTime() < todayLabel.getTime()) throw new BadRequestException('scheduled_date_in_past');
    // Every active form is a short capacity hold, including Ertangi bookings.
    const deadline = new Date(now.getTime() + FILL_WINDOW_MS);
    const dayEnd = new Date(opts.scheduledDate.getTime() + DAY_MS);
    const fullBooking = opts.mode === 'full';
    const groupId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent reservations on this vehicle (seller / Polniy caps).
      await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`;
      const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId }, include: { driver: true } });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      if (!vehicle.driver) throw new BadRequestException('vehicle_has_no_driver');
      // The card says "remontda — band qilib bo'lmaydi"; the server keeps that promise.
      if (vehicle.status === 'maintenance') throw new ConflictException('vehicle_in_repair');
      // "Polniy" today: he is not coming back today (owner, 12.11.2026).
      if (
        opts.scheduledDate.getTime() === todayLabel.getTime() &&
        vehicle.driver.currentStatus === 'offline' &&
        (await dayOffDrivers(tx, [vehicle.driver.id], now)).size > 0
      ) {
        throw new ConflictException('driver_day_off');
      }
      // A driver who has not opened his shift yet is not a reason to refuse the
      // booking: he arrives, presses Ish boshlandi, and the work is waiting for
      // him. The board says so on the card, which is where the seller decides.
      // Po puti too: the co-load waits for him with the order it rides with.

      // Occupancy caps, scoped to the booking's calendar day. An awaiting slot (or its
      // committed order) always represents a seller's hold — queued slots need not be counted.
      const rawHolds = await tx.reservation.findMany({
        where: { vehicleId, status: 'awaiting', scheduledDate: { gte: opts.scheduledDate, lt: dayEnd } },
        select: { sellerId: true, fullBooking: true, queuePosition: true, fillDeadline: true },
      });
      const holds = rawHolds.filter((h) => !h.fillDeadline || h.fillDeadline.getTime() > now.getTime());
      const orders = (
        await tx.order.findMany({
          where: {
            assignedDriverId: vehicle.driver.id,
            status: { in: [...OCCUPYING] },
            deliveryDatetime: { lt: dayEnd },
          },
          select: { status: true, returnDeferredAt: true, createdBySellerId: true, fullBooking: true, queuePosition: true, deliveryDatetime: true, bookingKind: true, startAfterNine: true },
        })
      ).filter((o) => holdsLorry(o) && occupiesDay(o, opts.scheduledDate, now));
      const sellers = new Set<string>([...holds.map((h) => h.sellerId), ...orders.map((o) => o.createdBySellerId)]);
      const isFull = holds.some((h) => h.fullBooking) || orders.some((o) => o.fullBooking);

      if (opts.backhaul) {
        const allowed = await tx.order.count({
          where: {
            assignedDriverId: vehicle.driver.id,
            // Or a vozvrat carrying its goods back (owner, 11.11.2026).
            OR: [
              { status: { in: [...OCCUPYING] }, poputiAllowed: true },
              { kind: 'vozvrat', status: 'returning' },
            ],
          },
        });
        if (allowed === 0) throw new BadRequestException('poputi_not_allowed');
      } else {
        if (isFull) throw new ConflictException('vehicle_full');
        const isNewSeller = !sellers.has(actor.userId);
        if (isNewSeller && sellers.size >= MAX_SELLERS_PER_TRUCK) throw new ConflictException('vehicle_full');
        const othersPresent = [...sellers].some((s) => s !== actor.userId);
        if (fullBooking && othersPresent) throw new ConflictException('vehicle_full');
      }

      const base = Math.max(0, ...holds.map((h) => h.queuePosition), ...orders.map((o) => o.queuePosition ?? 0));
      // single / full / backhaul → 1 active slot; double → 1 active + 1 queued (order 2).
      const plan: { seq: number; status: 'awaiting' | 'queued'; dl: Date | null }[] =
        opts.mode === 'double'
          ? [
              { seq: 0, status: 'awaiting', dl: deadline },
              { seq: 1, status: 'queued', dl: null },
            ]
          : [{ seq: 0, status: 'awaiting', dl: deadline }];
      for (const p of plan) {
        await tx.reservation.create({
          data: {
            vehicleId,
            sellerId: actor.userId,
            kind: opts.kind,
            groupId,
            mode: opts.mode,
            sequenceIndex: p.seq,
            fullBooking,
            isBackhaul: opts.backhaul,
            status: p.status,
            scheduledDate: opts.scheduledDate,
            // Only an Ertangi booking can wait for nine; today's starts now.
            startAfterNine: opts.startAfterNine === true && opts.scheduledDate.getTime() > todayLabel.getTime(),
            fillDeadline: p.dl,
            queuePosition: base + 1 + p.seq,
          },
        });
      }
    });
    return this.toSession(groupId, null, actor.userId);
  }

  /** Add the next order to a full (Polniy) session — dynamic, after the previous is committed. */
  async addNext(groupId: string, actor: Actor): Promise<BookingSession> {
    const slots = await this.prisma.reservation.findMany({ where: { groupId }, orderBy: { sequenceIndex: 'asc' } });
    if (slots.length === 0) throw new NotFoundException('Booking not found');
    const head = slots[0];
    if (head.sellerId !== actor.userId) throw new ForbiddenException('Not your booking');
    if (head.mode !== 'full') throw new BadRequestException('add_only_for_full');
    const open = slots.filter((s) => s.status === 'awaiting' || s.status === 'queued');
    if (slots.length >= MAX_FULL_BOOKING_ORDERS) throw new ConflictException('too_many_orders');
    // He has the whole lorry, and he knows how many drops he is making before
    // he has typed the first one. A slot added while another is still open
    // waits its turn — queued, no timer — and fill() opens it when the one in
    // front is saved. Only when nothing is open does the new slot take the
    // seven minutes itself.
    const queueBehind = open.length > 0;
    const seq = Math.max(...slots.map((s) => s.sequenceIndex)) + 1;
    await this.prisma.reservation.create({
      data: {
        vehicleId: head.vehicleId,
        sellerId: actor.userId,
        kind: head.kind,
        groupId,
        mode: 'full',
        sequenceIndex: seq,
        fullBooking: true,
        isBackhaul: false,
        status: queueBehind ? 'queued' : 'awaiting',
        scheduledDate: head.scheduledDate,
        startAfterNine: head.startAfterNine,
        fillDeadline: queueBehind ? null : new Date(Date.now() + FILL_WINDOW_MS),
        queuePosition: head.queuePosition + seq,
      },
    });
    return this.toSession(groupId, null, actor.userId);
  }

  /** The current state of a booking session (its ordered slots + committed orders). */
  async getBooking(groupId: string, actor: Actor): Promise<BookingSession> {
    const head = await this.prisma.reservation.findFirst({ where: { groupId } });
    if (!head) throw new NotFoundException('Booking not found');
    if (head.sellerId !== actor.userId) throw new ForbiddenException('Not your booking');
    return this.toSession(groupId, null, actor.userId);
  }

  // --- Fill (Band qilish) → binding order; returns the updated session ---
  async fill(reservationId: string, input: FillOrderInput, actor: Actor): Promise<BookingSession> {
    const res = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { vehicle: { include: { driver: true } } },
    });
    if (!res) throw new NotFoundException('Reservation not found');
    if (res.sellerId !== actor.userId) throw new ForbiddenException('Not your reservation');
    if (res.status !== 'awaiting') throw new ConflictException('reservation_not_awaiting');
    // Only today's holds have a timer; future (Ertangi) holds never expire.
    if (res.fillDeadline && res.fillDeadline.getTime() <= Date.now()) {
      await this.prisma.reservation.update({ where: { id: res.id }, data: { status: 'expired' } });
      throw new ConflictException('reservation_expired');
    }
    const driver = res.vehicle.driver;
    if (!driver) throw new BadRequestException('vehicle_has_no_driver');

    const client = await this.prisma.client.findUnique({ where: { id: input.client_id } });
    // The seller books for their own client only.
    if (!client || !clientVisibleTo(client, actor as ClientActor)) throw new BadRequestException('client_not_found');
    const cargo = await this.prisma.cargoType.findUnique({ where: { id: input.cargo_type_id } });
    if (!cargo) throw new BadRequestException('cargo_type_not_found');

    const placeIds = [...new Set(input.pickup_sources.map((s) => s.pickup_place_id))];
    const places = await this.prisma.pickupPlace.findMany({ where: { id: { in: placeIds } } });
    const placeById = new Map(places.map((p) => [p.id, p]));
    if (placeIds.some((id) => !placeById.has(id))) throw new BadRequestException('unknown_pickup_place');

    this.assertWithinLimit(res.vehicle, input);
    // Po puti counts the truck's load, so neither side may leave it blank:
    // the order riding po puti, and an order that opens itself to one (owner, 10.11.2026).
    if ((res.isBackhaul || input.poputi_allowed) && !input.weight_kg) {
      throw new BadRequestException('poputi_weight_required');
    }

    // Set for a co-load: the merged trip the driver will actually drive.
    let coload: Awaited<ReturnType<PoputiService['planForVehicle']>> | null = null;

    // A po puti order rides *with* the order already on the truck, so it has to
    // clear the fence rules. This is the first point where we know where the
    // cargo is going — at reserve time the seller has not filled the form yet.
    if (res.isBackhaul) {
      const pins = input.pickup_sources.map((src) => placeById.get(src.pickup_place_id)!);
      if (pins.some((p) => p.lat == null || p.lng == null) || client.lat == null || client.lng == null) {
        throw new BadRequestException('poputi_missing_coordinates');
      }
      const plan = await this.poputi.planForVehicle(
        res.vehicleId,
        {
          pickups: pins.map((p) => ({ lat: p.lat!, lng: p.lng! })),
          delivery: { lat: client.lat, lng: client.lng },
          weight_kg: input.weight_kg ?? null,
          length_cm: input.length_cm ?? null,
        },
        // The order on the truck the seller picked from the search (owner, 10.11.2026).
        input.poputi_host_order_id ?? null,
        actor.userId,
      );
      if (!plan.fit.eligible) throw new BadRequestException(`poputi_${plan.fit.reason}`);
      coload = plan;
    }

    // The fence assignment *is* the driving order, so the sequence index is the
    // trip position. Candidate stops are numbered here and written inline with
    // the rows they belong to; the host's existing rows are updated below.
    const tripOf = new Map<string, number>();
    coload?.sequence.forEach((stop, i) => {
      if (stop.belongsTo === 'candidate') {
        tripOf.set(stop.kind === 'client' ? 'candidate:client' : `candidate:${stop.candidateIndex}`, i);
      } else {
        // By row (owner, 11.11.2026): a pickup source, or an order's own delivery —
        // the host's, or a po puti's already aboard on a merged trip.
        tripOf.set(stop.pickupSourceId ? `src:${stop.pickupSourceId}` : `order:${stop.orderId ?? coload!.hostOrderId}`, i);
      }
    });

    // Booking a truck is the other way an order is born, so it reads the
    // client's places by the same rule: the one chosen, else the default.
    const deliveryPlace = await this.clientAddresses.forOrder(client.id, input.client_address_id);

    const order = await this.prisma.$transaction(async (tx) => {
      // Two sellers adding a po puti to one truck at the same moment (owner,
      // 10.11.2026): the truck's row is locked and "already carries one" is
      // asked again here, so the second one is refused instead of both
      // writing trip positions over each other.
      if (coload) {
        await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${res.vehicleId} FOR UPDATE`;
        const aboard = await tx.order.findMany({
          where: {
            assignedDriverId: driver.id,
            status: { in: [...ACTIVE_ORDER_STATUSES] },
            isBackhaul: true,
            OR: [{ deliveryTripPosition: { not: null } }, { pickupSources: { some: { tripPosition: { not: null } } } }],
          },
          select: { createdBySellerId: true },
        });
        // A second po puti on the trip only from the seller already on it (owner, 11.11.2026).
        if (aboard.length > 0 && (aboard.length >= POPUTI_MAX_PER_SELLER || aboard.some((o) => o.createdBySellerId !== actor.userId))) {
          throw new BadRequestException('poputi_poputi_taken');
        }
      }
      const created = await tx.order.create({
        data: {
          clientId: client.id,
          clientAddressId: deliveryPlace?.id ?? null,
          clientName: client.name,
          clientPhoneNumber: client.phoneNumber,
          clientAddress: clientAddressText(deliveryPlace, client),
          // Today's bookings deliver now; pre-booked (Ertangi) ones carry their scheduled day.
          deliveryDatetime: res.scheduledDate.getTime() === today().getTime() ? new Date() : res.scheduledDate,
          startAfterNine: res.scheduledDate.getTime() === today().getTime() ? false : res.startAfterNine,
          comment: input.comment ?? null,
          status: 'driver_accepted', // binding — no driver accept step
          createdBySellerId: actor.userId,
          assignedDriverId: driver.id,
          // Delivery region/district are snapshotted from the place chosen,
          // which is the client's own geo when it has a single address.
          regionCode: deliveryPlace?.regionCode ?? client.regionCode,
          geoDistrictCode: deliveryPlace?.districtCode ?? client.districtCode,
          deliveryLat: deliveryPlace?.lat ?? client.lat,
          deliveryLng: deliveryPlace?.lng ?? client.lng,
          deliveryTripPosition: tripOf.get('candidate:client') ?? null,
          bookingKind: res.kind,
          fullBooking: res.fullBooking,
          isBackhaul: res.isBackhaul,
          poputiDetourSeconds: coload ? (coload.fit.host_delay_seconds ?? coload.fit.detour_seconds ?? null) : null,
          // A po puti order rides with another seller's: it cannot open
          // po puti itself (owner, 09.11.2026), whatever the form sent.
          poputiAllowed: res.isBackhaul ? false : input.poputi_allowed,
          // No per-order limit any more (owner, 11.11.2026): urgent means po puti off.
          poputiMaxDelayMin: null,
          cargoTypeId: cargo.id,
          weightKg: input.weight_kg ?? null,
          lengthCm: input.length_cm ?? null,
          widthCm: input.width_cm ?? null,
          heightCm: input.height_cm ?? null,
          overLimitAttested: input.over_limit_attested,
          waybillSource: input.waybill_source ?? null,
          queuePosition: res.queuePosition,
          pickupSources: {
            // Geo is snapshotted from the pickup place itself, so the city/outside
            // pickup bonus never depends on per-order data entry.
            create: input.pickup_sources.map((s, i) => {
              const place = placeById.get(s.pickup_place_id)!;
              return {
                pickupPlaceId: place.id,
                name: place.name,
                regionCode: place.regionCode,
                geoDistrictCode: place.geoDistrictCode,
                lat: place.lat,
                lng: place.lng,
                position: i,
                tripPosition: tripOf.get(`candidate:${i}`) ?? null,
              };
            }),
          },
          items: {
            create: input.pickup_sources.map((s) => ({
              productName: cargo.name,
              quantity: 1,
              pickupPlaceId: s.pickup_place_id,
              pickupPlaceName: placeById.get(s.pickup_place_id)!.name,
            })),
          },
        },
        include: SELLER_ORDER_INCLUDE,
      });
      await tx.driverAssignment.create({
        data: {
          orderId: created.id,
          driverId: driver.id,
          deliveryDatetime: created.deliveryDatetime,
          createdById: actor.userId,
          assignmentStatus: 'accepted',
        },
      });
      // Today's booking makes him busy now; an Ertangi one waits for its 03:00
      // opening — the status sweep and his first pickup take it from there.
      await settleDriverStatus(tx, driver.id);
      // Conditional: a second submit that slipped past the check above finds
      // the hold already filled and the whole transaction, order included, rolls back.
      const filled = await tx.reservation.updateMany({
        where: { id: res.id, status: 'awaiting' },
        data: { status: 'filled', orderId: created.id },
      });
      if (filled.count === 0) throw new ConflictException('reservation_not_awaiting');
      // Activate the next queued slot in this booking (2x order 2) with a fresh timer.
      if (res.groupId) {
        const next = await tx.reservation.findFirst({
          where: { groupId: res.groupId, status: 'queued', sequenceIndex: res.sequenceIndex + 1 },
        });
        if (next) {
          await tx.reservation.update({
            where: { id: next.id },
            data: { status: 'awaiting', fillDeadline: new Date(Date.now() + FILL_WINDOW_MS) },
          });
        }
      }
      // The host order is now part of a trip too — without its positions the
      // merged sequence would only be half written, and the cursor could not
      // tell whose stop comes first.
      if (coload?.hostOrderId) {
        for (const [key, tripPosition] of tripOf) {
          if (key.startsWith('order:')) {
            await tx.order.update({
              where: { id: key.slice('order:'.length) },
              data: { deliveryTripPosition: tripPosition },
            });
          } else if (key.startsWith('src:')) {
            await tx.orderPickupSource.update({
              where: { id: key.slice('src:'.length) },
              data: { tripPosition },
            });
          }
        }
      }

      // The first seller's client now has a latest time (owner, 11.11.2026);
      // the late watch tells that seller if the truck falls behind it.
      if (coload?.hostOrderId && coload.fit.host_deadline_seconds != null) {
        // Set by the first po puti; a second one does not move it (owner, 11.11.2026).
        await tx.order.updateMany({
          where: { id: coload.hostOrderId, poputiClientDeadlineAt: null },
          data: { poputiClientDeadlineAt: new Date(Date.now() + coload.fit.host_deadline_seconds * 1000), poputiLateToldAt: null },
        });
      }

      await emitOrderEvent(tx, OrderEventType.Assigned, created.id, { orderId: created.id, driverId: driver.id });
      return created;
    });

    this.realtime.orderStatusChanged(order.id, order.status, driver.id);
    // The seller whose order it rides with hears it at once (owner, 10.11.2026).
    if (coload?.hostOrderId) void this.tellHostSeller(coload.hostOrderId, coload.fit.host_delay_seconds ?? coload.fit.detour_seconds ?? null);
    this.realtime.driverStatusChanged(driver.id);
    return this.toSession(res.groupId, res.id, actor.userId);
  }

  private async tellHostSeller(hostOrderId: string, detourSeconds: number | null): Promise<void> {
    if (!this.notifications) return;
    try {
      const host = await this.prisma.order.findUnique({
        where: { id: hostOrderId },
        select: { createdBySellerId: true, clientName: true, orderNumber: true },
      });
      if (!host) return;
      const min = detourSeconds != null ? Math.round(detourSeconds / 60) : null;
      await this.notifications.notify(host.createdBySellerId, {
        type: 'poputi.joined',
        title: "Zakazingizga po puti qo'shildi",
        body:
          min != null
            ? `№${host.orderNumber} (${host.clientName}): zakazingiz mijozga taxminan ${min} daqiqa kechroq yetib boradi.`
            : `№${host.orderNumber} (${host.clientName}) mashinasiga boshqa sotuvchining yuki qo'shildi.`,
        relatedOrderId: hostOrderId,
      });
    } catch {
      // A push that fails does not undo the booking.
    }
  }

  // --- Cancel an awaiting hold (Zakazni Otmen, before commit) ---
  async cancel(reservationId: string, actor: Actor): Promise<{ cancelled: true }> {
    const res = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!res) throw new NotFoundException('Reservation not found');
    if (res.sellerId !== actor.userId) throw new ForbiddenException('Not your reservation');
    if (res.status !== 'awaiting') throw new ConflictException('reservation_not_awaiting');
    await this.prisma.$transaction(async (tx) => {
      // Conditional (06.11.2026): a fill landing between the read and here
      // must not see its live order's reservation marked cancelled.
      const done = await tx.reservation.updateMany({ where: { id: res.id, status: 'awaiting' }, data: { status: 'cancelled' } });
      if (done.count === 0) throw new ConflictException('reservation_not_awaiting');
      // Cancelling an order drops the rest of its booking — queued siblings can't be reached.
      if (res.groupId) {
        await tx.reservation.updateMany({
          where: { groupId: res.groupId, status: 'queued' },
          data: { status: 'cancelled' },
        });
      }
    });
    return { cancelled: true };
  }

  /** Expire holds whose fill-timer ran out (called by the poller). */
  async expireStale(): Promise<number> {
    const stale = await this.prisma.reservation.findMany({
      where: { status: 'awaiting', fillDeadline: { not: null, lte: new Date() } },
      select: { id: true, groupId: true },
    });
    if (stale.length === 0) return 0;
    const groupIds = stale.map((s) => s.groupId).filter((g): g is string => !!g);
    await this.prisma.$transaction([
      this.prisma.reservation.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { status: 'expired' },
      }),
      // Queued siblings of an expired active slot are now unreachable.
      this.prisma.reservation.updateMany({
        where: { groupId: { in: groupIds }, status: 'queued' },
        data: { status: 'expired' },
      }),
    ]);
    return stale.length;
  }

  /** Build the session view for a booking group (or a single legacy reservation). */
  private async toSession(
    groupId: string | null,
    fallbackId: string | null,
    sellerId: string,
  ): Promise<BookingSession> {
    const where = groupId ? { groupId } : { id: fallbackId ?? '' };
    const slots = await this.prisma.reservation.findMany({
      where: { ...where, status: { in: ['awaiting', 'queued', 'filled'] } },
      include: { order: { include: SELLER_ORDER_INCLUDE } },
      orderBy: { sequenceIndex: 'asc' },
    });
    const head = slots[0];
    const toSlot = (s: (typeof slots)[number]): BookingSlot => ({
      reservation_id: s.id,
      sequence_index: s.sequenceIndex,
      status: s.status as BookingSlot['status'],
      is_backhaul: s.isBackhaul,
      fill_deadline: s.fillDeadline ? s.fillDeadline.toISOString() : null,
      order: s.order ? this.toSellerOrder(s.order, sellerId) : null,
    });
    return {
      group_id: groupId ?? fallbackId ?? '',
      mode: (head?.mode ?? 'single') as BookingMode,
      vehicle_id: head?.vehicleId ?? '',
      slots: slots.map(toSlot),
    };
  }

  // --- Helpers ---
  private categoryOf(v: { category: string | null; type: string }): VehicleCategory {
    if (v.category === 'katta' || v.category === 'orta' || v.category === 'kichik') {
      return v.category;
    }
    // Fallback from the raw vehicle type when the class hasn't been set yet.
    if (v.type === 'truck') return 'katta';
    // Damas, Labo, Cobalt: the light column.
    if (v.type === 'van' || v.type === 'car') return 'kichik';
    return 'orta';
  }

  private assertWithinLimit(
    v: { capacityKg: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null },
    input: FillOrderInput,
  ): void {
    if (v.capacityKg != null && input.weight_kg != null && input.weight_kg > v.capacityKg) {
      throw new BadRequestException('weight_exceeds_vehicle_capacity');
    }
    if (input.over_limit_attested) return;
    const over =
      (v.lengthCm != null && input.length_cm != null && input.length_cm > v.lengthCm) ||
      (v.widthCm != null && input.width_cm != null && input.width_cm > v.widthCm) ||
      (v.heightCm != null && input.height_cm != null && input.height_cm > v.heightCm);
    if (over) throw new BadRequestException('over_limit_requires_attestation');
  }

  /**
   * The client called: the Ertangi order is wanted first thing after all, or
   * can wait until 09:00. Only his own, and only before the driver has set
   * off; the driver hears it at once.
   */
  async setStartTime(orderId: string, startAfterNine: boolean, actor: Actor): Promise<{ id: string; start_after_nine: boolean }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, startAfterNine: true, createdBySellerId: true, assignedDriverId: true, bookingKind: true, deliveryDatetime: true },
    });
    if (!order || order.createdBySellerId !== actor.userId) throw new NotFoundException('order_not_found');
    if (order.startAfterNine === startAfterNine) return { id: order.id, start_after_nine: startAfterNine };
    if (!['created', 'assigned_to_driver', 'driver_accepted'].includes(order.status)) {
      throw new ConflictException('order_already_started');
    }
    // Waiting for nine only means something for an Ertangi order not yet open.
    if (startAfterNine && isActionable(order)) throw new ConflictException('order_already_open');
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { startAfterNine } });
      await tx.reservation.updateMany({ where: { orderId: order.id }, data: { startAfterNine } });
      await emitOrderEvent(
        tx,
        startAfterNine ? OrderEventType.StartMovedLater : OrderEventType.StartMovedEarlier,
        order.id,
        { orderId: order.id },
      );
    });
    this.realtime.orderStatusChanged(order.id, order.status, order.assignedDriverId);
    return { id: order.id, start_after_nine: startAfterNine };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toSellerOrder(o: any, sellerId: string, ridesWithOrderId: string | null = null, seesAll = false): SellerOrder {
    return {
      id: o.id,
      order_number: o.orderNumber,
      status: o.status,
      booking_kind: o.bookingKind ?? null,
      start_after_nine: o.startAfterNine ?? false,
      actions_available_at: o.deliveryDatetime ? driverActionsAvailableAt(o)?.toISOString() ?? null : null,
      is_vozvrat: o.kind === 'vozvrat',
      is_backhaul: o.isBackhaul,
      full_booking: o.fullBooking,
      poputi_allowed: o.poputiAllowed,
      poputi_detour_min: o.poputiDetourSeconds != null ? Math.round(o.poputiDetourSeconds / 60) : null,
      cargo_type_name: o.cargoType?.name ?? null,
      weight_kg: o.weightKg ?? null,
      // Whose client it is stays with whoever booked them. A colleague looking
      // at the same lorry needs to know it is taken and where it is going; the
      // name on the order is not his to read.
      // The office sees every client (owner, 05.11.2026).
      client_name: o.createdBySellerId === sellerId || seesAll ? (o.clientName ?? null) : null,
      district_name: o.geoDistrict?.name ?? null,
      waybill_source: o.waybillSource ?? null,
      booked_by_name: o.createdBySeller?.name ?? null,
      mine: o.createdBySellerId === sellerId,
      problem_reason: o.problemReason ?? null,
      problem_comment: o.problemComment ?? null,
      return_items_written: o._count?.returnItems ?? 0,
      return_items_confirmed: o.returnItemsConfirmedAt != null,
      carried_over: carriedOver(o),
      pickup_sources: (o.pickupSources ?? []).map(
        (s: {
          name: string;
          legStatus: string;
          tripPosition?: number | null;
          geoDistrict?: { name: string } | null;
        }) => ({
          name: s.name,
          district_name: s.geoDistrict?.name ?? null,
          leg_status: s.legStatus as SellerOrder['pickup_sources'][number]['leg_status'],
          trip_position: s.tripPosition ?? null,
        }),
      ),
      delivery_trip_position: o.deliveryTripPosition ?? null,
      rides_with_order_id: ridesWithOrderId,
      fill_deadline: null,
      created_at: o.createdAt.toISOString(),
    };
  }
}

const ACTIVE_STATUS_SET = new Set<string>(ACTIVE_ORDER_STATUSES);

/** The latest "not today" on an order that is still open — a delivered one has nothing left to say. */
function carriedOver(o: {
  status: string;
  carryOvers?: { reason: string; comment: string | null; createdAt: Date }[];
}): SellerOrder['carried_over'] {
  const c = o.carryOvers?.[0];
  if (!c || !ACTIVE_STATUS_SET.has(o.status)) return null;
  return { reason: c.reason as CarryOverReason, comment: c.comment, at: c.createdAt.toISOString() };
}

/** One decimal is the precision a 5 km rule deserves; more reads as false accuracy. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Whether this truck could take a co-load at all — the vehicle-level half of the
 * po puti rules, which is all the board can answer without knowing the cargo.
 * The seller's own load is tested by the search.
 */
function isPoputiOpen(
  host: { poputiAllowed: boolean; pickupSources: { legStatus: string }[] } | undefined,
): boolean {
  if (!host || !host.poputiAllowed) return false;
  // Rule 3: with every pickup collected there is no fence left to add work to.
  return host.pickupSources.some((s) => s.legStatus !== 'arrived');
}
