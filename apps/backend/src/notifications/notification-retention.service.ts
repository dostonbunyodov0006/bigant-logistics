import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Notifications are an inbox, not the record — every domain event is kept
 * permanently in `outbox_events` — so old rows can be pruned without losing
 * anything factual.
 *
 * The policy is read-aware on purpose: a flat age cut-off would silently delete
 * things nobody ever saw (a driver on leave for a week would come back to an
 * empty tray). Read items go early; unread ones get a month.
 */
export const READ_RETENTION_DAYS = 7;
export const UNREAD_RETENTION_DAYS = 30;
/** Hard ceiling per recipient, so one noisy day cannot blow up a single inbox.
 *  The UI only ever shows the newest 100. */
export const MAX_PER_RECIPIENT = 200;

const DAY_MS = 86_400_000;

export interface RetentionResult {
  readExpired: number;
  unreadExpired: number;
  overCap: number;
}

@Injectable()
export class NotificationRetentionService {
  private readonly logger = new Logger(NotificationRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sweep(now: Date = new Date()): Promise<RetentionResult> {
    const readCutoff = new Date(now.getTime() - READ_RETENTION_DAYS * DAY_MS);
    const unreadCutoff = new Date(now.getTime() - UNREAD_RETENTION_DAYS * DAY_MS);

    // The app's crash and start-up reports are for days, not for ever (06.11.2026).
    await this.prisma.clientReport.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } } });

    const [read, unread] = await Promise.all([
      this.prisma.notification.deleteMany({
        where: { readAt: { not: null, lt: readCutoff } },
      }),
      this.prisma.notification.deleteMany({
        where: { readAt: null, createdAt: { lt: unreadCutoff } },
      }),
    ]);

    // Per-recipient cap. Prisma has no window functions, and doing this per user
    // would be a query per user, so it goes out as one statement.
    const overCap = await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM "notifications"
      WHERE "id" IN (
        SELECT "id" FROM (
          SELECT "id",
                 ROW_NUMBER() OVER (
                   PARTITION BY "recipient_user_id" ORDER BY "created_at" DESC
                 ) AS rn
          FROM "notifications"
        ) ranked
        WHERE ranked.rn > ${MAX_PER_RECIPIENT}
      )
    `);

    const result = {
      readExpired: read.count,
      unreadExpired: unread.count,
      overCap,
    };
    const total = result.readExpired + result.unreadExpired + result.overCap;
    if (total > 0) {
      this.logger.log(
        `Pruned ${total} notification(s): ${result.readExpired} read, ` +
          `${result.unreadExpired} unread, ${result.overCap} over the per-user cap`,
      );
    }
    return result;
  }
}
