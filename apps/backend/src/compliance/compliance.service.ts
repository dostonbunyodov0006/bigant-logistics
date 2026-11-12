import { Injectable, Logger } from '@nestjs/common';
import type { DocumentExpiryStats, ExpiringDocument } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** A document counts as "expiring soon" within this many days of its expiry. */
const SOON_DAYS = 30;
const MS_PER_DAY = 86_400_000;

type ExpiryStage = 'expired' | 'soon';

/** Minimal shape shared by driver and vehicle documents for expiry mapping. */
type ExpiringDoc = { id: string; type: string; number: string | null; expiresAt: Date };

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Every vehicle + driver document that is expired or expiring within 30 days. */
  async listExpiring(): Promise<DocumentExpiryStats> {
    const now = new Date();
    const { driverDocs, vehicleDocs } = await this.fetchExpiring(now);

    const documents: ExpiringDocument[] = [
      ...vehicleDocs.map((d) =>
        this.toExpiring('vehicle', d.vehicleId, d.vehicle.plateNumber, d, now),
      ),
      ...driverDocs.map((d) => this.toExpiring('driver', d.driverId, d.driver.user.name, d, now)),
    ];
    // Most urgent first: expired (negative days) before expiring-soon, soonest first.
    documents.sort((a, b) => a.days_until_expiry - b.days_until_expiry);

    const expired = documents.filter((d) => d.status === 'expired').length;
    return {
      expired_count: expired,
      soon_count: documents.length - expired,
      total: documents.length,
      documents,
    };
  }

  /**
   * Notify admins/managers about documents that have newly crossed into an
   * "expiring soon" or "expired" stage since the last sweep. Idempotent per
   * stage via the `expiryNotifiedStage` marker, so it never spams on repeat runs.
   */
  async sweepAndNotify(): Promise<{ notified: number }> {
    const now = new Date();
    const { driverDocs, vehicleDocs } = await this.fetchExpiring(now);

    let expiredNew = 0;
    let soonNew = 0;
    /** Stamping is deferred: a document counts as notified only once it is. */
    const stamp: (() => Promise<unknown>)[] = [];

    for (const d of driverDocs) {
      const stage = this.stageOf(d.expiresAt, now);
      if (d.expiryNotifiedStage !== stage) {
        if (stage === 'expired') expiredNew++;
        else soonNew++;
        stamp.push(() =>
          this.prisma.driverDocument.update({
            where: { id: d.id },
            data: { expiryNotifiedStage: stage },
          }),
        );
      }
    }
    for (const d of vehicleDocs) {
      const stage = this.stageOf(d.expiresAt, now);
      if (d.expiryNotifiedStage !== stage) {
        if (stage === 'expired') expiredNew++;
        else soonNew++;
        stamp.push(() =>
          this.prisma.vehicleDocument.update({
            where: { id: d.id },
            data: { expiryNotifiedStage: stage },
          }),
        );
      }
    }

    if (expiredNew + soonNew === 0) {
      return { notified: 0 };
    }

    const recipients = await this.prisma.user.findMany({
      where: { role: { in: ['admin', 'manager'] }, status: 'active' },
      select: { id: true },
    });
    // If this throws, nothing is stamped and the next sweep tries again —
    // a licence that is about to expire is not something to announce once
    // into a failure and never mention again.
    await this.notifications.notifyMany(
      recipients.map((r) => r.id),
      {
        type: 'document.expiry_reminder',
        title: 'Hujjat muddati eslatmasi',
        body: this.buildBody(expiredNew, soonNew),
      },
    );
    await Promise.all(stamp.map((write) => write()));
    this.logger.log(
      `Document expiry sweep: ${expiredNew} expired, ${soonNew} soon → notified ${recipients.length} staff`,
    );
    return { notified: recipients.length };
  }

  private fetchExpiring(now: Date) {
    const horizon = new Date(now.getTime() + SOON_DAYS * MS_PER_DAY);
    return Promise.all([
      this.prisma.driverDocument.findMany({
        where: { expiresAt: { lte: horizon } },
        include: { driver: { include: { user: true } } },
      }),
      this.prisma.vehicleDocument.findMany({
        where: { expiresAt: { lte: horizon } },
        include: { vehicle: true },
      }),
    ]).then(([driverDocs, vehicleDocs]) => ({ driverDocs, vehicleDocs }));
  }

  private stageOf(expiresAt: Date, now: Date): ExpiryStage {
    return expiresAt.getTime() < now.getTime() ? 'expired' : 'soon';
  }

  private toExpiring(
    ownerType: 'vehicle' | 'driver',
    ownerId: string,
    ownerLabel: string,
    doc: ExpiringDoc,
    now: Date,
  ): ExpiringDocument {
    const diffMs = doc.expiresAt.getTime() - now.getTime();
    return {
      id: doc.id,
      owner_type: ownerType,
      owner_id: ownerId,
      owner_label: ownerLabel,
      doc_type: doc.type,
      doc_number: doc.number,
      expires_at: doc.expiresAt.toISOString(),
      days_until_expiry: Math.floor(diffMs / MS_PER_DAY),
      status: diffMs < 0 ? 'expired' : 'soon',
    };
  }

  private buildBody(expiredNew: number, soonNew: number): string {
    if (expiredNew > 0 && soonNew > 0) {
      return `${expiredNew} ta hujjat muddati tugagan, ${soonNew} ta hujjatning muddati tugash arafasida (30 kun ichida).`;
    }
    if (expiredNew > 0) {
      return `${expiredNew} ta hujjat muddati tugagan.`;
    }
    return `${soonNew} ta hujjatning muddati tugash arafasida (30 kun ichida).`;
  }
}
