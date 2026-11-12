import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EtaService } from './eta.service';

/**
 * A Polniy with one order on it (owner, 02.11.2026): the lorry is the
 * seller's for as long as he keeps it working. When the only order is about
 * to end — delivered, or a return carried to its place — he is told, five
 * minutes before the ETA, to put the next one on. If none is on it when that
 * order ends, the lorry is Bo'sh for anyone (the board stops counting it:
 * SellerBoardService). An order that ended before the reminder was due — a
 * short trip, or a return set aside with Ojidaniya — tells him instead that
 * the lorry has gone Bo'sh, so he never finds out from the board alone.
 */
export const REMIND_BEFORE_SECONDS = 5 * 60;
/** The last leg of an order: to the client, or carrying a return to its place. */
const HEAD_STATUSES = ['on_the_way', 'arrived_at_customer', 'returning'] as const;
const CLOSED = ['delivered', 'cancelled', 'returned'] as const;
/** An order that ended this long ago is still news; older ones predate this rule. */
const ENDED_WINDOW_MS = 10 * 60_000;
/** The sweep reads every order; access is not the question here. */
const SYSTEM = { userId: 'system', role: 'admin' as const };

export type ReminderStep = 'reminded' | 'ended' | 'has_next' | 'not_yet' | 'no_booking';

@Injectable()
export class PolniyReminderService {
  private readonly logger = new Logger(PolniyReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eta: EtaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(now: Date = new Date()): Promise<Record<string, ReminderStep>> {
    const out: Record<string, ReminderStep> = {};
    const rows = await this.prisma.order.findMany({
      where: {
        fullBooking: true,
        polniyRemindedAt: null,
        OR: [
          { status: { in: [...HEAD_STATUSES] } },
          { status: { in: ['delivered', 'returned'] }, updatedAt: { gte: new Date(now.getTime() - ENDED_WINDOW_MS) } },
        ],
      },
      select: {
        id: true,
        status: true,
        returnDeferredAt: true,
        createdBySellerId: true,
        clientName: true,
        reservation: { select: { id: true, groupId: true } },
        assignedDriver: { select: { vehicle: { select: { plateNumber: true } } } },
      },
    });
    for (const o of rows) {
      if (!o.reservation?.groupId) {
        out[o.id] = 'no_booking';
        continue;
      }
      // Another slot or order in the same Polniy: he has already put the next one on.
      const others = await this.prisma.reservation.count({
        where: {
          groupId: o.reservation.groupId,
          id: { not: o.reservation.id },
          OR: [{ status: { in: ['awaiting', 'queued'] } }, { order: { status: { notIn: [...CLOSED] } } }],
        },
      });
      if (others > 0) {
        out[o.id] = 'has_next';
        continue;
      }
      const plate = o.assignedDriver?.vehicle?.plateNumber ?? 'Mashina';
      const ended = o.status === 'delivered' || o.status === 'returned' || (o.status === 'returning' && !!o.returnDeferredAt);
      if (ended) {
        await this.notifications.notify(o.createdBySellerId, {
          type: 'order.polniy_ended',
          title: "Mashina bo'shga chiqdi",
          body: `${plate} zakazni tugatdi, keyingi zakaz biriktirilmagan — Polniy bron tugadi, mashina bo'sh.`,
          relatedOrderId: o.id,
          clientName: o.clientName,
        });
        await this.prisma.order.update({ where: { id: o.id }, data: { polniyRemindedAt: now } });
        out[o.id] = 'ended';
        continue;
      }
      let left: number | null = null;
      try {
        const eta = await this.eta.forOrder(o.id, SYSTEM);
        left = eta.trip_total?.eta_seconds ?? null;
      } catch (err) {
        this.logger.warn(`eta for ${o.id} failed: ${(err as Error).message}`);
      }
      // No ETA to go by (no position yet): told now rather than never.
      if (left !== null && left > REMIND_BEFORE_SECONDS) {
        out[o.id] = 'not_yet';
        continue;
      }
      const minutes = left === null ? null : Math.max(1, Math.round(left / 60));
      await this.notifications.notify(o.createdBySellerId, {
        type: 'order.polniy_next',
        title: '2-zakazni biriktiring',
        body:
          `${plate} ${minutes === null ? 'tez orada' : `~${minutes} daqiqada`} hozirgi zakazni tugatadi. ` +
          "Keyingi zakaz biriktirilmasa mashina Polniy brondan chiqib bo'shga o'tadi.",
        relatedOrderId: o.id,
        clientName: o.clientName,
      });
      await this.prisma.order.update({ where: { id: o.id }, data: { polniyRemindedAt: now } });
      out[o.id] = 'reminded';
    }
    return out;
  }
}
