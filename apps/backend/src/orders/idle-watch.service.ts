import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from './orders.service';
import { isActionable } from './order-timing';
import { metresBetween } from '../poputi/poputi.geometry';

/** Minutes before the driver and the seller are told the lorry has not moved. */
export const IDLE_WARN_MIN = 10;
/** Minutes before the order is cancelled (5 more after the warning). */
export const IDLE_CANCEL_MIN = 15;
/** Closer to the first pickup by this much counts as on his way. */
const MOVED_METRES = 200;
/** Already this close to the pickup: there is nowhere nearer to go. */
const AT_PICKUP_METRES = 300;
/** A fix older than this does not say where he is now. */
const FIX_FRESH_MS = 5 * 60_000;

/**
 * Accepted orders still before the first pickup: the ones that can stall.
 * Seller-board bookings are born accepted. An office offer the driver has not
 * accepted is left to the older rule (SchedulingService.expireStaleAssignments):
 * after 10 minutes it goes back to the pool — two clocks on one order would
 * fight.
 */
const WATCHED = ['driver_accepted'];
/** Work that means another order is the driver's turn, not this one. */
const UNDER_WAY = ['collecting_items', 'items_collected', 'on_the_way', 'arrived_at_customer'];

const SYSTEM = { userId: '', role: 'admin' as const };

export type IdleWatchStep = 'started' | 'moved' | 'warned' | 'cancelled' | 'reset' | 'waiting';

/**
 * A lorry a seller booked that does not set off (owner, 30.10.2026): once the
 * order is the driver's turn — he is on shift, nothing else under way, and it
 * is today's work — he has ten minutes to get at least 200 m nearer the first
 * pickup. If not, he ("Harakatlaning, zakaz tomon") and the
 * seller ("Biriktirilgan mashina harakatsiz") are told; five minutes later,
 * still not moving, the order is cancelled and the seller books another.
 *
 * Movement is read from the phone's location, which only comes while the app
 * is open: a driver with the app closed counts as not moving.
 */
@Injectable()
export class IdleWatchService {
  private readonly logger = new Logger(IdleWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(now: Date = new Date()): Promise<Record<string, IdleWatchStep>> {
    const out: Record<string, IdleWatchStep> = {};
    const watched = await this.prisma.order.findMany({
      where: { status: { in: WATCHED as never }, assignedDriverId: { not: null } },
      orderBy: [{ queuePosition: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        status: true,
        assignedDriverId: true,
        createdBySellerId: true,
        clientName: true,
        bookingKind: true,
        deliveryDatetime: true,
        startAfterNine: true,
        idleWatchSince: true,
        idleStartMetres: true,
        idleState: true,
        pickupSources: { select: { position: true, legStatus: true, lat: true, lng: true } },
      },
    });
    if (watched.length === 0) return out;
    const driverIds = [...new Set(watched.map((o) => o.assignedDriverId!))];
    const [drivers, openShifts, busy] = await Promise.all([
      this.prisma.driver.findMany({
        where: { id: { in: driverIds } },
        select: {
          id: true,
          userId: true,
          locationLat: true,
          locationLng: true,
          locationUpdatedAt: true,
          vehicle: { select: { plateNumber: true } },
        },
      }),
      this.prisma.workLog.findMany({ where: { driverId: { in: driverIds }, clockOutAt: null }, select: { driverId: true } }),
      this.prisma.order.findMany({
        where: {
          assignedDriverId: { in: driverIds },
          OR: [{ status: { in: UNDER_WAY as never } }, { status: 'returning', returnDeferredAt: null }],
        },
        select: { assignedDriverId: true },
      }),
    ]);
    const byId = new Map(drivers.map((d) => [d.id, d]));
    const onShift = new Set(openShifts.map((w) => w.driverId));
    const occupied = new Set(busy.map((o) => o.assignedDriverId));
    const turnTaken = new Set<string>();

    for (const o of watched) {
      const driverId = o.assignedDriverId!;
      const driver = byId.get(driverId);
      // Only the driver's next order is watched, and only once it is his turn.
      const isTurn =
        !!driver &&
        onShift.has(driverId) &&
        !occupied.has(driverId) &&
        !turnTaken.has(driverId) &&
        isActionable(o, now);
      if (isTurn) turnTaken.add(driverId);
      if (!isTurn) {
        if (o.idleWatchSince || o.idleState) {
          await this.save(o.id, { idleWatchSince: null, idleStartMetres: null, idleState: null });
          out[o.id] = 'reset';
        }
        continue;
      }
      if (o.idleState === 'moved') continue;

      const pickup = [...o.pickupSources].sort((a, b) => a.position - b.position).find((s) => s.legStatus !== 'arrived');
      if (!pickup || pickup.lat == null || pickup.lng == null) continue;
      const fresh =
        driver!.locationLat != null &&
        driver!.locationLng != null &&
        driver!.locationUpdatedAt != null &&
        now.getTime() - driver!.locationUpdatedAt.getTime() <= FIX_FRESH_MS;
      const dist = fresh
        ? metresBetween({ lat: driver!.locationLat!, lng: driver!.locationLng! }, { lat: pickup.lat, lng: pickup.lng })
        : null;

      if (!o.idleWatchSince) {
        await this.save(o.id, { idleWatchSince: now, idleStartMetres: dist, idleState: 'watching' });
        out[o.id] = 'started';
        continue;
      }
      // The first fix after the watch began becomes the point he is measured from.
      const start = o.idleStartMetres ?? dist;
      if (o.idleStartMetres == null && dist != null) await this.save(o.id, { idleStartMetres: dist });

      const moved =
        dist != null &&
        (dist <= AT_PICKUP_METRES || (start != null && start - dist >= MOVED_METRES));
      if (moved) {
        await this.save(o.id, { idleState: 'moved' });
        out[o.id] = 'moved';
        continue;
      }

      const minutes = (now.getTime() - o.idleWatchSince.getTime()) / 60_000;
      const plate = driver!.vehicle?.plateNumber ?? '';
      if (minutes >= IDLE_CANCEL_MIN && o.idleState === 'warned') {
        try {
          await this.orders.cancel(o.id, `Mashina ${IDLE_CANCEL_MIN} daqiqa harakatlanmadi`, SYSTEM);
        } catch (err) {
          this.logger.warn(`idle cancel of ${o.id} failed: ${(err as Error).message}`);
          continue;
        }
        await this.notifications.notify(driver!.userId, {
          type: 'order.idle_cancelled',
          title: 'Zakaz bekor qilindi',
          body: `${IDLE_CANCEL_MIN} daqiqa ichida zakaz tomon harakatlanmadingiz, zakaz sizdan olib tashlandi.`,
          relatedOrderId: o.id,
          clientName: o.clientName,
        });
        await this.notifications.notify(o.createdBySellerId, {
          type: 'order.idle_cancelled',
          title: 'Zakaz bekor qilindi',
          body: `${plate} ${IDLE_CANCEL_MIN} daqiqa harakatlanmadi — zakaz bekor qilindi, boshqa mashina band qiling.`,
          relatedOrderId: o.id,
          clientName: o.clientName,
        });
        out[o.id] = 'cancelled';
      } else if (minutes >= IDLE_WARN_MIN && o.idleState === 'watching') {
        await this.notifications.notify(driver!.userId, {
          type: 'order.idle_warning',
          title: 'Harakatlaning, zakaz tomon',
          body: `Yuk olish joyiga yo'lga chiqing. ${IDLE_CANCEL_MIN - IDLE_WARN_MIN} daqiqadan keyin zakaz bekor qilinadi.`,
          relatedOrderId: o.id,
          clientName: o.clientName,
        });
        await this.notifications.notify(o.createdBySellerId, {
          type: 'order.idle_warning',
          title: 'Biriktirilgan mashina harakatsiz',
          body: `${plate} ${IDLE_WARN_MIN} daqiqadan beri zakaz tomon harakatlanmayapti. Yana ${IDLE_CANCEL_MIN - IDLE_WARN_MIN} daqiqa kutiladi.`,
          relatedOrderId: o.id,
          clientName: o.clientName,
        });
        await this.save(o.id, { idleState: 'warned' });
        out[o.id] = 'warned';
      } else {
        out[o.id] = 'waiting';
      }
    }
    return out;
  }

  private save(id: string, data: { idleWatchSince?: Date | null; idleStartMetres?: number | null; idleState?: string | null }) {
    return this.prisma.order.update({ where: { id }, data });
  }
}
