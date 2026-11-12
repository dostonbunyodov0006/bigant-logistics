import { Injectable, Logger, Optional } from '@nestjs/common';
import { BLOCKING_ACTIVE_ORDER_STATUSES, POPUTI_TRAFFIC_FACTOR, poputiDwellSeconds } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ValhallaService } from '../routing/valhalla.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FRESH_POSITION_MIN } from './poputi.service';

/** Late by more than this before the first seller is told — a few minutes either way is noise. */
export const POPUTI_LATE_TOLERANCE_MIN = 5;

type Stop = { lat: number; lng: number; position: number; hostClient: boolean; kind: 'pickup' | 'client' };

/**
 * Pure: the driver's stops still ahead, in trip order, up to and including
 * the first seller's client. Null when that client is not on the trip.
 */
export function stopsUntilHostClient(
  hostOrderId: string,
  orders: {
    id: string;
    deliveryLat: number | null;
    deliveryLng: number | null;
    deliveryTripPosition: number | null;
    pickupSources: { lat: number | null; lng: number | null; tripPosition: number | null; legStatus: string }[];
  }[],
): Stop[] | null {
  const stops: Stop[] = [];
  for (const o of orders) {
    for (const p of o.pickupSources) {
      if (p.tripPosition != null && p.legStatus !== 'arrived' && p.lat != null && p.lng != null) {
        stops.push({ lat: p.lat, lng: p.lng, position: p.tripPosition, hostClient: false, kind: 'pickup' });
      }
    }
    if (o.deliveryTripPosition != null && o.deliveryLat != null && o.deliveryLng != null) {
      stops.push({ lat: o.deliveryLat, lng: o.deliveryLng, position: o.deliveryTripPosition, hostClient: o.id === hostOrderId, kind: 'client' });
    }
  }
  stops.sort((a, b) => a.position - b.position);
  const at = stops.findIndex((s) => s.hostClient);
  return at === -1 ? null : stops.slice(0, at + 1);
}

/** Pure: minutes past the latest time, or null when still within it (tolerance included). */
export function minutesLate(eta: Date, deadline: Date): number | null {
  const late = (eta.getTime() - deadline.getTime()) / 60_000;
  return late > POPUTI_LATE_TOLERANCE_MIN ? Math.round(late) : null;
}

const hhmm = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });

/**
 * On the road, a po puti can turn out slower than planned — a jam, an
 * accident, a pickup that was not ready. Every few minutes the first seller's
 * client is re-timed from where the driver is now, and if he will get his
 * goods later than the time agreed when the po puti joined, that seller is
 * told once, with the new time (owner, 11.11.2026). The driver is not turned
 * back: the second seller's goods are on board or waiting for him.
 */
@Injectable()
export class PoputiLateWatchService {
  private readonly logger = new Logger(PoputiLateWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly valhalla: ValhallaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async sweep(now: Date = new Date()): Promise<{ told: string[] }> {
    const hosts = await this.prisma.order.findMany({
      where: {
        poputiClientDeadlineAt: { not: null },
        poputiLateToldAt: null,
        status: { in: [...BLOCKING_ACTIVE_ORDER_STATUSES] },
        assignedDriverId: { not: null },
        deliveryTripPosition: { not: null },
      },
      select: {
        id: true,
        orderNumber: true,
        clientName: true,
        createdBySellerId: true,
        assignedDriverId: true,
        poputiClientDeadlineAt: true,
      },
    });
    const told: string[] = [];
    for (const host of hosts) {
      try {
        const eta = await this.etaOfClient(host.id, host.assignedDriverId!, now);
        if (!eta) continue;
        const late = minutesLate(eta, host.poputiClientDeadlineAt!);
        if (late == null) continue;
        await this.prisma.order.update({ where: { id: host.id }, data: { poputiLateToldAt: now } });
        told.push(host.id);
        await this.notifications?.notify(host.createdBySellerId, {
          type: 'poputi.host_late',
          title: 'Zakazingiz kechikmoqda',
          body: `№${host.orderNumber} (${host.clientName}): yo'lda kechikish bor. Mijozingiz yukni taxminan ${hhmm(eta)} da oladi — kelishilgan vaqtdan ~${late} daqiqa kech. Mijozingizni ogohlantiring.`,
          relatedOrderId: host.id,
        });
      } catch (err) {
        this.logger.warn(`po puti late check for ${host.id} failed: ${(err as Error)?.message}`);
      }
    }
    return { told };
  }

  /** When the first seller's client gets his goods, from where the driver is now. Null when it cannot be told. */
  private async etaOfClient(hostOrderId: string, driverId: string, now: Date): Promise<Date | null> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { locationLat: true, locationLng: true, locationUpdatedAt: true },
    });
    if (driver?.locationLat == null || driver.locationLng == null || !driver.locationUpdatedAt) return null;
    // An old position would time the trip from the wrong place: wait for a fresh one.
    if (now.getTime() - driver.locationUpdatedAt.getTime() > FRESH_POSITION_MIN * 60_000) return null;
    const orders = await this.prisma.order.findMany({
      where: { assignedDriverId: driverId, status: { in: [...BLOCKING_ACTIVE_ORDER_STATUSES] } },
      select: {
        id: true,
        deliveryLat: true,
        deliveryLng: true,
        deliveryTripPosition: true,
        pickupSources: { select: { lat: true, lng: true, tripPosition: true, legStatus: true } },
      },
    });
    const stops = stopsUntilHostClient(hostOrderId, orders);
    if (!stops) return null;
    const route = await this.valhalla.route({
      locations: [{ lat: driver.locationLat, lon: driver.locationLng }, ...stops.map((s) => ({ lat: s.lat, lon: s.lng }))],
      costing: 'auto',
      language: 'ru-RU',
    });
    // The same arithmetic as when the po puti joined: road ×1.5, loading or unloading at each stop before him.
    const seconds = route.summary.time_seconds * POPUTI_TRAFFIC_FACTOR + poputiDwellSeconds(stops.slice(0, -1));
    return new Date(now.getTime() + seconds * 1000);
  }
}
