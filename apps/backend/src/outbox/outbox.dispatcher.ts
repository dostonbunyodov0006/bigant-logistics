import { shiftStartLabel } from '../common/shift-clock';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Order, OutboxEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService, type ReturnItemLine } from '../telegram/telegram.service';
import { OrderEventType } from './events';
import type { Env } from '../config/env.validation';
import { whenLeader } from '../common/worker-lease';
import { shiftDayKey } from '../drivers/shift-time';

/** The assignment push for a driver whose shift today is already closed. */
const ASSIGNED_START_SHIFT = 'order.assigned_start_shift';

/** Retries: 30 s, 1, 2, 4, 8 min — six tries over about a quarter of an hour. */
const OUTBOX_MAX_ATTEMPTS = 6;
export function outboxRetryDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 8 * 60_000);
}

/**
 * Polls the transactional outbox and fans events out to notifications and
 * Telegram. An in-process poller (no external broker) — sufficient for a
 * single-instance MVP; can be swapped for BullMQ/Redis to scale out.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly enabled: boolean;
  private readonly intervalMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('WORKER_ENABLED', { infer: true }) &&
      config.get('NODE_ENV', { infer: true }) !== 'test';
    this.intervalMs = config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Outbox dispatcher disabled');
      return;
    }
    this.timer = setInterval(() => void whenLeader(() => this.processPending()), this.intervalMs);
    this.logger.log(`Outbox dispatcher polling every ${this.intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async processPending(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const now = new Date();
      const events = await this.prisma.outboxEvent.findMany({
        where: { status: 'pending', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const event of events) {
        try {
          await this.handle(event);
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'processed', processedAt: new Date(), lastError: null },
          });
        } catch (err) {
          // A database blip or a push that threw used to park the event as
          // `failed` for good, and with it the staff notification and the
          // Telegram report it carried. Now it waits and is tried again.
          const message = (err as Error).message;
          const attempts = event.attempts + 1;
          const givenUp = attempts >= OUTBOX_MAX_ATTEMPTS;
          this.logger.error(
            `Failed to dispatch outbox event ${event.id} (${event.eventType}), attempt ${attempts}: ${message}`,
          );
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              attempts,
              status: givenUp ? 'failed' : 'pending',
              nextAttemptAt: givenUp ? null : new Date(Date.now() + outboxRetryDelayMs(attempts)),
              lastError: message.slice(0, 500),
            },
          });
        }
      }
      // Telegram reports that failed once (a timeout, a 5xx) wait as `pending`
      // with a retry count; nothing else picks them up again.
      await this.telegram.retryPending();
    } catch (err) {
      // A database blip here is an unhandled rejection otherwise — and on
      // Node 20 that ends the process.
      this.logger.error(`Outbox poll failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async handle(event: OutboxEvent): Promise<void> {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const orderId = payload.orderId as string | undefined;
    if (!orderId) {
      return;
    }
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return;
    }

    switch (event.eventType) {
      case OrderEventType.Assigned:
        // His shift for today already closed: told to press «Ishni boshlash»,
        // which carries the same shift on (owner, 04.11.2026).
        await this.notifyDriver(
          order,
          (await this.dayShiftClosed(order)) ? ASSIGNED_START_SHIFT : event.eventType,
          'New order assigned',
          `You have been assigned the order for ${order.clientName}`,
        );
        break;
      case OrderEventType.Cancelled:
        await this.notifyDriver(order, event.eventType, 'Order cancelled', `The order for ${order.clientName} was cancelled`);
        break;
      case OrderEventType.Accepted:
        await this.notifyStaff(order, event.eventType, 'Driver accepted order', `The order for ${order.clientName} was accepted by the driver`);
        break;
      case OrderEventType.Rejected:
        await this.notifyStaff(order, event.eventType, 'Driver rejected order', `The order for ${order.clientName} was rejected and is back in the pool`);
        break;
      case OrderEventType.AssignmentExpired:
        await this.notifyStaff(order, event.eventType, 'Assignment expired', `The order for ${order.clientName} was not accepted in time and is back in the pool`);
        break;
      case OrderEventType.Problem:
        await this.notifyStaff(order, event.eventType, 'Problem reported', `A problem was reported on the order for ${order.clientName}`);
        break;
      case OrderEventType.StatusChanged:
        // Deliberately no notification. Routine transitions (collecting → on the
        // way → arrived …) were 66% of all notifications and half went unread —
        // noise that buried the events people actually need to act on. Live
        // status already reaches sellers over SSE, which is the right channel
        // for it; the outbox row remains the durable record.
        break;
      case OrderEventType.Delivered:
        // The Telegram report is written (and retried) on its own, so it goes
        // first: a retry of this event after a notification hiccup cannot
        // post the photo twice.
        await this.telegram.createForDelivery(
          order,
          (payload.photoUrl as string | null) ?? null,
          (payload.comment as string | null) ?? null,
        );
        await this.notifyStaff(order, event.eventType, 'Order delivered', `The order for ${order.clientName} has been delivered`);
        break;
      case OrderEventType.ReturnDelivered:
        await this.telegram.createForVozrat(
          order,
          (payload.photoUrl as string | null) ?? null,
          (payload.comment as string | null) ?? null,
        );
        await this.notifyStaff(order, event.eventType, 'Return handed back', `The return for ${order.clientName} was handed back`);
        break;
      case OrderEventType.ReturnWrittenUp:
        // The items the client sent back, as one album. Telegram-only: the
        // seller already sees the write-up on the order.
        await this.telegram.createForReturnItems(
          order,
          (payload.items as ReturnItemLine[] | undefined) ?? [],
        );
        break;
      case OrderEventType.StartMovedEarlier:
        await this.notifyDriver(order, event.eventType, 'Order moved earlier', `The order for ${order.clientName} no longer waits for ${shiftStartLabel()}`);
        break;
      case OrderEventType.StartMovedLater:
        await this.notifyDriver(order, event.eventType, `Order moved after ${shiftStartLabel()}`, `The order for ${order.clientName} now starts at ${shiftStartLabel()}`);
        break;
      case OrderEventType.PickupLoaded:
        // Telegram-only (no in-app seller notification): post the loaded-goods photo.
        await this.telegram.createForPickup(
          order,
          (payload.placeName as string | null) ?? null,
          (payload.photoUrl as string | null) ?? null,
          (payload.comment as string | null) ?? null,
          (payload.pickupId as string | null) ?? null,
        );
        break;
      default:
        this.logger.warn(`Unknown outbox event type: ${event.eventType}`);
    }
  }

  /** Off shift, with a shift already worked and closed this shift day, and the order is for today. */
  private async dayShiftClosed(order: Order): Promise<boolean> {
    if (!order.assignedDriverId) return false;
    const now = new Date();
    if (shiftDayKey(order.deliveryDatetime) > shiftDayKey(now)) return false;
    const last = await this.prisma.workLog.findFirst({
      where: { driverId: order.assignedDriverId },
      orderBy: { clockInAt: 'desc' },
      select: { clockInAt: true, clockOutAt: true },
    });
    return !!last?.clockOutAt && shiftDayKey(last.clockInAt) === shiftDayKey(now);
  }

  private async notifyDriver(order: Order, type: string, title: string, body: string): Promise<void> {
    if (!order.assignedDriverId) {
      return;
    }
    const driver = await this.prisma.driver.findUnique({ where: { id: order.assignedDriverId } });
    if (driver) {
      await this.notifications.notify(driver.userId, { type, title, body, relatedOrderId: order.id, clientName: order.clientName });
    }
  }

  private async notifyStaff(order: Order, type: string, title: string, body: string): Promise<void> {
    // Managers run dispatch too; every other staff fan-out in the app
    // (leave, documents, service) already addresses both roles.
    const staff = await this.prisma.user.findMany({
      where: { role: { in: ['admin', 'manager'] }, status: 'active' },
      select: { id: true },
    });
    const recipients = [order.createdBySellerId, ...staff.map((a) => a.id)];
    await this.notifications.notifyMany(recipients, { type, title, body, relatedOrderId: order.id, clientName: order.clientName });
  }
}
