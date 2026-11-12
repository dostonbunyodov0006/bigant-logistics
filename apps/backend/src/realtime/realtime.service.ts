import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { RealtimeEvent, Role } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Can a subscriber with this role (and, for drivers, this driverId) see the event?
 *  Admin/manager/seller see all board-relevant events (id/status only — no order
 *  contents, so nothing sensitive leaks); a driver sees only their own. Pings pass. */
export function canSeeRealtimeEvent(
  role: Role,
  driverId: string | null,
  event: RealtimeEvent,
): boolean {
  if (event.type === 'ping') return true;
  if (role === 'admin' || role === 'manager' || role === 'seller') return true;
  if (role === 'driver') return !!driverId && event.driver_id === driverId;
  return false;
}

/** In-memory, best-effort realtime broadcaster. Single-instance (matches the
 *  outbox design); the durable channel stays the outbox → push/Telegram. */
@Injectable()
export class RealtimeService {
  private readonly subject = new Subject<RealtimeEvent>();

  constructor(private readonly prisma: PrismaService) {}

  /** Live event stream for the SSE endpoint to subscribe to. */
  stream(): Observable<RealtimeEvent> {
    return this.subject.asObservable();
  }

  private emit(event: RealtimeEvent): void {
    this.subject.next(event);
  }

  /** Publish an order status change (fire after the DB transaction commits). */
  orderStatusChanged(orderId: string, status: string, driverId: string | null = null): void {
    this.emit({
      type: 'order_status_changed',
      order_id: orderId,
      driver_id: driverId,
      status,
      at: new Date().toISOString(),
    });
  }

  /** Publish a driver status / availability change (clock, break, delivery flips). */
  driverStatusChanged(driverId: string, status: string | null = null): void {
    this.emit({
      type: 'driver_status_changed',
      order_id: null,
      driver_id: driverId,
      status,
      at: new Date().toISOString(),
    });
  }

  /** Resolve a driver's id from their user id, to filter a driver's own stream. */
  async resolveDriverId(userId: string): Promise<string | null> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true },
    });
    return driver?.id ?? null;
  }
}
