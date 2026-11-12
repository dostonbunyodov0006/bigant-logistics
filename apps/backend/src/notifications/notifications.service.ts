import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import type { NotificationChannel, NotificationPublic, RegisterPushTokenInput, Role } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PushSender } from './push.sender';
import { renderPushUz } from './notification-messages';

type Actor = { userId: string; role: Role };

interface NotifyInput {
  type: string;
  title: string;
  body: string;
  relatedOrderId?: string | null;
  /** The client the order is for — named in the push instead of any number. */
  clientName?: string | null;
  /** Rides along on the push only (FCM data: strings), for the app to route a tap. */
  data?: Record<string, string>;
}

const ORDER_CLIENT = { relatedOrder: { select: { clientName: true } } } as const;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushSender,
  ) {}

  /** Persist an in-app notification and attempt a push delivery. */
  async notify(recipientUserId: string, input: NotifyInput): Promise<void> {
    return this.notifyMany([recipientUserId], input);
  }

  /**
   * Fan one notification out to many recipients in three round-trips — one
   * bulk insert, one token lookup, one multicast — rather than three per
   * person. Everyone receives identical text, so there is nothing to gain
   * from writing and sending them one at a time.
   */
  async notifyMany(userIds: string[], input: NotifyInput): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return;

    await this.prisma.notification.createMany({
      data: unique.map((recipientUserId) => ({
        recipientUserId,
        type: input.type,
        title: input.title,
        body: input.body,
        relatedOrderId: input.relatedOrderId ?? null,
        channel: 'in_app',
        status: 'sent',
      })),
    });
    // Push goes to drivers (Uzbek-only app), so the tray text is sent in Uzbek.
    // The stored in-app notification keeps its type and is translated client-side.
    const push = renderPushUz(input.type, input.clientName ?? null) ?? { title: input.title, body: input.body };
    await this.push.sendToMany(unique, push.title, push.body, input.data);
  }

  async listMine(actor: Actor): Promise<NotificationPublic[]> {
    const rows = await this.prisma.notification.findMany({
      where: { recipientUserId: actor.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: ORDER_CLIENT,
    });
    return rows.map((n) => this.toPublic(n));
  }

  async unreadCount(actor: Actor): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { recipientUserId: actor.userId, readAt: null },
    });
    return { unread };
  }

  async markRead(id: string, actor: Actor): Promise<NotificationPublic> {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) {
      throw new NotFoundException('Notification not found');
    }
    if (n.recipientUserId !== actor.userId) {
      throw new ForbiddenException('Not your notification');
    }
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
      include: ORDER_CLIENT,
    });
    return this.toPublic(updated);
  }

  async markAllRead(actor: Actor): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientUserId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  async registerPushToken(userId: string, input: RegisterPushTokenInput): Promise<{ ok: true }> {
    await this.prisma.pushToken.upsert({
      where: { fcmToken: input.fcm_token },
      update: { userId, platform: input.platform },
      create: { userId, fcmToken: input.fcm_token, platform: input.platform },
    });
    return { ok: true };
  }

  async removePushToken(userId: string, token: string): Promise<{ ok: true }> {
    await this.prisma.pushToken.deleteMany({ where: { fcmToken: token, userId } });
    return { ok: true };
  }

  private toPublic(n: Notification & { relatedOrder?: { clientName: string } | null }): NotificationPublic {
    return {
      id: n.id,
      recipient_user_id: n.recipientUserId,
      type: n.type,
      title: n.title,
      body: n.body,
      related_order_id: n.relatedOrderId,
      client_name: n.relatedOrder?.clientName ?? null,
      channel: n.channel as NotificationChannel,
      read_at: n.readAt ? n.readAt.toISOString() : null,
      created_at: n.createdAt.toISOString(),
    };
  }
}
