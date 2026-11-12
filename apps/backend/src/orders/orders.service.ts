import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { pickHomePlaces, returnPlaceOf, type HomePlaces } from './return-place';
import type { Order, OrderItem, Prisma } from '@prisma/client';
import {
  ACTIVE_ORDER_STATUSES,
  BLOCKING_ACTIVE_ORDER_STATUSES,
  type CarryOverReason,
  CANCELLABLE_ORDER_STATUSES,
  canTransitionOrderStatus,
  culpritOf,
  type CreateOrderInput,
  type CreateVozvratOrderInput,
  type DriverNextAction,
  type OrderKind,
  type ItemCollectionStatus,
  type LegStatus,
  type OrderExceptionInput,
  type OrderFilterInput,
  type OrderItemPublic,
  type OrderPage,
  type OrderPickupSourcePublic,
  type OrderPriority,
  type OrderPublic,
  type OrderReturnInput,
  type OrderStats,
  type OrderStatus,
  PROBLEM_REPORTABLE_ORDER_STATUSES,
  type ReturnDestination,
  type ReturnItemPublic,
  type ReturnStage,
  type Role,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { tashkentDayStartUtc } from '../common/tashkent-time';
import { VozvratReportService } from '../vozvrat/vozvrat-report.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShiftEndCheckService } from '../drivers/shift-end-check.service';
import { vozvratPayload } from '../vozvrat/vozvrat-payload';
import { driverActionsAvailableAt } from './order-timing';
import { settleDriverStatus } from '../drivers/driver-status';
import { clientVisibleTo } from '../clients/clients.service';
import { ClientAddressesService, clientAddressText } from '../clients/client-addresses.service';
import { BonusService } from '../bonus/bonus.service';
import { recordMorningPress, type MorningAction } from './morning-start';
import { RealtimeService } from '../realtime/realtime.service';
import { applyWatermark } from '../upload/watermark';
import { emitOrderEvent, OrderEventType } from '../outbox/events';

type Actor = { userId: string; role: Role };
type DriverWithUser = { user: { name: string } };
type PickupSourceRow = {
  id: string;
  pickupPlaceId: string;
  name: string;
  position: number;
  legStatus: LegStatus;
  loadPhotoUrl: string | null;
  returnRequired: boolean;
  returnDestination: string | null;
  returnStage: string | null;
  returnProofPhotoUrl: string | null;
  returnedAt: Date | null;
  lat: number | null;
  lng: number | null;
  tripPosition: number | null;
  region?: { name: string; isCity: boolean } | null;
  geoDistrict?: { name: string; region?: { isCity: boolean } | null } | null;
  pickupPlace?: { phoneNumber: string | null; supplier?: { phoneNumber: string | null } | null } | null;
  returnPlaceId?: string | null;
  returnPlace?: {
    id: string;
    name: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    phoneNumber: string | null;
    supplier?: { name: string; phoneNumber: string | null } | null;
  } | null;
};
/** The supplier's place the seller picked for a return, as a place (owner, 12.11.2026). */
function pickedPlace(p: PickupSourceRow) {
  const r = p.returnPlace;
  if (!r) return null;
  const supplier = r.supplier?.name;
  return {
    name: supplier && !r.name.toLowerCase().includes(supplier.toLowerCase()) ? `${supplier} · ${r.name}` : r.name,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    phone_number: r.phoneNumber || r.supplier?.phoneNumber || null,
    place_id: r.id,
  };
}

type OrderWithItems = Order & {
  items: OrderItem[];
  pickupSources: PickupSourceRow[];
  cargoType?: { name: string } | null;
  assignedDriver?: DriverWithUser | null;
  createdBySeller?: { name: string; phoneNumber: string; telegramId: string | null } | null;
  originalOrder?: { orderNumber: number } | null;
  region?: { name: string; isCity: boolean } | null;
  geoDistrict?: { name: string } | null;
  deliveryAddress?: { id: string; label: string } | null;
  carryOvers?: { reason: string; comment: string | null; createdAt: Date }[];
  _count?: { returnItems: number };
  returnItemsConfirmedBy?: { name: string } | null;
};

const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' as const } },
  pickupSources: {
    include: {
      region: { select: { name: true, isCity: true } },
      geoDistrict: {
        select: { name: true, region: { select: { isCity: true } } },
      },
      pickupPlace: { select: { phoneNumber: true, supplier: { select: { phoneNumber: true } } } },
      // Ta'minotchi: the supplier's place picked by the seller (owner, 12.11.2026).
      returnPlace: {
        select: {
          id: true,
          name: true,
          address: true,
          lat: true,
          lng: true,
          phoneNumber: true,
          supplier: { select: { name: true, phoneNumber: true } },
        },
      },
    },
    orderBy: { position: 'asc' as const },
  },
  cargoType: { select: { name: true } },
  assignedDriver: { include: { user: { select: { name: true } } } },
  createdBySeller: { select: { name: true, phoneNumber: true, telegramId: true } },
  originalOrder: { select: { orderNumber: true } },
  region: { select: { name: true, isCity: true } },
  geoDistrict: { select: { name: true } },
  // Which of the client's places it is for, for its name on the screen.
  deliveryAddress: { select: { id: true, label: true } },
  // The latest "not today" the driver gave for it, for "Kechadan qolgan".
  carryOvers: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { reason: true, comment: true, createdAt: true } },
  // Whether anything was written up for the seller to check — the driver's
  // return legs wait on his answer, so the next action needs to know.
  _count: { select: { returnItems: true } },
  returnItemsConfirmedBy: { select: { name: true } },
};

/** Default page size when a caller does not specify `take` — bounds list queries. */
const DEFAULT_PAGE_SIZE = 100;

const ACTIVE_ORDER_STATUSES_SET = new Set<string>(ACTIVE_ORDER_STATUSES);

/** A journey that has left the yard: the order the driver is on right now. */
const JOURNEY_UNDER_WAY = ['collecting_items', 'items_collected', 'on_the_way', 'arrived_at_customer'] as const;

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersService.name);
  /** BIGANT's own sklad and do'kon, where a return can be sent; reread every 10 minutes. */
  private home: HomePlaces = {};
  private homeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonus: BonusService,
    private readonly realtime: RealtimeService,
    private readonly vozvrat: VozvratReportService,
    private readonly clientAddresses: ClientAddressesService,
    private readonly notifications: NotificationsService,
    private readonly shiftEnd?: ShiftEndCheckService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadHomePlaces();
    this.homeTimer = setInterval(() => void this.loadHomePlaces(), 10 * 60_000);
    this.homeTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.homeTimer) clearInterval(this.homeTimer);
  }

  private async loadHomePlaces(): Promise<void> {
    try {
      const places = await this.prisma.pickupPlace.findMany({
        where: { type: { in: ['warehouse', 'market'] } },
        select: { name: true, type: true, address: true, lat: true, lng: true, phoneNumber: true },
        orderBy: { createdAt: 'asc' },
      });
      this.home = pickHomePlaces(places);
    } catch (err) {
      this.logger.warn(`home places not loaded: ${(err as Error)?.message}`);
    }
  }

  async create(input: CreateOrderInput, actor: Actor): Promise<OrderPublic> {
    const createdByUserId = actor.userId;
    const client = await this.prisma.client.findUnique({ where: { id: input.client_id } });
    // A seller orders only for their own client.
    if (!client || !clientVisibleTo(client, actor)) {
      throw new NotFoundException('Client not found');
    }

    // Which of the client's places this goes to: the one chosen, else the
    // default. A client with one address behaves exactly as before.
    const deliveryPlace = await this.clientAddresses.forOrder(client.id, input.client_address_id);

    const placeIds = [...new Set(input.items.map((i) => i.pickup_place_id))];
    const places = await this.prisma.pickupPlace.findMany({ where: { id: { in: placeIds } } });
    const placeById = new Map(places.map((p) => [p.id, p]));
    const placeName = new Map(places.map((p) => [p.id, p.name]));
    const missing = placeIds.filter((id) => !placeName.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown pickup place(s): ${missing.join(', ')}`);
    }

    const order = await this.prisma.order.create({
      data: {
        clientId: client.id,
        clientAddressId: deliveryPlace?.id ?? null,
        clientName: client.name,
        clientPhoneNumber: client.phoneNumber,
        clientAddress: clientAddressText(deliveryPlace, client),
        deliveryDatetime: new Date(input.delivery_datetime),
        comment: input.comment,
        priority: input.priority ?? 'normal',
        // Delivery region/district are snapshotted from the place chosen, which
        // is the client's own geo when the client has a single address.
        regionCode: deliveryPlace?.regionCode ?? client.regionCode,
        geoDistrictCode: deliveryPlace?.districtCode ?? client.districtCode,
        deliveryLat: deliveryPlace?.lat ?? client.lat,
        deliveryLng: deliveryPlace?.lng ?? client.lng,
        createdBySellerId: createdByUserId,
        items: {
          create: input.items.map((i) => ({
            productName: i.product_name,
            quantity: i.quantity,
            pickupPlaceId: i.pickup_place_id,
            pickupPlaceName: placeName.get(i.pickup_place_id) as string,
          })),
        },
        // One stop per distinct place, in the order the items name them. The
        // driver's journey (heading to the pickup, loading, then the client)
        // runs over these; without them the order could be accepted but never
        // moved. Geo is snapshotted from the place, as the seller board does.
        pickupSources: {
          create: placeIds.map((id, i) => {
            const place = placeById.get(id)!;
            return {
              pickupPlaceId: place.id,
              name: place.name,
              regionCode: place.regionCode,
              geoDistrictCode: place.geoDistrictCode,
              lat: place.lat,
              lng: place.lng,
              position: i,
            };
          }),
        },
      },
      include: ORDER_INCLUDE,
    });
    return this.toPublic(order);
  }

  /**
   * A vozvrat order: fetch returned goods back from a client days after a
   * delivery. Made in the office (or by the seller), assigned like any other
   * order; the driver's journey is client → the place the goods go back to.
   * The seller whose goods they are comes from the original order when it is
   * named, so the vozvrat report reaches the right person in the mini app.
   */
  async createVozvratOrder(input: CreateVozvratOrderInput, actor: Actor): Promise<OrderPublic> {
    const client = await this.prisma.client.findUnique({ where: { id: input.client_id } });
    if (!client || !clientVisibleTo(client, actor)) {
      throw new NotFoundException('Client not found');
    }
    const place = await this.prisma.pickupPlace.findUnique({ where: { id: input.pickup_place_id } });
    if (!place) throw new BadRequestException('pickup_place_not_found');

    let original: { id: string; createdBySellerId: string } | null = null;
    if (input.original_order_id) {
      const found = await this.prisma.order.findUnique({
        where: { id: input.original_order_id },
        select: { id: true, clientId: true, status: true, kind: true, createdBySellerId: true },
      });
      if (!found || found.clientId !== client.id || found.kind !== 'delivery') {
        throw new BadRequestException('vozvrat_original_order_invalid');
      }
      if (found.status !== 'delivered' && found.status !== 'returned') {
        throw new BadRequestException('vozvrat_original_order_not_delivered');
      }
      original = found;
    }

    // Where the goods are collected from: the client's chosen place.
    const collectFrom = await this.clientAddresses.forOrder(client.id, input.client_address_id);

    // Where the goods are going back to. A yard that belongs to a supplier is
    // a supplier whatever its type says — the link is the fact, the type was
    // only ever a guess at it ("custom" meant supplier by convention).
    const destination: ReturnDestination = place.supplierId
      ? 'supplier'
      : place.type === 'warehouse'
        ? 'warehouse'
        : place.type === 'market'
          ? 'store'
          : 'supplier';
    const order = await this.prisma.order.create({
      data: {
        kind: 'vozvrat',
        originalOrderId: original?.id ?? null,
        clientId: client.id,
        clientAddressId: collectFrom?.id ?? null,
        clientName: client.name,
        clientPhoneNumber: client.phoneNumber,
        clientAddress: clientAddressText(collectFrom, client),
        deliveryDatetime: input.pickup_datetime ? new Date(input.pickup_datetime) : new Date(),
        comment: input.comment ?? null,
        priority: 'normal',
        regionCode: collectFrom?.regionCode ?? client.regionCode,
        geoDistrictCode: collectFrom?.districtCode ?? client.districtCode,
        deliveryLat: collectFrom?.lat ?? client.lat,
        deliveryLng: collectFrom?.lng ?? client.lng,
        createdBySellerId: original?.createdBySellerId ?? actor.userId,
        // The one stop after the client: where the goods go back to. Marked
        // as a return stop from the start, so the shared return legs run it.
        pickupSources: {
          create: [
            {
              pickupPlaceId: place.id,
              name: place.name,
              regionCode: place.regionCode,
              geoDistrictCode: place.geoDistrictCode,
              lat: place.lat,
              lng: place.lng,
              position: 0,
              returnRequired: true,
              returnDestination: destination,
            },
          ],
        },
      },
      include: ORDER_INCLUDE,
    });
    return this.toPublic(order);
  }

  async findAllForActor(actor: Actor, filters: OrderFilterInput = {}): Promise<OrderPublic[]> {
    const where = await this.buildWhere(actor, filters);
    const direction = actor.role === 'driver' ? 'asc' : 'desc';
    const orders = await this.prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: [{ createdAt: direction }, { orderNumber: direction }],
      skip: filters.skip ?? 0,
      take: filters.take ?? DEFAULT_PAGE_SIZE,
    });
    const cursor = await this.tripCursorForActor(actor);
    return orders.map((o) => this.toPublic(o, cursor));
  }

  /** Server-side paginated variant: a page of orders plus the total match count. */
  async findPageForActor(actor: Actor, filters: OrderFilterInput = {}): Promise<OrderPage> {
    const where = await this.buildWhere(actor, filters);
    const direction = actor.role === 'driver' ? 'asc' : 'desc';
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: [{ createdAt: direction }, { orderNumber: direction }],
        skip: filters.skip ?? 0,
        take: filters.take ?? DEFAULT_PAGE_SIZE,
      }),
      this.prisma.order.count({ where }),
    ]);
    const cursor = await this.tripCursorForActor(actor);
    return { items: orders.map((o) => this.toPublic(o, cursor)), total };
  }

  /** Aggregate counts by status within the actor's scope — for dashboards and
   *  per-seller / per-driver summaries (pass seller_id / driver_id). */
  async statsForActor(actor: Actor, filters: OrderFilterInput = {}): Promise<OrderStats> {
    const where = await this.buildWhere(actor, filters);
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    let total = 0;
    for (const g of grouped) {
      counts[g.status] = g._count._all;
      total += g._count._all;
    }
    return { total, counts };
  }

  /** Builds the list query: role scope first, then §16 filters within it. */
  private async buildWhere(actor: Actor, filters: OrderFilterInput): Promise<Prisma.OrderWhereInput> {
    const where: Prisma.OrderWhereInput = {};
    if (actor.role === 'seller') {
      where.createdBySellerId = actor.userId;
    } else if (actor.role === 'driver') {
      where.assignedDriverId = await this.resolveDriverId(actor);
    }
    if (filters.problem) {
      where.OR = [{ status: 'problem' }, { problemReason: { not: null } }];
    } else if (filters.statuses && filters.statuses.length > 0) {
      where.status = { in: filters.statuses as OrderStatus[] };
    } else if (filters.status) {
      where.status = filters.status;
    }
    // Cross-cutting filters are honoured for admins and managers (a manager is a
    // full admin); a seller/driver's scope is fixed to themselves above.
    const adminLike = actor.role === 'admin' || actor.role === 'manager';
    if (adminLike && filters.driver_id) {
      where.assignedDriverId = filters.driver_id;
    }
    if (adminLike && filters.seller_id) {
      where.createdBySellerId = filters.seller_id;
    }
    if (filters.pickup_place_id) {
      where.items = { some: { pickupPlaceId: filters.pickup_place_id } };
    }
    // client_id narrows within the existing role scope (safe for all roles).
    if (filters.client_id) {
      where.clientId = filters.client_id;
    }
    if (filters.client_phone) {
      where.clientPhoneNumber = { contains: filters.client_phone };
    }
    if (filters.delivery_date) {
      const start = tashkentDayStartUtc(filters.delivery_date);
      const end = new Date(start.getTime() + 86_400_000);
      where.deliveryDatetime = { gte: start, lt: end };
    } else if (filters.delivery_date_from || filters.delivery_date_to) {
      const range: Prisma.DateTimeFilter = {};
      if (filters.delivery_date_from) {
        range.gte = tashkentDayStartUtc(filters.delivery_date_from);
      }
      if (filters.delivery_date_to) {
        range.lt = new Date(tashkentDayStartUtc(filters.delivery_date_to).getTime() + 86_400_000);
      }
      where.deliveryDatetime = range;
    }
    return where;
  }

  async findOneForActor(id: string, actor: Actor): Promise<OrderPublic> {
    const order = await this.getOrThrow(id);
    await this.assertCanView(order, actor);
    // The cursor only exists for a co-load, and only the assigned driver can act
    // on it; for everyone else it stays null and nothing changes.
    return this.toPublic(order, await this.tripCursorFor(order.assignedDriverId));
  }

  /** Cancel according to journey progress. Before pickup departure this is a normal
   *  cancellation. An en-route pickup earns its trip pay. Collected goods enter
   *  per-pickup Vozvrat instead of disappearing from the driver's workflow. */
  async cancel(id: string, reason: string, actor: Actor): Promise<OrderPublic> {
    const order = await this.getOrThrow(id);
    if (actor.role === 'seller' && order.createdBySellerId !== actor.userId) {
      throw new ForbiddenException('Not your order');
    }
    if (!(CANCELLABLE_ORDER_STATUSES as readonly OrderStatus[]).includes(order.status as OrderStatus)) {
      throw new ConflictException('order_cannot_cancel');
    }

    // Decided inside the transaction below, read after it for the live nudge.
    let targetStatus: OrderStatus = 'cancelled';

    // A po puti riding with this order goes on as an ordinary one (leaveTrip);
    // its seller is told (owner, 10.11.2026).
    const ridersOf =
      order.assignedDriverId &&
      (order.deliveryTripPosition != null || order.pickupSources.some((src) => src.tripPosition != null))
        ? await this.prisma.order.findMany({
            where: {
              assignedDriverId: order.assignedDriverId,
              id: { not: id },
              isBackhaul: true,
              status: { in: [...BLOCKING_ACTIVE_ORDER_STATUSES] },
              OR: [{ deliveryTripPosition: { not: null } }, { pickupSources: { some: { tripPosition: { not: null } } } }],
            },
            select: { id: true, createdBySellerId: true, orderNumber: true, clientName: true },
          })
        : [];

    await this.prisma.$transaction(async (tx) => {
      // The stops are read again here. A driver confirming "Yuk olindi" in
      // the same moment used to be lost: the cancel decided on a stale read,
      // the order went terminal, and the cargo already aboard had no return
      // leg and no button on anyone's screen.
      const fresh = await tx.orderPickupSource.findMany({ where: { orderId: id } });
      const collected = fresh.filter((source) => source.legStatus === 'arrived');
      const enRoute = fresh.find((source) => source.legStatus === 'en_route');
      const requiresReturn = collected.length > 0;
      targetStatus = requiresReturn ? 'returning' : 'cancelled';
      if (enRoute && order.assignedDriverId) {
        await this.accruePickupTariff(tx, id, order.assignedDriverId, enRoute);
      }

      const cancelled = await tx.order.updateMany({
        where: { id, status: order.status },
        data: requiresReturn
          ? {
              status: 'returning',
              cancellationReason: reason,
              returnReason: reason,
              returnDestination: null,
              returnStage: null,
            }
          : { status: 'cancelled', cancellationReason: reason },
      });
      // Somebody else moved it while this cancel was being decided: the order
      // is where they left it, and this cancel is not applied on top.
      if (cancelled.count === 0) throw new ConflictException('order_already_in_progress');

      if (requiresReturn) {
        for (const source of collected) {
          await tx.orderPickupSource.update({
            where: { id: source.id },
            data: {
              returnRequired: true,
              returnDestination: null,
              returnStage: null,
              returnProofPhotoUrl: null,
              returnedAt: null,
            },
          });
        }
      }

      if (order.assignedDriverId) {
        if (!requiresReturn) {
          await tx.driverAssignment.updateMany({
            where: {
              orderId: id,
              assignmentStatus: { in: ['pending_driver_response', 'accepted'] },
            },
            data: { assignmentStatus: 'cancelled' },
          });
        }
        await settleDriverStatus(tx, order.assignedDriverId);
      }

      if (order.assignedDriverId) {
        await this.leaveTrip(tx, order, order.assignedDriverId);
      }

      // "Cancelled" is the truth only when nothing was collected. With goods
      // aboard the order lives on as a return, and telling the driver it was
      // cancelled is how a load gets left in a van.
      if (!requiresReturn) {
        await emitOrderEvent(tx, OrderEventType.Cancelled, id, { orderId: id, reason, requiresReturn });
      }
      if (requiresReturn) {
        await emitOrderEvent(tx, OrderEventType.StatusChanged, id, {
          orderId: id,
          status: 'returning',
        });
      }
    });

    const updated = await this.getOrThrow(id);
    this.realtime.orderStatusChanged(id, targetStatus, order.assignedDriverId);
    if (order.assignedDriverId) {
      this.realtime.driverStatusChanged(order.assignedDriverId);
    }
    for (const rider of ridersOf) {
      void this.notifications
        .notify(rider.createdBySellerId, {
          type: 'poputi.host_cancelled',
          title: 'Po puti: asosiy zakaz bekor qilindi',
          body: `№${rider.orderNumber} (${rider.clientName}) endi alohida yetkaziladi — haydovchi uni olib boradi.`,
          relatedOrderId: rider.id,
        })
        .catch(() => undefined);
    }
    return this.toPublic(updated);
  }

  /**
   * Take an order out of the merged trip a po puti co-load put it in.
   *
   * Trip positions only mean anything while two orders are being driven as one
   * route. When one of them drops out, the numbers left behind would order the
   * survivor's stops against a trip that no longer exists — so the leaver is
   * cleared, and if that leaves a single order holding positions, it is cleared
   * too and simply becomes an ordinary order again.
   *
   * The co-load itself is never cancelled with its host. It is a different
   * seller's cargo, and the driver is still going to collect and deliver it.
   */
  private async leaveTrip(
    tx: Prisma.TransactionClient,
    order: { id: string; deliveryTripPosition: number | null; pickupSources: { tripPosition: number | null }[] },
    driverId: string,
  ): Promise<void> {
    const merged =
      order.deliveryTripPosition != null || order.pickupSources.some((src) => src.tripPosition != null);
    if (!merged) return;

    await this.clearTripPositions(tx, order.id);

    // Whoever is left. One order alone is not a merged trip, so its numbers go
    // too; two or more are still riding together and keep theirs.
    const stillMerged = await tx.order.findMany({
      where: {
        assignedDriverId: driverId,
        // A vozvrat carrying its goods back may be the one left (owner, 11.11.2026).
        AND: [{ OR: [{ status: { in: [...BLOCKING_ACTIVE_ORDER_STATUSES] } }, { kind: 'vozvrat', status: 'returning' }] }],
        id: { not: order.id },
        OR: [
          { deliveryTripPosition: { not: null } },
          { pickupSources: { some: { tripPosition: { not: null } } } },
        ],
      },
      select: { id: true },
    });
    if (stillMerged.length !== 1) return;
    await this.clearTripPositions(tx, stillMerged[0].id);
  }

  private async clearTripPositions(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await tx.order.update({ where: { id: orderId }, data: { deliveryTripPosition: null } });
    await tx.orderPickupSource.updateMany({ where: { orderId }, data: { tripPosition: null } });
  }

  // --- Place-based journey (Option A). Each pickup is a stop; the driver advances
  //     stop-by-stop in `position` order, then heads to the customer. ---

  /** "Heading to pickup N": pending → en_route. First depart flips the order into
   *  collecting_items. Stops must be started in order, one at a time. */
  async departToPickup(orderId: string, pickupId: string, actor: Actor): Promise<OrderPublic> {
    const r = await this.departToPickupLeg(orderId, pickupId, actor);
    await this.noteMorningStart(orderId, actor, 'pickup');
    return r;
  }

  private async departToPickupLeg(orderId: string, pickupId: string, actor: Actor): Promise<OrderPublic> {
    const driverId = await this.resolveWorkingDriverId(actor);
    const order = await this.getOrThrow(orderId);
    this.assertAssigned(order, driverId);
    this.assertDriverActionsAvailable(order);
    if (order.status !== 'driver_accepted' && order.status !== 'collecting_items') {
      throw new ConflictException('order_cannot_depart_pickup');
    }
    if (order.status === 'driver_accepted') await this.assertNoOtherJourneyUnderWay(order, driverId);
    // A vozvrat order's stops are where the goods go back to, not where they
    // are collected from: the journey is client first, then the return legs.
    if (order.kind === 'vozvrat') {
      throw new ConflictException('order_invalid_transition');
    }
    const source = this.pickupOrThrow(order, pickupId);
    if (source.legStatus !== 'pending') {
      throw new ConflictException('pickup_already_started');
    }
    if (order.pickupSources.some((s) => s.legStatus === 'en_route')) {
      throw new ConflictException('another_pickup_in_progress');
    }
    if (order.pickupSources.some((s) => s.position < source.position && s.legStatus !== 'arrived')) {
      throw new ConflictException('pickup_out_of_order');
    }
    let statusChanged = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.orderPickupSource.update({ where: { id: pickupId }, data: { legStatus: 'en_route' } });
      if (order.status === 'driver_accepted') {
        // Conditional: a cancel landing in the same moment must not be undone
        // by the driver setting off.
        const moved = await tx.order.updateMany({
          where: { id: orderId, status: 'driver_accepted' },
          data: {
            status: 'collecting_items',
            journeyStartedAt: order.journeyStartedAt ?? new Date(),
          },
        });
        if (moved.count === 0) throw new ConflictException('order_already_in_progress');
        await emitOrderEvent(tx, OrderEventType.StatusChanged, orderId, {
          orderId,
          status: 'collecting_items',
        });
      }
      // Heading to a pickup is work. An Ertangi booking never set the driver
      // busy when it was made, so this is where it catches up at the latest.
      statusChanged = (await settleDriverStatus(tx, driverId)).changed;
    });
    if (statusChanged) this.realtime.driverStatusChanged(driverId);
    await this.rideAlongDepart(order, source.pickupPlaceId);
    const fresh = await this.getOrThrow(orderId);
    this.realtime.orderStatusChanged(orderId, fresh.status, fresh.assignedDriverId);
    return this.toPublic(fresh, await this.tripCursorFor(fresh.assignedDriverId));
  }

  /** "Arrived at pickup N" (Yuk olindi): en_route → arrived. When every stop is
   *  arrived the order flips to items_collected. */
  async arriveAtPickup(
    orderId: string,
    pickupId: string,
    actor: Actor,
    photoUrl: string,
    comment: string | null = null,
  ): Promise<OrderPublic> {
    if (!photoUrl?.trim()) {
      throw new BadRequestException('pickup_photo_required');
    }
    const driverId = await this.resolveWorkingDriverId(actor);
    const order = await this.getOrThrow(orderId);
    this.assertAssigned(order, driverId);
    this.assertDriverActionsAvailable(order);
    if (order.status !== 'collecting_items') {
      throw new ConflictException('order_cannot_arrive_pickup');
    }
    const source = this.pickupOrThrow(order, pickupId);
    if (source.legStatus !== 'en_route') {
      throw new ConflictException('pickup_not_en_route');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.orderPickupSource.update({
        where: { id: pickupId },
        data: { legStatus: 'arrived', loadPhotoUrl: photoUrl },
      });
      await this.accruePickupTariff(tx, orderId, driverId, source);
      // Report the loaded goods to the pickup Telegram group (per stop).
      await emitOrderEvent(tx, OrderEventType.PickupLoaded, orderId, {
        orderId,
        pickupId,
        placeName: source.name,
        photoUrl,
        comment,
      });
      const remaining = await tx.orderPickupSource.count({
        where: { orderId, legStatus: { not: 'arrived' } },
      });
      if (remaining === 0) {
        const moved = await tx.order.updateMany({
          where: { id: orderId, status: { in: ['driver_accepted', 'collecting_items'] } },
          data: { status: 'items_collected' },
        });
        if (moved.count === 0) throw new ConflictException('order_already_in_progress');
        await emitOrderEvent(tx, OrderEventType.StatusChanged, orderId, {
          orderId,
          status: 'items_collected',
        });
      }
    });
    await this.rideAlongArrive(order, source.pickupPlaceId, driverId, photoUrl, comment);
    const fresh = await this.getOrThrow(orderId);
    this.realtime.orderStatusChanged(orderId, fresh.status, fresh.assignedDriverId);
    return this.toPublic(fresh, await this.tripCursorFor(fresh.assignedDriverId));
  }

  /**
   * A co-load rides with the host (owner, 03.11.2026): two orders of one
   * driver that fetch from the same yard and go to the same client and door
   * are one run: one "set off", one loading photograph, one handover. The
   * other order's matching step is taken with the host's, so the driver is
   * never asked to set off to where he already stands.
   */
  private async coloadSiblings(order: { id: string; assignedDriverId: string | null }): Promise<OrderWithItems[]> {
    if (!order.assignedDriverId) return [];
    const rows = await this.prisma.order.findMany({
      where: {
        id: { not: order.id },
        assignedDriverId: order.assignedDriverId,
        kind: 'delivery',
        status: { in: ['driver_accepted', 'collecting_items', 'items_collected', 'on_the_way', 'arrived_at_customer'] },
      },
      include: ORDER_INCLUDE,
    });
    return rows.filter((r) => r.id !== order.id && Array.isArray(r.pickupSources));
  }

  /** The sibling's stop at this yard, when it is the next one still to do. */
  private nextStopAt(sibling: OrderWithItems, pickupPlaceId: string) {
    if (sibling.status !== 'driver_accepted' && sibling.status !== 'collecting_items') return null;
    const src = sibling.pickupSources.find((p) => p.pickupPlaceId === pickupPlaceId && p.legStatus !== 'arrived');
    if (!src) return null;
    if (sibling.pickupSources.some((p) => p.position < src.position && p.legStatus !== 'arrived')) return null;
    if (sibling.pickupSources.some((p) => p.id !== src.id && p.legStatus === 'en_route')) return null;
    return src;
  }

  private async rideAlongDepart(order: OrderWithItems, pickupPlaceId: string): Promise<void> {
    for (const sibling of await this.coloadSiblings(order)) {
      const src = this.nextStopAt(sibling, pickupPlaceId);
      if (!src || src.legStatus !== 'pending') continue;
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.orderPickupSource.update({ where: { id: src.id }, data: { legStatus: 'en_route' } });
          if (sibling.status === 'driver_accepted') {
            const moved = await tx.order.updateMany({
              where: { id: sibling.id, status: 'driver_accepted' },
              data: { status: 'collecting_items', journeyStartedAt: sibling.journeyStartedAt ?? new Date() },
            });
            if (moved.count > 0) {
              await emitOrderEvent(tx, OrderEventType.StatusChanged, sibling.id, { orderId: sibling.id, status: 'collecting_items' });
            }
          }
        });
        this.realtime.orderStatusChanged(sibling.id, 'collecting_items', sibling.assignedDriverId);
      } catch (err) {
        this.logger.warn(`co-load ${sibling.id} did not set off with ${order.id}: ${(err as Error).message}`);
      }
    }
  }

  private async rideAlongArrive(
    order: OrderWithItems,
    pickupPlaceId: string,
    driverId: string,
    photoUrl: string,
    comment: string | null,
  ): Promise<void> {
    for (const sibling of await this.coloadSiblings(order)) {
      const src = this.nextStopAt(sibling, pickupPlaceId);
      if (!src) continue;
      try {
        let status: OrderStatus = sibling.status as OrderStatus;
        await this.prisma.$transaction(async (tx) => {
          await tx.orderPickupSource.update({ where: { id: src.id }, data: { legStatus: 'arrived', loadPhotoUrl: photoUrl } });
          await this.accruePickupTariff(tx, sibling.id, driverId, src);
          await emitOrderEvent(tx, OrderEventType.PickupLoaded, sibling.id, {
            orderId: sibling.id,
            pickupId: src.id,
            placeName: src.name,
            photoUrl,
            comment,
          });
          const remaining = await tx.orderPickupSource.count({ where: { orderId: sibling.id, legStatus: { not: 'arrived' } } });
          status = remaining === 0 ? 'items_collected' : 'collecting_items';
          const moved = await tx.order.updateMany({
            where: { id: sibling.id, status: { in: ['driver_accepted', 'collecting_items'] } },
            data: { status, journeyStartedAt: sibling.journeyStartedAt ?? new Date() },
          });
          if (moved.count > 0 && status !== sibling.status) {
            await emitOrderEvent(tx, OrderEventType.StatusChanged, sibling.id, { orderId: sibling.id, status });
          }
        });
        this.realtime.orderStatusChanged(sibling.id, status, sibling.assignedDriverId);
      } catch (err) {
        this.logger.warn(`co-load ${sibling.id} was not loaded with ${order.id}: ${(err as Error).message}`);
      }
    }
  }

  /** "Heading to the customer": items_collected → on_the_way (FR-013). */
  async departToCustomer(orderId: string, actor: Actor): Promise<OrderPublic> {
    const r = await this.driverTransition(orderId, 'on_the_way', actor, OrderEventType.StatusChanged, {
      status: 'on_the_way',
    });
    await this.noteMorningStart(orderId, actor, 'customer');
    const host = await this.getOrThrow(orderId);
    for (const sibling of await this.coloadedToSameDoor(host)) {
      if (sibling.status !== 'items_collected') continue;
      try {
        await this.driverTransition(sibling.id, 'on_the_way', actor, OrderEventType.StatusChanged, { status: 'on_the_way' });
      } catch (err) {
        this.logger.warn(`co-load ${sibling.id} did not set off to the client with ${orderId}: ${(err as Error).message}`);
      }
    }
    return r;
  }

  /**
   * A "yo'lga chiqdim" may be the morning's early start (morning-start.ts).
   * Never in the way of the press itself: a failure here is only logged.
   */
  private async noteMorningStart(orderId: string, actor: Actor, action: MorningAction): Promise<void> {
    try {
      const [driver, order] = await Promise.all([
        this.prisma.driver.findUnique({
          where: { userId: actor.userId },
          select: { id: true, locationLat: true, locationLng: true, locationUpdatedAt: true },
        }),
        this.prisma.order.findUnique({
          where: { id: orderId },
          select: { id: true, bookingKind: true, deliveryDatetime: true, startAfterNine: true },
        }),
      ]);
      if (driver && order) await recordMorningPress(this.prisma, order, driver, action, new Date());
    } catch (err) {
      this.logger.warn(`morning start not noted for ${orderId}: ${(err as Error).message}`);
    }
  }

  /** "Arrived at the customer": on_the_way → arrived_at_customer. */
  async arriveAtCustomer(orderId: string, actor: Actor): Promise<OrderPublic> {
    return this.driverTransition(
      orderId,
      'arrived_at_customer',
      actor,
      OrderEventType.StatusChanged,
      { status: 'arrived_at_customer' },
    );
  }

  // --- Delivery outcomes at the customer (screen 5) ---

  /** Istisno holat only records and reports a problem. The order status,
   *  driver availability and assignment are intentionally left unchanged. */
  async reportException(
    orderId: string,
    input: OrderExceptionInput,
    actor: Actor,
  ): Promise<OrderPublic> {
    const driverId = await this.resolveWorkingDriverId(actor);
    const order = await this.getOrThrow(orderId);
    this.assertAssigned(order, driverId);
    this.assertDriverActionsAvailable(order);
    if (!PROBLEM_REPORTABLE_ORDER_STATUSES.includes(order.status as (typeof PROBLEM_REPORTABLE_ORDER_STATUSES)[number])) {
      throw new ConflictException('exception_not_reportable');
    }
    if (order.problemReason) {
      throw new ConflictException('exception_already_reported');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.order.update({
        where: { id: orderId },
        data: {
          problemReason: input.reason,
          problemComment: input.comment ?? null,
        },
        include: ORDER_INCLUDE,
      });
      await emitOrderEvent(tx, OrderEventType.Problem, orderId, {
        orderId,
        reason: input.reason,
        comment: input.comment ?? null,
      });
      return saved;
    });
    this.realtime.orderStatusChanged(orderId, order.status, driverId);
    return this.toPublic(updated, await this.tripCursorFor(driverId));
  }

  /** Start Vozvrat at the customer, or configure destinations after a seller
   *  cancellation. Every collected pickup must receive its own destination. */
  async startReturn(orderId: string, input: OrderReturnInput, actor: Actor): Promise<OrderPublic> {
    const driverId = await this.resolveWorkingDriverId(actor);
    const order = await this.getOrThrow(orderId);
    this.assertAssigned(order, driverId);
    this.assertDriverActionsAvailable(order);

    // On the way to the client is already "at the client" for the driver's
    // buttons (owner, 02.11.2026): the vozvrat sits beside "Yukni topshirdim".
    const starting = order.status === 'on_the_way' || order.status === 'arrived_at_customer';
    const configuring = order.status === 'returning';
    if (!starting && !configuring) {
      throw new ConflictException('order_invalid_transition');
    }
    // A vozvrat order's stops were never collected from: they are where the
    // goods go, and every one of them is a return stop from the start.
    const vozvratOrder = order.kind === 'vozvrat';
    const returnSources = starting
      ? order.pickupSources.filter((source) => vozvratOrder || source.legStatus === 'arrived')
      : order.pickupSources.filter((source) => source.returnRequired);
    if (returnSources.length === 0) {
      throw new ConflictException('return_has_no_collected_goods');
    }
    if (
      configuring &&
      returnSources.some((source) => source.returnStage !== null || source.returnedAt !== null)
    ) {
      throw new ConflictException('return_already_started');
    }
    // Once the seller confirmed the write-up, where the goods go is settled:
    // no later submit (with or without a list) may change the place he chose
    // (owner, 07.11.2026).
    if (order.returnItemsConfirmedAt) throw new ConflictException('return_already_confirmed');
    // The write-up is sent once, on either path. A second submit used to
    // replace what was recorded (and already reported) with whatever came
    // second — a double tap must not erase the first list. A places-only
    // submit is refused too: with a list written, the place is the seller's
    // to choose when he confirms it (owner, 07.11.2026).
    const written = await this.prisma.orderReturnItem.count({ where: { orderId } });
    if (written > 0) throw new ConflictException('return_already_written');

    // The driver may leave the place out: the seller chooses it when he
    // confirms the write-up. An older app still sends it, and that stands.
    const destinationBySource = new Map<string, ReturnDestination>(
      input.returns
        .filter((entry) => entry.destination)
        .map((entry) => [entry.pickup_source_id, entry.destination as ReturnDestination]),
    );
    const namedSources = new Set(input.returns.map((entry) => entry.pickup_source_id));
    if (vozvratOrder) {
      // The place was chosen when the order was made; the driver need not pick it again.
      for (const source of returnSources) {
        if (!destinationBySource.has(source.id) && source.returnDestination) {
          destinationBySource.set(source.id, source.returnDestination as ReturnDestination);
        }
      }
      if ((input.items ?? []).length === 0) throw new BadRequestException('vozvrat_items_required');
    }
    const validIds = new Set(returnSources.map((source) => source.id));
    if (
      input.returns.some((entry) => !validIds.has(entry.pickup_source_id)) ||
      (!vozvratOrder && namedSources.size !== returnSources.length) ||
      // Without a written list there is no seller step to choose the place in.
      ((input.items ?? []).length === 0 && destinationBySource.size !== returnSources.length)
    ) {
      throw new ConflictException('return_destinations_incomplete');
    }
    const destinations = [...destinationBySource.values()];
    const legacyDestination =
      destinationBySource.size === returnSources.length && new Set(destinations).size === 1
        ? (destinations[0] ?? null)
        : null;

    // What is returned and why, for the vozvrat mini app. Which storekeeper
    // is involved is the warehouse's to say when it takes the goods back.
    const items = input.items ?? [];
    const now = new Date();
    let reportPayload: ReturnType<typeof vozvratPayload> | null = null;
    if (items.length > 0) {
      reportPayload = vozvratPayload({
        orderNumber: order.orderNumber,
        at: now,
        driverName: order.assignedDriver?.user.name ?? '',
        clientName: order.clientName,
        sellerName: order.createdBySeller?.name ?? '',
        sellerTelegramId: order.createdBySeller?.telegramId ?? null,
        comment: input.reason?.trim() || null,
        items: items.map((item) => ({
          productId: item.product_id ?? null,
          name: item.name,
          unit: item.unit ?? null,
          quantity: item.quantity,
          condition: item.condition,
          reasonCode: item.reason,
          otherReason: item.reason === 'x' ? (item.other_reason ?? null) : null,
          culprit: item.reason === 'x' ? (item.culprit ?? null) : null,
          photoUrl: item.photo_url,
        })),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const source of returnSources) {
        await tx.orderPickupSource.update({
          where: { id: source.id },
          data: {
            returnRequired: true,
            returnDestination: destinationBySource.get(source.id) ?? null,
          },
        });
      }
      // Conditional on the status this call read, so two submits landing
      // together cannot both configure the same return.
      const moved = await tx.order.updateMany({
        // The status this call read: on the way or at the door when starting.
        // Not confirmed meanwhile either (owner, 07.11.2026): a seller's
        // confirm landing first keeps his places.
        where: { id: orderId, status: order.status, returnItemsConfirmedAt: null },
        data: {
          status: 'returning',
          returnDestination: legacyDestination,
          returnReason: input.reason?.trim() || order.returnReason || null,
          returnStage: null,
        },
      });
      if (moved.count === 0) throw new ConflictException('return_already_started');
      if (reportPayload) {
        await tx.orderReturnItem.deleteMany({ where: { orderId } });
        await tx.orderReturnItem.createMany({
          data: items.map((item) => ({
            orderId,
            productId: item.product_id ?? null,
            name: item.name,
            unit: item.unit ?? null,
            xodovoy: item.xodovoy ?? null,
            quantity: item.quantity,
            condition: item.condition,
            reasonCode: item.reason,
            otherReason: item.reason === 'x' ? (item.other_reason ?? null) : null,
            culprit: culpritOf(item.reason) ?? item.culprit ?? null,
            photoUrl: item.photo_url,
            photoUrls: item.extra_photo_urls ?? [],
          })),
        });
        // One report per order; sending again before it went out replaces it.
        await tx.vozvratReport.upsert({
          where: { orderId },
          // Held, not queued: the sweeper only looks at 'pending' rows, so
          // nothing reaches the warehouse's books until the seller has
          // checked the list it describes.
          create: { orderId, payload: reportPayload, status: 'held', nextAttemptAt: now },
          update: { payload: reportPayload, status: 'held', attempts: 0, nextAttemptAt: now },
        });
      }
      if (items.length > 0) {
        // A fresh write-up is unchecked, whatever the last one was: the seller
        // looks again. The album and the accounting report go out with his
        // confirmation, not before it.
        await tx.order.update({
          where: { id: orderId },
          data: {
            returnItemsConfirmedAt: null,
            returnItemsConfirmedById: null,
            returnItemsRejectedAt: null,
            returnItemsRejectReason: null,
          },
        });
      }
      if (starting) {
        // Free for the next order while taking this one back — unless a
        // co-loaded order is still aboard, which keeps him busy.
        await settleDriverStatus(tx, driverId);
        await emitOrderEvent(tx, OrderEventType.StatusChanged, orderId, {
          orderId,
          status: 'returning',
        });
      }
    });

    const updated = await this.getOrThrow(orderId);
    this.realtime.orderStatusChanged(orderId, 'returning', updated.assignedDriverId);
    if (starting) this.realtime.driverStatusChanged(driverId);
    return this.toPublic(updated);
  }

  /** The write-up itself: what the seller (or the office) is about to confirm. */
  async returnItemsFor(orderId: string, actor: Actor): Promise<ReturnItemPublic[]> {
    const order = await this.getOrThrow(orderId);
    if (actor.role === 'seller' && order.createdBySellerId !== actor.userId) {
      throw new ForbiddenException('Not your order');
    }
    if (actor.role === 'driver') {
      const driverId = await this.resolveDriverId(actor);
      this.assertAssigned(order, driverId);
    }
    const rows = await this.prisma.orderReturnItem.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit ?? null,
      // Decimal in the column, a number on the wire.
      quantity: Number(row.quantity),
      condition: row.condition,
      reason_code: row.reasonCode,
      other_reason: row.otherReason ?? null,
      culprit: row.culprit ?? null,
      photo_url: row.photoUrl,
      photo_urls: row.photoUrls ?? [],
    }));
  }

  /**
   * The seller checks the write-up.
   *
   * The goods come back on his account, and the warehouse books whatever we
   * send: so a list only travels once the person whose goods they are has
   * looked at it. Confirming releases both the album to the Vozrat group and
   * the report to the accounting app, and gives the driver his next button.
   */
  async confirmReturnItems(
    orderId: string,
    actor: Actor,
    variant: {
      seller_culprit?: string | null;
      seller_note?: string | null;
      destinations?: { pickup_source_id: string; destination: ReturnDestination; place_id?: string | null }[];
    } = {},
  ): Promise<OrderPublic> {
    const order = await this.getOrThrow(orderId);
    this.assertReturnItemsOwner(order, actor);
    // Ta'minotchi: the supplier's place picked from the list (owner, 12.11.2026).
    const pickedPlaceIds = new Map(
      (variant.destinations ?? [])
        .filter((d) => d.destination === 'supplier' && d.place_id)
        .map((d) => [d.pickup_source_id, d.place_id!]),
    );
    if (pickedPlaceIds.size > 0) {
      const ids = [...new Set(pickedPlaceIds.values())];
      const found = await this.prisma.pickupPlace.count({ where: { id: { in: ids } } });
      if (found !== ids.length) throw new BadRequestException('return_place_unknown');
    }
    const written = order._count?.returnItems ?? 0;
    if (written === 0) throw new ConflictException('return_nothing_written');
    if (order.returnItemsConfirmedAt) throw new ConflictException('return_already_confirmed');

    // Where the goods go is the seller's call: what he picks here, or what an
    // older driver app already set. Every returned stop needs a place.
    const returned = order.pickupSources.filter((source) => source.returnRequired);
    const picked = new Map((variant.destinations ?? []).map((d) => [d.pickup_source_id, d.destination]));
    if ([...picked.keys()].some((id) => !returned.some((source) => source.id === id))) {
      throw new BadRequestException('return_destination_unknown_stop');
    }
    const placeFor = returned.length
      ? new Map(returned.map((source) => [source.id, picked.get(source.id) ?? (source.returnDestination as ReturnDestination | null)]))
      : null;
    if (placeFor && [...placeFor.values()].some((d) => !d)) {
      throw new BadRequestException('return_destination_required');
    }
    const places = placeFor ? [...placeFor.values()] : [];
    const legacyPlace = new Set(places).size === 1 ? (places[0] ?? null) : null;

    const items = await this.prisma.orderReturnItem.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (placeFor) {
        for (const [id, destination] of placeFor) {
          await tx.orderPickupSource.update({
            where: { id },
            data: {
              returnDestination: destination,
              ...(picked.has(id) ? { returnPlaceId: destination === 'supplier' ? (pickedPlaceIds.get(id) ?? null) : null } : {}),
            },
          });
        }
      }
      // Conditional, so two sellers (or a seller and an admin) confirming
      // together send one album, not two.
      const claimed = await tx.order.updateMany({
        // Not rejected meanwhile either: a reject landing first deletes the
        // list this confirm read (06.11.2026).
        where: { id: orderId, returnItemsConfirmedAt: null, returnItemsRejectedAt: null },
        data: {
          returnItemsConfirmedAt: now,
          returnItemsConfirmedById: actor.userId,
          ...(placeFor ? { returnDestination: legacyPlace } : {}),
          returnSellerCulprit: variant.seller_culprit ?? null,
          returnSellerNote: variant.seller_note?.trim() || null,
          returnItemsRejectedAt: null,
          returnItemsRejectReason: null,
        },
      });
      if (claimed.count === 0) throw new ConflictException('return_already_confirmed');
      // The accounting report was held when it was written; now it is due.
      await tx.vozvratReport.updateMany({
        where: { orderId, status: 'held' },
        data: { status: 'pending', nextAttemptAt: now },
      });
      await emitOrderEvent(tx, OrderEventType.ReturnWrittenUp, orderId, {
        orderId,
        items: items.map((item) => ({
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          condition: item.condition,
          reasonCode: item.reasonCode,
          otherReason: item.otherReason,
          culprit: item.culprit,
          photoUrl: item.photoUrl,
          photoUrls: item.photoUrls,
        })),
      });
    });

    const updated = await this.getOrThrow(orderId);
    this.realtime.orderStatusChanged(orderId, updated.status, updated.assignedDriverId);
    // The driver is standing at the client waiting for this (owner,
    // 03.11.2026): a push, so his app refreshes at once rather than on its
    // next poll.
    const driverUser = await this.driverUserId(updated.assignedDriverId);
    if (driverUser) {
      await this.notifications.notify(driverUser, {
        type: 'return_items_confirmed',
        title: 'Vozvrat tasdiqlandi',
        body: "Sotuvchi vozvratni tasdiqladi — qaytarish joyiga yo'l olishingiz mumkin.",
        relatedOrderId: orderId,
        clientName: updated.clientName,
      });
    }
    // Off the request path: the seller does not wait for the accounting system.
    void this.vozvrat
      .deliver(orderId)
      .catch((err: Error) => this.logger.error(`vozvrat delivery for ${orderId} failed: ${err.message}`));
    return this.toPublic(updated);
  }

  /**
   * The seller sends the write-up back, in his own words.
   *
   * The list is cleared so the driver writes it again rather than editing
   * around the mistake, and nothing has gone to the warehouse to retract.
   */
  async rejectReturnItems(orderId: string, reason: string, actor: Actor): Promise<OrderPublic> {
    const order = await this.getOrThrow(orderId);
    this.assertReturnItemsOwner(order, actor);
    const written = order._count?.returnItems ?? 0;
    if (written === 0) throw new ConflictException('return_nothing_written');
    if (order.returnItemsConfirmedAt) throw new ConflictException('return_already_confirmed');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, returnItemsConfirmedAt: null, returnItemsRejectedAt: null },
        data: { returnItemsRejectedAt: now, returnItemsRejectReason: reason },
      });
      if (claimed.count === 0) throw new ConflictException('return_already_answered');
      await tx.orderReturnItem.deleteMany({ where: { orderId } });
      // The held report goes with the list it described.
      await tx.vozvratReport.deleteMany({ where: { orderId, status: 'held' } });
    });

    const updated = await this.getOrThrow(orderId);
    this.realtime.orderStatusChanged(orderId, updated.status, updated.assignedDriverId);
    const driverUser = await this.driverUserId(updated.assignedDriverId);
    if (driverUser) {
      await this.notifications.notify(driverUser, {
        type: 'return_items_rejected',
        title: 'Vozvrat qaytarildi',
        body: `Sotuvchi vozvratni qabul qilmadi: ${reason}. Qayta yozing.`,
        relatedOrderId: orderId,
        clientName: updated.clientName,
      });
    }
    return this.toPublic(updated);
  }

  /** Whose call this is: the seller the goods belong to, or the office. */
  private assertReturnItemsOwner(order: OrderWithItems, actor: Actor): void {
    if (actor.role === 'seller' && order.createdBySellerId !== actor.userId) {
      throw new ForbiddenException('Not your order');
    }
    if (order.status !== 'returning') throw new ConflictException('order_invalid_transition');
  }

  /** Complete one pickup's return. The order becomes terminal only after every
   *  required pickup has been handed back. */
  async completeReturn(
    orderId: string,
    pickupId: string,
    actor: Actor,
    photoUrl: string,
    comment: string | null = null,
  ): Promise<OrderPublic> {
    if (!photoUrl?.trim()) {
      throw new BadRequestException('return_photo_required');
    }
    const driverId = await this.resolveWorkingDriverId(actor);
    const order = await this.getOrThrow(orderId);
    this.assertAssigned(order, driverId);
    const source = this.pickupOrThrow(order, pickupId);
    if (
      order.status !== 'returning' ||
      !source.returnRequired ||
      source.returnStage !== 'arrived' ||
      source.returnedAt
    ) {
      throw new ConflictException('return_not_arrived');
    }
    if (needsWarehouse(order, source)) {
      throw new ConflictException('return_waiting_warehouse');
    }

    const completedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // Conditional: two taps on "Topshirdim" claim the stop once, and the
      // second finds nothing to hand back rather than overwriting the proof.
      const claimed = await tx.orderPickupSource.updateMany({
        where: { id: pickupId, returnedAt: null },
        data: { returnProofPhotoUrl: photoUrl, returnedAt: completedAt },
      });
      if (claimed.count === 0) throw new ConflictException('return_already_started');
      await emitOrderEvent(tx, OrderEventType.ReturnDelivered, orderId, {
        orderId,
        pickupId,
        placeName: source.name,
        returnDestination: source.returnDestination,
        photoUrl,
        comment,
      });
      const remaining = await tx.orderPickupSource.count({
        where: {
          orderId,
          returnRequired: true,
          returnedAt: null,
        },
      });
      if (remaining > 0) {
        const updated = await tx.order.update({
          where: { id: orderId },
          data: { returnDestination: source.returnDestination, returnStage: 'arrived' },
          include: ORDER_INCLUDE,
        });
        return { updated, terminal: false, freed: false };
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'returned',
          returnedAt: completedAt,
          returnProofPhotoUrl: photoUrl,
          returnDestination: source.returnDestination,
          returnStage: 'arrived',
        },
        include: ORDER_INCLUDE,
      });
      const freed = (await settleDriverStatus(tx, driverId)).changed;
      await tx.driverAssignment.updateMany({
        where: { orderId, assignmentStatus: 'accepted' },
        data: { assignmentStatus: 'completed' },
      });
      return { updated, terminal: true, freed };
    });

    // Two stops handed back at once: each transaction counted before the other
    // committed, so neither saw itself as the last one and the order stayed
    // `returning` for ever, with every stop returned and no button anywhere.
    // One more look, after both have landed, settles it.
    let terminal = result.terminal;
    if (!terminal) {
      const outstanding = await this.prisma.orderPickupSource.count({
        where: { orderId, returnRequired: true, returnedAt: null },
      });
      if (outstanding === 0) {
        await this.prisma.$transaction(async (tx) => {
          const settled = await tx.order.updateMany({
            where: { id: orderId, status: 'returning' },
            data: { status: 'returned', returnedAt: completedAt, returnProofPhotoUrl: photoUrl },
          });
          if (settled.count === 0) return;
          terminal = true;
          await settleDriverStatus(tx, driverId);
          await tx.driverAssignment.updateMany({
            where: { orderId, assignmentStatus: 'accepted' },
            data: { assignmentStatus: 'completed' },
          });
        });
      }
    }

    const status: OrderStatus = terminal ? 'returned' : 'returning';
    this.realtime.orderStatusChanged(orderId, status, driverId);
    if (result.freed) this.realtime.driverStatusChanged(driverId);
    if (terminal) await this.afterWorkPhoto(driverId);
    return this.toPublic(result.updated, await this.tripCursorFor(driverId));
  }

  /**
   * "Ojidaniya": the return is small and the next order is waiting, so the
   * driver does that first. The goods stay aboard and the return stays his;
   * it only stops being the order in front of him until he takes it up again.
   */
  async deferReturn(orderId: string, actor: Actor): Promise<OrderPublic> {
    const driverId = await this.resolveWorkingDriverId(actor);
    const order = await this.getOrThrow(orderId);
    this.assertAssigned(order, driverId);
    if (order.status !== 'returning') throw new ConflictException('order_invalid_transition');
    // A vozvrat the seller made is the job itself: he goes, he brings it, no
    // setting aside. Ojidaniya is for goods refused during a delivery (owner, 02.11.2026).
    if (order.kind === 'vozvrat') throw new ConflictException('vozvrat_order_cannot_defer');
    await this.prisma.order.update({ where: { id: orderId }, data: { returnDeferredAt: new Date() } });
    return this.findOneForActor(orderId, actor);
  }

  async departReturn(orderId: string, pickupId: string, actor: Actor): Promise<OrderPublic> {
    const r = await this.advanceReturnStage(orderId, pickupId, actor, null, 'heading');
    await this.noteMorningStart(orderId, actor, 'return');
    return r;
  }

  async arriveReturn(orderId: string, pickupId: string, actor: Actor): Promise<OrderPublic> {
    return this.advanceReturnStage(orderId, pickupId, actor, 'heading', 'arrived');
  }

  private async advanceReturnStage(
    orderId: string,
    pickupId: string,
    actor: Actor,
    from: ReturnStage | null,
    to: ReturnStage,
  ): Promise<OrderPublic> {
    const driverId = await this.resolveWorkingDriverId(actor);
    const order = await this.getOrThrow(orderId);
    this.assertAssigned(order, driverId);
    this.assertDriverActionsAvailable(order);
    const source = this.pickupOrThrow(order, pickupId);
    if (
      order.status !== 'returning' ||
      !source.returnRequired ||
      !source.returnDestination ||
      source.returnedAt ||
      (source.returnStage ?? null) !== from
    ) {
      throw new ConflictException('return_invalid_stage');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderPickupSource.update({
        where: { id: pickupId },
        data: { returnStage: to },
      });
      return tx.order.update({
        where: { id: orderId },
        // Taking up a leg brings a set-aside return back to the front.
        data: { returnDestination: source.returnDestination, returnStage: to, returnDeferredAt: null },
        include: ORDER_INCLUDE,
      });
    });
    this.realtime.orderStatusChanged(orderId, 'returning', order.assignedDriverId);
    return this.toPublic(updated);
  }

  private pickupOrThrow(order: OrderWithItems, pickupId: string): PickupSourceRow {
    const source = order.pickupSources.find((p) => p.id === pickupId);
    if (!source) {
      throw new NotFoundException('Pickup source not found');
    }
    return source;
  }

  /** Driver completes delivery: on_the_way → delivered (FR-014); emits the proof event. */
  async completeDelivery(
    orderId: string,
    actor: Actor,
    photoUrl: string,
    comment: string | null = null,
  ): Promise<OrderPublic> {
    if (!photoUrl?.trim()) {
      throw new BadRequestException('delivery_photo_required');
    }
    // Nothing is handed over on a vozvrat trip; at the client the driver
    // writes up what comes back (startReturn), and the order ends 'returned'.
    const current = await this.getOrThrow(orderId);
    if (current.kind === 'vozvrat') {
      throw new ConflictException('order_invalid_transition');
    }
    const order = await this.driverTransition(orderId, 'delivered', actor, OrderEventType.Delivered, {
      photoUrl,
      comment,
    });
    await this.accrueDeliveryBonus(order);
    // A co-load to the same client and the same door (owner, 03.11.2026): one
    // arrival, one photograph. The other order is handed over with it rather
    // than asking the driver to "set off" to where he is standing.
    for (const sibling of await this.coloadedToSameDoor(current)) {
      try {
        if (sibling.status === 'items_collected') await this.departToCustomer(sibling.id, actor);
        const done = await this.driverTransition(sibling.id, 'delivered', actor, OrderEventType.Delivered, { photoUrl, comment });
        await this.accrueDeliveryBonus(done);
      } catch (err) {
        this.logger.warn(`co-load ${sibling.id} not delivered with ${orderId}: ${(err as Error).message}`);
      }
    }
    await this.afterWorkPhoto(order.assigned_driver_id);
    return order;
  }

  /** After hours the photo that finishes his last order ends his day (owner, 03.11.2026). Never fails the order. */
  private async afterWorkPhoto(driverId: string | null): Promise<void> {
    if (!driverId || !this.shiftEnd) return;
    try {
      await this.shiftEnd.afterWorkPhoto(driverId);
    } catch (err) {
      this.logger.warn(`shift close after work photo failed for driver ${driverId}: ${(err as Error).message}`);
    }
  }

  /** Per-trip bonuses after a delivery. Non-blocking: a failure must not fail the delivery. */
  private async accrueDeliveryBonus(order: OrderPublic): Promise<void> {
    try {
      await this.bonus.accrueForDelivery({
        id: order.id,
        regionCode: order.region_code,
        geoDistrictCode: order.district_code,
        priority: order.priority,
        assignedDriverId: order.assigned_driver_id,
      });
    } catch (err) {
      this.logger.error(`Bonus accrual failed for order ${order.id}: ${(err as Error).message}`);
    }
  }

  /**
   * The other orders of this driver's merged trip that go to the same client
   * at the same address, loaded and still undelivered: handed over together.
   */
  private async coloadedToSameDoor(order: { id: string; assignedDriverId: string | null; clientId: string; clientAddressId: string | null }) {
    if (!order.assignedDriverId) return [];
    return this.prisma.order.findMany({
      where: {
        id: { not: order.id },
        assignedDriverId: order.assignedDriverId,
        clientId: order.clientId,
        clientAddressId: order.clientAddressId,
        kind: 'delivery',
        status: { in: ['items_collected', 'on_the_way', 'arrived_at_customer'] },
        pickupSources: { none: { legStatus: { not: 'arrived' } } },
      },
      select: { id: true, status: true },
    });
  }

  private async driverTransition(
    orderId: string,
    to: OrderStatus,
    actor: Actor,
    eventType: string,
    extraPayload: Record<string, unknown> = {},
  ): Promise<OrderPublic> {
    const driverId = await this.resolveWorkingDriverId(actor);
    const order = await this.getOrThrow(orderId);
    this.assertAssigned(order, driverId);
    this.assertDriverActionsAvailable(order);
    if (!canTransitionOrderStatus(order.status as OrderStatus, to, order.kind as OrderKind)) {
      throw new ConflictException('order_invalid_transition');
    }
    if (order.status === 'driver_accepted') await this.assertNoOtherJourneyUnderWay(order, driverId);
    let freedDriver = false;
    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.OrderUpdateInput = { status: to };
      if (to === 'delivered') {
        data.proofPhotoUrl = (extraPayload.photoUrl as string | null | undefined) ?? null;
        data.deliveredAt = new Date();
      }
      // Conditional on the status this call read. The seller's Otmen and the
      // driver's next tap used to overwrite each other: whichever committed
      // second won, so a cancelled order could be marked delivered — tariff
      // paid, group told, and the collected goods left with no return leg —
      // or a delivered one could be dragged back into `returning`.
      const moved = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: data as Prisma.OrderUpdateManyMutationInput,
      });
      if (moved.count === 0) throw new ConflictException('order_already_in_progress');
      const o = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: ORDER_INCLUDE,
      });
      if (to === 'on_the_way') {
        // A vozvrat trip earns no delivery bonus: nothing is delivered.
        if (order.kind !== 'vozvrat') {
          await this.accrueDeliveryTariff(
            tx,
            orderId,
            driverId,
            order.region?.isCity ?? false,
          );
        }
        await tx.driver.update({ where: { id: driverId }, data: { currentStatus: 'on_delivery' } });
      } else if (to === 'delivered') {
        // Only free the driver if nothing else is aboard. Delivering one order
        // of a co-load leaves the other still running, and the return path has
        // always checked this — the delivery path did not, so a driver carrying
        // a second load showed as available. Same query, same constant.
        freedDriver = (await settleDriverStatus(tx, driverId)).changed;
        await tx.driverAssignment.updateMany({
          where: { orderId, assignmentStatus: 'accepted' },
          data: { assignmentStatus: 'completed' },
        });
      }
      await emitOrderEvent(tx, eventType, orderId, { orderId, ...extraPayload });
      return o;
    });
    this.realtime.orderStatusChanged(orderId, to, driverId);
    if (to === 'on_the_way') this.realtime.driverStatusChanged(driverId, 'on_delivery');
    else if (to === 'delivered' && freedDriver) this.realtime.driverStatusChanged(driverId);
    return this.toPublic(updated, await this.tripCursorFor(driverId));
  }

  private async tariffForDriver(tx: Prisma.TransactionClient, driverId: string) {
    const driver = await tx.driver.findUnique({
      where: { id: driverId },
      select: { vehicle: { select: { category: true } } },
    });
    const category = driver?.vehicle?.category;
    return category ? tx.vehicleTariff.findUnique({ where: { category } }) : null;
  }

  private async accruePickupTariff(
    tx: Prisma.TransactionClient,
    orderId: string,
    driverId: string,
    source: PickupSourceRow,
  ): Promise<void> {
    const tariff = await this.tariffForDriver(tx, driverId);
    const isCity = source.region?.isCity ?? source.geoDistrict?.region?.isCity ?? false;
    const type = isCity ? 'pickup_city' : 'pickup_outside';
    const amount = isCity ? (tariff?.pickupCitySom ?? 0) : (tariff?.pickupOutsideSom ?? 0);
    await tx.driverTariffEarning.createMany({
      data: {
        eventKey: 'pickup:' + source.id,
        type,
        amount,
        driverId,
        orderId,
        pickupSourceId: source.id,
      },
      skipDuplicates: true,
    });
  }

  private async accrueDeliveryTariff(
    tx: Prisma.TransactionClient,
    orderId: string,
    driverId: string,
    isCity: boolean,
  ): Promise<void> {
    const tariff = await this.tariffForDriver(tx, driverId);
    const type = isCity ? 'delivery_city' : 'delivery_outside';
    const amount = isCity ? (tariff?.deliveryCitySom ?? 0) : (tariff?.deliveryOutsideSom ?? 0);
    await tx.driverTariffEarning.createMany({
      data: { eventKey: 'delivery:' + orderId, type, amount, driverId, orderId },
      skipDuplicates: true,
    });
  }

  /** The login behind a driver row, for a push to him; null when the order has no driver. */
  private async driverUserId(driverId: string | null): Promise<string | null> {
    if (!driverId) return null;
    const d = await this.prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
    return d?.userId ?? null;
  }

  private async resolveDriverId(actor: Actor): Promise<string> {
    const driver = await this.prisma.driver.findUnique({ where: { userId: actor.userId } });
    if (!driver) {
      throw new ForbiddenException('Only the assigned driver can perform this action');
    }
    return driver.id;
  }

  /**
   * The driver, for a press that does work on an order. Off shift he may open
   * his orders and look, but nothing moves until he presses Ish boshlandi.
   */
  private async resolveWorkingDriverId(actor: Actor): Promise<string> {
    const driverId = await this.resolveDriverId(actor);
    const open = await this.prisma.workLog.count({ where: { driverId, clockOutAt: null } });
    if (open === 0) throw new ConflictException('shift_not_started');
    return driverId;
  }

  private assertAssigned(order: Order, driverId: string): void {
    if (order.assignedDriverId !== driverId) {
      throw new ForbiddenException('Order is not assigned to you');
    }
  }

  /**
   * One job at a time. A driver with a delivery under way may not set off on
   * the next order until this one is handed over: the next is his, it waits,
   * and it opens the moment the current one is delivered. Two orders merged
   * into one trip (po puti) are the one journey and are not held apart.
   */
  private async assertNoOtherJourneyUnderWay(order: Order, driverId: string): Promise<void> {
    const rows = await this.prisma.order.findMany({
      where: { assignedDriverId: driverId, status: { in: [...JOURNEY_UNDER_WAY] } },
      select: { id: true, deliveryTripPosition: true },
    });
    const blocking = rows.filter(
      (r) => r.id !== order.id && !(order.deliveryTripPosition != null && r.deliveryTripPosition != null),
    );
    if (blocking.length > 0) {
      throw new ConflictException('finish_current_order_first');
    }
  }

  private assertDriverActionsAvailable(order: Order): void {
    const availableAt = driverActionsAvailableAt(order);
    if (availableAt && Date.now() < availableAt.getTime()) {
      throw new ConflictException('order_actions_not_available_yet');
    }
  }

  private async assertCanView(order: Order, actor: Actor): Promise<void> {
    if (actor.role === 'admin' || actor.role === 'manager') {
      return;
    }
    if (actor.role === 'seller') {
      if (order.createdBySellerId !== actor.userId) {
        throw new ForbiddenException('Not your order');
      }
      return;
    }
    // driver
    this.assertAssigned(order, await this.resolveDriverId(actor));
  }


  private async getOrThrow(id: string): Promise<OrderWithItems> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /**
   * `tripCursor` is the lowest trip position the driver has not yet completed,
   * across every order they are running. It is only meaningful for a co-load;
   * an ordinary order has no trip positions and ignores it entirely.
   */
  private toPublic(order: OrderWithItems, tripCursor: number | null = null): OrderPublic {
    return {
      id: order.id,
      order_number: order.orderNumber,
      queue_position: order.queuePosition ?? null,
      kind: (order.kind ?? 'delivery') as OrderKind,
      original_order_id: order.originalOrderId ?? null,
      original_order_number: order.originalOrder?.orderNumber ?? null,
      client_id: order.clientId,
      client_name: order.clientName,
      client_phone_number: order.clientPhoneNumber,
      client_address_id: order.clientAddressId,
      client_address_label: order.deliveryAddress?.label ?? null,
      client_address: order.clientAddress,
      delivery_datetime: order.deliveryDatetime.toISOString(),
      actions_available_at: driverActionsAvailableAt(order)?.toISOString() ?? null,
      comment: order.comment,
      priority: order.priority as OrderPriority,
      status: order.status as OrderStatus,
      cancellation_reason: order.cancellationReason,
      // Only while it is still open: a delivered order is no longer "left over".
      carried_over:
        order.carryOvers?.[0] && ACTIVE_ORDER_STATUSES_SET.has(order.status)
          ? {
              reason: order.carryOvers[0].reason as CarryOverReason,
              comment: order.carryOvers[0].comment,
              at: order.carryOvers[0].createdAt.toISOString(),
            }
          : null,
      problem_reason: order.problemReason ?? null,
      problem_comment: order.problemComment ?? null,
      return_reason: order.returnReason ?? null,
      return_destination: (order.returnDestination as ReturnDestination | null) ?? null,
      return_stage: (order.returnStage as ReturnStage | null) ?? null,
      return_proof_photo_url: applyWatermark(order.returnProofPhotoUrl),
      returned_at: order.returnedAt ? order.returnedAt.toISOString() : null,
      return_items_written: order._count?.returnItems ?? 0,
      return_items_confirmed_at: order.returnItemsConfirmedAt?.toISOString() ?? null,
      return_items_confirmed_by: order.returnItemsConfirmedBy?.name ?? null,
      return_items_rejected_at: order.returnItemsRejectedAt?.toISOString() ?? null,
      return_items_reject_reason: order.returnItemsRejectReason ?? null,
      return_seller_culprit: order.returnSellerCulprit ?? null,
      return_deferred_at: order.returnDeferredAt?.toISOString() ?? null,
      start_after_nine: order.startAfterNine ?? false,
      return_seller_note: order.returnSellerNote ?? null,
      proof_photo_url: applyWatermark(order.proofPhotoUrl),
      created_by_seller_id: order.createdBySellerId,
      created_by_seller_name: order.createdBySeller?.name ?? null,
      created_by_seller_phone_number: order.createdBySeller?.phoneNumber ?? null,
      assigned_driver_id: order.assignedDriverId,
      assigned_driver_name: order.assignedDriver?.user.name ?? null,
      region_code: order.regionCode,
      region_name: order.region?.name ?? null,
      district_code: order.geoDistrictCode,
      district_name: order.geoDistrict?.name ?? null,
      delivery_lat: order.deliveryLat,
      delivery_lng: order.deliveryLng,
      delivery_trip_position: order.deliveryTripPosition ?? null,
      is_city: order.region?.isCity ?? false,
      cargo_type_name: order.cargoType?.name ?? null,
      weight_kg: order.weightKg ?? null,
      waybill_source: order.waybillSource ?? null,
      items: order.items.map((i) => this.itemToPublic(i)),
      pickup_sources: (order.pickupSources ?? []).map((p) => this.pickupToPublic(p)),
      next_action: this.computeNextAction(order, tripCursor),
      created_at: order.createdAt.toISOString(),
      updated_at: order.updatedAt.toISOString(),
    };
  }

  private pickupToPublic(p: PickupSourceRow): OrderPickupSourcePublic {
    return {
      id: p.id,
      pickup_place_id: p.pickupPlaceId,
      name: p.name,
      phone_number: p.pickupPlace?.phoneNumber ?? null,
      position: p.position,
      leg_status: p.legStatus,
      region_name: p.region?.name ?? null,
      district_name: p.geoDistrict?.name ?? null,
      lat: p.lat,
      lng: p.lng,
      trip_position: p.tripPosition ?? null,
      load_photo_url: applyWatermark(p.loadPhotoUrl),
      return_required: p.returnRequired,
      return_destination: (p.returnDestination as ReturnDestination | null) ?? null,
      return_place: returnPlaceOf(
        (p.returnDestination as ReturnDestination | null) ?? null,
        {
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          address: [p.geoDistrict?.name, p.region?.name].filter(Boolean).join(', ') || null,
          phone_number: p.pickupPlace?.phoneNumber || p.pickupPlace?.supplier?.phoneNumber || null,
        },
        this.home,
        pickedPlace(p),
      ),
      return_stage: (p.returnStage as ReturnStage | null) ?? null,
      return_proof_photo_url: applyWatermark(p.returnProofPhotoUrl),
      returned_at: p.returnedAt ? p.returnedAt.toISOString() : null,
    };
  }

  /** The single action the assigned driver can take next, from the order status +
   *  per-pickup leg statuses. Drives the one journey button in the mobile app. */
  private computeNextAction(order: OrderWithItems, tripCursor: number | null = null): DriverNextAction {
    const none: DriverNextAction = {
      type: 'none',
      pickup_id: null,
      pickup_name: null,
      pickup_position: null,
    };
    const forStop = (type: DriverNextAction['type'], s: PickupSourceRow): DriverNextAction => ({
      type,
      pickup_id: s.id,
      pickup_name: s.name,
      pickup_position: s.position,
    });
    const sources = [...(order.pickupSources ?? [])].sort((a, b) => a.position - b.position);
    // On the way back the stop is named by where the goods go — BIGANT do'kon,
    // BIGANT sklad, the supplier — not by where they were loaded (owner,
    // 12.11.2026: "BIGANT sklad ga yo'l oldim" for a return bound for the shop).
    const forReturn = (type: DriverNextAction['type'], s: PickupSourceRow): DriverNextAction => {
      const place = returnPlaceOf(
        (s.returnDestination as ReturnDestination | null) ?? null,
        { name: s.name, lat: s.lat, lng: s.lng, address: null },
        this.home,
        pickedPlace(s),
      );
      return { ...forStop(type, s), pickup_name: place?.name ?? s.name };
    };

    // Co-load: the driver's next stop may belong to the *other* order on this
    // trip. Offering this order's button then would send them to the wrong
    // place, so it is withheld until this order's turn comes round.
    const inTrip =
      tripCursor != null &&
      (order.deliveryTripPosition != null || sources.some((src) => src.tripPosition != null));
    if (inTrip) {
      const mine = this.nextTripPositionOf(order, sources);
      if (mine !== null && mine !== tripCursor) {
        return { ...none, type: 'waiting_for_trip_stop' };
      }
    }

    // A vozvrat order has nothing to collect: accepted → the client → write up
    // what comes back → the shared return legs to the place it goes to.
    if (order.kind === 'vozvrat') {
      switch (order.status as OrderStatus) {
        case 'driver_accepted':
          return { ...none, type: 'depart_customer' };
        case 'on_the_way':
        case 'arrived_at_customer':
          return { ...none, type: 'collect_return' };
        default:
          break; // returning and the rest: as for any order
      }
    }

    switch (order.status as OrderStatus) {
      case 'driver_accepted':
      case 'collecting_items': {
        const enRoute = sources.find((s) => s.legStatus === 'en_route');
        if (enRoute) return forStop('arrive_pickup', enRoute);
        const pending = sources.find((s) => s.legStatus === 'pending');
        if (pending) return forStop('depart_pickup', pending);
        // Every stop arrived → head to the customer (only once stops exist).
        return sources.length > 0 ? { ...none, type: 'depart_customer' } : none;
      }
      case 'items_collected':
        return { ...none, type: 'depart_customer' };
      // No "Mijozga yetib keldim" in between (owner, 02.11.2026): on the way he
      // is shown "Yukni topshirdim" with the camera, as the handover itself.
      case 'on_the_way':
      case 'arrived_at_customer':
        return { ...none, type: 'deliver' };
      case 'returning': {
        const returns = sources.filter((source) => source.returnRequired);
        // What the driver wrote up is the seller's goods: he checks the list —
        // and says where it goes — before it travels. Nothing to check means
        // nothing to wait for, so a plain return keeps its old journey.
        const written = order._count?.returnItems ?? 0;
        if (written > 0 && !order.returnItemsConfirmedAt) {
          return {
            ...none,
            type: order.returnItemsRejectedAt ? 'return_rewrite' : 'return_confirm_wait',
          };
        }
        if (returns.some((source) => !source.returnDestination)) {
          return { ...none, type: 'return_configure' };
        }
        const current = returns.find((source) => !source.returnedAt);
        if (!current) return none;
        const stage = current.returnStage as ReturnStage | null;
        if (stage === 'arrived') {
          // Bound for the warehouse with a written list: the storekeeper takes it
          // in (mini app) before the driver may hand it over and close it.
          if (needsWarehouse(order, current)) return forReturn('return_wait_warehouse', current);
          return forReturn('return_complete', current);
        }
        if (stage === 'heading') return forReturn('return_arrive', current);
        return forReturn('return_depart', current);
      }
      default:
        return none;
    }
  }

  /**
   * One cursor for a whole list request. Only a driver has a trip of their own,
   * so for staff and sellers this is null and every order keeps the behaviour
   * it had before co-loads existed.
   */
  private async tripCursorForActor(actor: Actor): Promise<number | null> {
    if (actor.role !== 'driver') return null;
    const driver = await this.prisma.driver.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    return this.tripCursorFor(driver?.id ?? null);
  }

  /** The trip position of the next stop this order still owes, or null. */
  private nextTripPositionOf(order: OrderWithItems, sources: PickupSourceRow[]): number | null {
    // A vozvrat carrying its goods back with a po puti on the trip (owner,
    // 11.11.2026): its stop is the return place, done when handed over.
    if (order.kind === 'vozvrat' && order.status === 'returning') {
      return sources.find((src) => src.tripPosition != null && !src.returnedAt)?.tripPosition ?? null;
    }
    const pending = sources.find((src) => src.legStatus !== 'arrived' && src.tripPosition != null);
    if (pending) return pending.tripPosition;
    const delivered = order.status === 'delivered' || order.status === 'returned';
    return delivered ? null : (order.deliveryTripPosition ?? null);
  }

  /**
   * The lowest trip position the driver has not completed, across every order
   * they are running. Null when nothing they are running is part of a co-load,
   * which keeps ordinary orders on exactly the path they took before.
   */
  private async tripCursorFor(driverId: string | null): Promise<number | null> {
    if (!driverId) return null;
    const running = await this.prisma.order.findMany({
      where: {
        assignedDriverId: driverId,
        // A vozvrat carrying its goods back counts only when a po puti rides with
        // it (owner, 11.11.2026) — an ordinary return has no trip positions, so it
        // adds nothing here and its journey is exactly as before.
        OR: [{ status: { in: [...BLOCKING_ACTIVE_ORDER_STATUSES] } }, { kind: 'vozvrat', status: 'returning' }],
      },
      select: {
        status: true,
        kind: true,
        deliveryTripPosition: true,
        pickupSources: { select: { legStatus: true, tripPosition: true, returnedAt: true } },
      },
    });
    const open: number[] = [];
    for (const o of running) {
      if (o.kind === 'vozvrat' && o.status === 'returning') {
        // Its client is behind it; what is left is the return place, until handed over.
        for (const src of o.pickupSources) if (src.tripPosition != null && !src.returnedAt) open.push(src.tripPosition);
        continue;
      }
      for (const src of o.pickupSources) {
        if (src.tripPosition != null && src.legStatus !== 'arrived') open.push(src.tripPosition);
      }
      if (o.deliveryTripPosition != null) open.push(o.deliveryTripPosition);
    }
    return open.length ? Math.min(...open) : null;
  }

  private itemToPublic(i: OrderItem): OrderItemPublic {
    return {
      id: i.id,
      product_name: i.productName,
      quantity: i.quantity,
      pickup_place_id: i.pickupPlaceId,
      pickup_place_name: i.pickupPlaceName,
      collection_status: i.collectionStatus as ItemCollectionStatus,
      problem_reason: i.problemReason,
      created_at: i.createdAt.toISOString(),
      updated_at: i.updatedAt.toISOString(),
    };
  }
}

/**
 * A return written up item by item and bound for the warehouse is the
 * storekeeper's to take in first (on the warehouse page, /ombor) — and one
 * bound for our shop the shop person's, the same way (owner, 07.11.2026).
 * A supplier takes it with no one counting: the driver just hands it over;
 * so does a plain return with nothing written up. Each stop waits only for
 * its own place, so an order going to both waits for each in turn.
 */
function needsWarehouse(
  order: {
    returnWarehouseAcceptedAt?: Date | null;
    returnStoreAcceptedAt?: Date | null;
    _count?: { returnItems?: number };
  },
  source: { returnDestination: string | null },
): boolean {
  if ((order._count?.returnItems ?? 0) === 0) return false;
  if (source.returnDestination === 'warehouse') return !order.returnWarehouseAcceptedAt;
  if (source.returnDestination === 'store') return !order.returnStoreAcceptedAt;
  return false;
}
