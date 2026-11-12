import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Keeps the two queue tables from growing without bound.
 *
 * Performance is already handled by the partial index on pending rows — the
 * dispatcher's poll cost does not depend on how many processed events exist.
 * This is purely about disk, so the windows are deliberately long: outbox rows
 * are the durable record of what happened (they are why notifications can be
 * pruned aggressively), and shortening this trades that history away.
 */
export const OUTBOX_RETENTION_DAYS = 180;
/** Telegram rows are delivery receipts; only failed ones are ever read again
 *  (the admin retry screen), so those are never pruned. */
export const TELEGRAM_SENT_RETENTION_DAYS = 90;

const DAY_MS = 86_400_000;

export interface QueueRetentionResult {
  outboxDeleted: number;
  telegramDeleted: number;
}

@Injectable()
export class QueueRetentionService {
  private readonly logger = new Logger(QueueRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sweep(now: Date = new Date()): Promise<QueueRetentionResult> {
    const [outbox, telegram] = await Promise.all([
      this.prisma.outboxEvent.deleteMany({
        where: {
          status: 'processed',
          createdAt: { lt: new Date(now.getTime() - OUTBOX_RETENTION_DAYS * DAY_MS) },
        },
      }),
      this.prisma.telegramReport.deleteMany({
        where: {
          // 'failed' rows stay: they are still retryable from the admin screen.
          status: 'sent',
          createdAt: { lt: new Date(now.getTime() - TELEGRAM_SENT_RETENTION_DAYS * DAY_MS) },
        },
      }),
    ]);

    const result = { outboxDeleted: outbox.count, telegramDeleted: telegram.count };
    if (result.outboxDeleted + result.telegramDeleted > 0) {
      this.logger.log(
        `Pruned ${result.outboxDeleted} processed outbox event(s) and ` +
          `${result.telegramDeleted} sent Telegram report(s)`,
      );
    }
    return result;
  }
}
