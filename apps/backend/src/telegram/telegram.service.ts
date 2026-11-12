import { receiptDiffers } from '../service/receipt-reader.service';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { FuelLog, FuelStation, Order, ServiceCenter, ServiceVisit, ServiceVisitItem, TelegramReport } from '@prisma/client';
import {
  FUEL_UNITS,
  VOZVRAT_REASONS,
  type FuelType,
  type TelegramReportPublic,
  type TelegramReportStatus,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { tashkentDateTime } from '../common/tashkent-time';
import { applyWatermark } from '../upload/watermark';
import { TelegramSender } from './telegram.sender';

/**
 * A send that fails is tried again with a growing wait: 1, 2, 4 ... minutes up
 * to an hour, twelve times in all (about six and a half hours). A Telegram
 * outage of a minute used to lose the report for good after three tries in
 * a row; now it only has to come back the same afternoon.
 */
const MAX_RETRIES = 12;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 60 * 60_000;
/** Bot or group not configured yet: look again every ten minutes, forever. */
/** How long one attempt holds a report while it is being sent. */
const SEND_CLAIM_MS = 2 * 60_000;
const UNCONFIGURED_WAIT_MS = 10 * 60_000;
const NOT_CONFIGURED = 'telegram_not_configured';

export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), RETRY_MAX_MS);
}

/** One returned item, as the write-up recorded it. */
export interface ReturnItemLine {
  name: string;
  unit: string | null;
  quantity: number;
  condition: string;
  reasonCode: string;
  otherReason: string | null;
  culprit: string | null;
  photoUrl: string | null;
  /** Further photos of the same product. */
  photoUrls?: string[];
}

/** The reason in the words the office uses, not its code. */
function reasonText(code: string): string {
  return VOZVRAT_REASONS.find((r) => r.code === code)?.text ?? code;
}

function driverCommentLines(comment: string | null): string[] {
  const value = comment?.trim();
  return value ? [`Haydovchi izohi: ${value}`] : [];
}

function formatDeliveryDuration(start: Date | null, end: Date): string | null {
  if (!start) return null;
  const totalMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} daqiqa`;
  if (minutes === 0) return `${hours} soat`;
  return `${hours} soat ${minutes} daqiqa`;
}

/** Format a timestamp for Telegram reports in Tashkent local time (UTC+5, no DST): dd.MM.yyyy HH:mm. */
const FUEL_NAMES: Record<FuelType, string> = { gaz: 'Gaz (metan)', benzin: 'Benzin', propan: 'Propan' };
/** Where the truck was, in the words of each place kind. */
const OUTCOME_LINES: Record<'fuel' | 'service', Record<string, string>> = {
  fuel: {
    matched: 'Joylashuv: shoxobchada',
    other_station: 'Joylashuv: boshqa shoxobchada',
    unlisted: "Joylashuv: ro'yxatda yo'q joy",
    mismatch: 'Joylashuv: shoxobchaga mos kelmadi',
    unverified: 'Joylashuv: aniqlanmadi',
  },
  service: {
    matched: 'Joylashuv: servis markazida',
    other_station: 'Joylashuv: boshqa servis markazida',
    unlisted: "Joylashuv: ro'yxatda yo'q joy",
    mismatch: 'Joylashuv: servis markaziga mos kelmadi',
    unverified: 'Joylashuv: aniqlanmadi',
  },
};
/** 244050 → "244 050"; 48.81 → "48.81". Plain spaces: Telegram renders them, NBSP not always. */
const num = (n: number, decimals = 0): string => {
  const [int, frac] = n.toFixed(decimals).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac && Number(frac) > 0 ? `${grouped}.${frac.replace(/0+$/, '')}` : grouped;
};

function formatReportTime(date: Date): string {
  return tashkentDateTime(date);
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: TelegramSender,
  ) {}

  /**
   * Write the report unless it is already written, then send it.
   *
   * The outbox retries an event whose handler threw part-way, so a creator can
   * be called twice for one delivery. Without a name for what is being
   * reported the group got the photo twice; with one, the second call finds
   * the row and sends nothing — it is already on its way or being retried.
   */
  private async createOnce(
    dedupeKey: string,
    data: Omit<Prisma.TelegramReportUncheckedCreateInput, 'dedupeKey' | 'status'>,
  ): Promise<void> {
    const existing = await this.prisma.telegramReport.findUnique({ where: { dedupeKey } });
    if (existing) {
      this.logger.debug(`report ${dedupeKey} already written — not sending again`);
      return;
    }
    let report;
    try {
      report = await this.prisma.telegramReport.create({
        data: { ...data, dedupeKey, status: 'pending' },
      });
    } catch (err) {
      // Two polls at once: the other one owns it.
      if ((err as { code?: string }).code === 'P2002') return;
      throw err;
    }
    await this.trySend(report.id);
  }

  /** Assemble + persist a delivery proof report, then attempt to send it (FR-015). */
  async createForDelivery(
    order: Order,
    photoUrl: string | null,
    comment: string | null = null,
  ): Promise<void> {
    const [driverName, sellerName] = await Promise.all([
      this.driverName(order.assignedDriverId),
      this.sellerName(order.createdBySellerId),
    ]);
    const deliveryDuration = formatDeliveryDuration(
      order.journeyStartedAt,
      order.deliveredAt ?? order.updatedAt,
    );
    const message = [
      `Buyurtma yetkazildi`,
      ``,
      `Mijoz: ${order.clientName}`,
      `Sotuvchi: ${sellerName}`,
      `Haydovchi: ${driverName}`,
      `Holat: Yetkazildi`,
      ...driverCommentLines(comment),
      // Existing in-flight orders can predate journeyStartedAt; retain their old
      // timestamp display rather than presenting an invented duration.
      `Vaqt: ${deliveryDuration ?? formatReportTime(order.updatedAt)}`,
    ].join('\n');

    await this.createOnce(`order:${order.id}:delivery`, {
      orderId: order.id,
      // Post the watermarked proof; the clean original stays on the order.
      photoUrl: applyWatermark(photoUrl) ?? '',
      messageText: message,
      target: 'delivery',
    });
  }

  /** Assemble + persist a Vozrat (return) hand-back report and post it — with the
   *  proof photo — to the separate Vozrat Telegram group. */
  async createForVozrat(
    order: Order,
    photoUrl: string | null,
    comment: string | null = null,
  ): Promise<void> {
    const [driverName, sellerName] = await Promise.all([
      this.driverName(order.assignedDriverId),
      this.sellerName(order.createdBySellerId),
    ]);
    const message = [
      `VOZRAT qaytarildi`,
      ``,
      `Mijoz: ${order.clientName}`,
      `Sotuvchi: ${sellerName}`,
      `Haydovchi: ${driverName}`,
      `Qaytarilgan joy: ${order.returnDestination ?? '—'}`,
      ...driverCommentLines(comment),
      `Vaqt: ${formatReportTime(order.updatedAt)}`,
    ].join('\n');

    await this.createOnce(`order:${order.id}:vozrat`, {
      orderId: order.id,
      // Post the watermarked proof; the clean original stays on the order.
      photoUrl: applyWatermark(photoUrl) ?? '',
      messageText: message,
      target: 'vozrat',
    });
  }

  /** Assemble + persist a pickup (loading) report and post it — with the loaded-goods
   *  photo — to the separate pickup Telegram group. Fired once per pickup stop. */
  async createForPickup(
    order: Order,
    placeName: string | null,
    photoUrl: string | null,
    comment: string | null = null,
    pickupId: string | null = null,
  ): Promise<void> {
    const driverName = await this.driverName(order.assignedDriverId);
    const message = [
      `YUK OLINDI`,
      ``,
      `Joy: ${placeName ?? '—'}`,
      `Mijoz: ${order.clientName}`,
      `Haydovchi: ${driverName}`,
      ...driverCommentLines(comment),
      `Vaqt: ${formatReportTime(order.updatedAt)}`,
    ].join('\n');

    // One report per stop: an order loaded at two places has two of them,
    // each named by its stop, so neither can be posted twice.
    await this.createOnce(`order:${order.id}:pickup:${pickupId ?? placeName ?? 'stop'}`, {
      orderId: order.id,
      // Post the watermarked photo; the clean original stays on the pickup source.
      photoUrl: applyWatermark(photoUrl) ?? '',
      messageText: message,
      target: 'pickup',
    });
  }

  /**
   * A confirmed fill-up: the dispenser photo with the numbers the driver
   * confirmed, to the fuel group. Replaces the photo the driver used to post
   * there by hand.
   */
  async createForFuel(log: FuelLog & { resolvedStation: FuelStation | null; selectedStation: FuelStation | null }): Promise<void> {
    const driverName = await this.driverName(log.driverId);
    const vehicle = log.vehicleId ? await this.prisma.vehicle.findUnique({ where: { id: log.vehicleId }, select: { plateNumber: true, model: true } }) : null;
    const station = log.resolvedStation ?? log.selectedStation;
    const unit = FUEL_UNITS[log.fuelType as FuelType] === 'nm3' ? 'Nm³' : 'l';
    const message = [
      `YOQILG'I — ${FUEL_NAMES[log.fuelType as FuelType] ?? log.fuelType}`,
      ``,
      `Haydovchi: ${driverName}`,
      `Mashina: ${vehicle ? `${vehicle.model} · ${vehicle.plateNumber}` : '—'}`,
      `Shoxobcha: ${station?.name ?? "Ko'cha (ro'yxatda yo'q)"}`,
      log.quantity != null && log.unitPriceSum != null && log.totalSum != null
        ? `${num(log.quantity, 2)} ${unit} × ${num(log.unitPriceSum)} = ${num(log.totalSum)} so'm`
        : `Jami: ${log.totalSum != null ? `${num(log.totalSum)} so'm` : '—'}`,
      OUTCOME_LINES.fuel[log.outcome] ?? null,
      log.settlement === 'driver_reimbursement' ? "To'lov: haydovchi o'z pulidan" : log.settlement === 'station_invoice' ? "To'lov: shoxobcha hisobidan" : "To'lov: admin aniqlaydi",
      `Vaqt: ${formatReportTime(log.capturedAt)}`,
    ].filter((l): l is string => l != null).join('\n');

    await this.createOnce(`fuel:${log.id}`, {
      fuelLogId: log.id,
      photoUrl: applyWatermark(log.photoUrl) ?? '',
      messageText: message,
      target: 'fuel',
    });
  }

  /**
   * A completed service visit: one photo per work and the receipt, as one
   * album, with the works, the km, the total and the driver's word, to the
   * service group.
   */
  async createForServiceVisit(
    visit: ServiceVisit & { items: ServiceVisitItem[]; resolvedCenter: ServiceCenter | null; selectedCenter: ServiceCenter | null },
  ): Promise<void> {
    const driverName = await this.driverName(visit.driverId);
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: visit.vehicleId }, select: { plateNumber: true, model: true } });
    const center = visit.resolvedCenter ?? visit.selectedCenter;
    // Every photo of every work — two each since 11.11.2026 — then the receipt.
    const photos = [...visit.items.flatMap((i) => (i.photoUrls?.length ? i.photoUrls : [i.photoUrl])), visit.receiptPhotoUrl]
      .map((u) => applyWatermark(u))
      .filter((u): u is string => !!u);
    const message = [
      `SERVIS — ${visit.items.map((i) => i.name).join(' · ')}`,
      ``,
      `Haydovchi: ${driverName}`,
      `Mashina: ${vehicle ? `${vehicle.model} · ${vehicle.plateNumber}` : '—'}`,
      `Servis: ${center?.name ?? "Ko'cha (ro'yxatda yo'q usta)"}`,
      `Km: ${visit.odometerKm != null ? `${num(visit.odometerKm)} km` : '—'}`,
      `Jami: ${visit.totalSum != null ? `${num(visit.totalSum)} so'm` : '—'}${visit.noReceipt ? " · chek yo'q, naqd" : ''}`,
      // What the AI read off the receipt, when it differs from the typed total (owner, 11.11.2026).
      visit.receiptReadSum != null && visit.totalSum != null && receiptDiffers(visit.totalSum, visit.receiptReadSum)
        ? `⚠️ Chekda: ${num(visit.receiptReadSum)} so'm — yozilgan summa bilan mos emas`
        : null,
      visit.outcome ? (OUTCOME_LINES.service[visit.outcome] ?? null) : null,
      ...driverCommentLines(visit.driverComment),
      `Vaqt: ${formatReportTime(visit.completedAt ?? new Date())}`,
    ].filter((l): l is string => l != null).join('\n');

    await this.createOnce(`service:${visit.id}`, {
      serviceVisitId: visit.id,
      photoUrl: photos[0] ?? '',
      photoUrls: photos.slice(1),
      messageText: message,
      target: 'service',
    });
  }

/**
   * What the client sent back, item by item, with a photo of each: posted as
   * one album to the Vozrat group when the driver writes the return up.
   *
   * The hand-back report (createForVozrat) says the goods reached the
   * warehouse. This one says what they were and whose fault it was, which is
   * the part the office argues about.
   */
  async createForReturnItems(order: Order, items: ReturnItemLine[]): Promise<void> {
    if (items.length === 0) return;
    const [driverName, sellerName] = await Promise.all([
      this.driverName(order.assignedDriverId),
      this.sellerName(order.createdBySellerId),
    ]);
    const lines = items.map((item, i) => {
      const qty = `${num(item.quantity, 2)}${item.unit ? ` ${item.unit}` : ''}`;
      const reason = item.reasonCode === 'x' ? (item.otherReason ?? 'Boshqa sabab') : reasonText(item.reasonCode);
      const blamed = item.culprit ? ` · ${item.culprit}` : '';
      return `${i + 1}. ${item.name} — ${qty} · ${item.condition}${blamed}\n   ${reason}`;
    });
    const message = [
      `VOZRAT tovarlari (${items.length} ta)`,
      ``,
      `Mijoz: ${order.clientName}`,
      `Sotuvchi: ${sellerName}`,
      `Haydovchi: ${driverName}`,
      ``,
      ...lines,
      ...driverCommentLines(order.returnReason),
      `Vaqt: ${formatReportTime(new Date())}`,
    ].join('\n');

    // Every photo of every product, in order, as one album.
    const photos = items
      .flatMap((item) => [item.photoUrl, ...(item.photoUrls ?? [])])
      .map((u) => applyWatermark(u))
      .filter((u): u is string => !!u);
    await this.createOnce(`order:${order.id}:return-items`, {
      orderId: order.id,
      photoUrl: photos[0] ?? '',
      photoUrls: photos.slice(1),
      messageText: message,
      target: 'vozrat',
    });
  }

  /**
   * Admin: every report that has not reached its group — given up (`failed`),
   * still being retried, or waiting for the bot/group to be configured — so
   * a report is never invisible (§18 "Telegram bot fails").
   */
  async listFailed(): Promise<TelegramReportPublic[]> {
    const rows = await this.prisma.telegramReport.findMany({
      where: { OR: [{ status: 'failed' }, { status: 'pending', lastError: { not: null } }] },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toPublic(r));
  }

  /**
   * Called from the outbox poll: a report whose send did not deliver waits as
   * `pending` with a time for its next try, and this is what tries it again,
   * a few per pass, the longest-waiting first.
   */
  async retryPending(now = new Date()): Promise<number> {
    const rows = await this.prisma.telegramReport.findMany({
      where: {
        status: 'pending',
        // A row created and then orphaned before its first send carries no
        // next attempt; it is still waiting, so it belongs here too.
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { id: true },
    });
    for (const r of rows) {
      await this.trySend(r.id);
    }
    return rows.length;
  }

  /** Admin: send a report again now, whatever its state; the retry count starts over. */
  async retry(id: string): Promise<TelegramReportPublic> {
    const report = await this.prisma.telegramReport.findUnique({ where: { id } });
    if (!report) {
      throw new NotFoundException('telegram_report_not_found');
    }
    if (report.status === 'sent') return this.toPublic(report);
    await this.prisma.telegramReport.update({ where: { id }, data: { status: 'pending', retryCount: 0 } });
    return this.trySend(id);
  }

  private async trySend(id: string): Promise<TelegramReportPublic> {
    const report = await this.prisma.telegramReport.findUniqueOrThrow({ where: { id } });
    // Claim it before sending. Telegram fetches the photo from our server, so
    // a send takes seconds, and the outbox ticks every two: the sweeper used
    // to pick up a row that was already on its way and post the same picture
    // to the group twice. The claim moves the next attempt out of its reach;
    // whichever path loses finds nothing to send.
    const claimed = await this.prisma.telegramReport.updateMany({
      where: { id, status: 'pending', nextAttemptAt: report.nextAttemptAt },
      data: { nextAttemptAt: new Date(Date.now() + SEND_CLAIM_MS) },
    });
    if (claimed.count === 0) {
      this.logger.debug(`report ${id} is being sent by another attempt`);
      return this.toPublic(report);
    }
    const chatId =
      report.target === 'vozrat'
        ? this.sender.vozratChatId
        : report.target === 'pickup'
          ? this.sender.pickupChatId
          : report.target === 'fuel'
            ? this.sender.fuelChatId
            : report.target === 'service'
              ? this.sender.serviceChatId
              : undefined;
    try {
      const result = await this.sender.send(
        { text: report.messageText, photoUrl: report.photoUrl || null, morePhotoUrls: report.photoUrls },
        chatId,
      );
      if (result.skipped) {
        // Bot or group not configured yet: wait, and look again once it is.
        return this.toPublic(
          await this.prisma.telegramReport.update({
            where: { id },
            data: { status: 'pending', nextAttemptAt: new Date(Date.now() + UNCONFIGURED_WAIT_MS), lastError: NOT_CONFIGURED },
          }),
        );
      }
      return this.toPublic(
        await this.prisma.telegramReport.update({
          where: { id },
          data: { status: 'sent', sentAt: new Date(), nextAttemptAt: null, lastError: null },
        }),
      );
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Telegram send failed for report ${id}: ${message}`);
      const retryCount = report.retryCount + 1;
      const givenUp = retryCount >= MAX_RETRIES;
      return this.toPublic(
        await this.prisma.telegramReport.update({
          where: { id },
          data: {
            retryCount,
            status: givenUp ? 'failed' : 'pending',
            nextAttemptAt: givenUp ? null : new Date(Date.now() + retryDelayMs(retryCount)),
            lastError: message.slice(0, 500),
          },
        }),
      );
    }
  }

  private async driverName(driverId: string | null): Promise<string> {
    if (!driverId) {
      return 'N/A';
    }
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true },
    });
    return driver?.user.name ?? 'N/A';
  }

  private async sellerName(sellerId: string | null): Promise<string> {
    if (!sellerId) {
      return 'N/A';
    }
    const user = await this.prisma.user.findUnique({ where: { id: sellerId } });
    return user?.name ?? 'N/A';
  }

  private toPublic(r: TelegramReport): TelegramReportPublic {
    return {
      id: r.id,
      order_id: r.orderId,
      fuel_log_id: r.fuelLogId,
      service_visit_id: r.serviceVisitId,
      target: r.target,
      photo_url: r.photoUrl,
      message_text: r.messageText,
      status: r.status as TelegramReportStatus,
      retry_count: r.retryCount,
      next_attempt_at: r.nextAttemptAt ? r.nextAttemptAt.toISOString() : null,
      last_error: r.lastError,
      sent_at: r.sentAt ? r.sentAt.toISOString() : null,
      created_at: r.createdAt.toISOString(),
    };
  }
}
