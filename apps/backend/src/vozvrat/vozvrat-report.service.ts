import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OmborService } from '../ombor/ombor.service';
import { retryDelayMs, type VozvratPayload } from './vozvrat-payload';

export type SendOutcome = 'sent' | 'retry' | 'skipped';

/** How long one attempt may hold a report. */
const CLAIM_MS = 2 * 60_000;

/**
 * Hands a confirmed vozvrat to the warehouse (owner, 05.11.2026: the
 * warehouse page lives on this server now, not in the mini app). A report is
 * saved with the return, handed over once the seller confirms, and — should
 * that fail — retried by VozvratReportDispatcher until it lands.
 * (owner, 07.11.2026) A store-bound return goes to the shop's person instead,
 * and a supplier-bound one to no one: receive() takes nothing in, and the
 * report is still marked sent, so it is not tried again.
 */
@Injectable()
export class VozvratReportService {
  private readonly logger = new Logger(VozvratReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ombor: OmborService,
  ) {}

  /** Hand one report over now. Never throws: the return must not fail because of it. */
  async deliver(orderId: string, now: Date = new Date()): Promise<SendOutcome> {
    const report = await this.prisma.vozvratReport.findUnique({ where: { orderId } });
    if (!report || report.status !== 'pending') return 'skipped';
    // Claim it first: the seller's confirm hands it over inline and the
    // sweeper comes round every minute.
    const claimed = await this.prisma.vozvratReport.updateMany({
      where: { id: report.id, status: 'pending', nextAttemptAt: report.nextAttemptAt },
      data: { nextAttemptAt: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claimed.count === 0) return 'skipped';
    const attempts = report.attempts + 1;
    try {
      await this.ombor.receive(orderId, report.payload as VozvratPayload);
    } catch (err) {
      const error = (err as Error).message.slice(0, 500);
      await this.prisma.vozvratReport.update({
        where: { id: report.id },
        data: { attempts, lastError: error, nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)) },
      });
      this.logger.warn(`vozvrat for order ${orderId} not handed to the warehouse: ${error} — will retry`);
      return 'retry';
    }
    await this.prisma.vozvratReport.update({
      where: { id: report.id },
      data: { status: 'sent', attempts, lastError: null, sentAt: now },
    });
    return 'sent';
  }

  /** Every pending report whose retry time has come. */
  async runDue(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.vozvratReport.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: now } },
      select: { orderId: true },
      take: 50,
    });
    for (const r of due) await this.deliver(r.orderId, now);
    return due.length;
  }
}
