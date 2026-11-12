import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramSender } from '../telegram/telegram.sender';
import { tashkentDateLabel } from '../common/tashkent-time';

/** Quiet this long on an open shift and the office is told (owner, 09.11.2026). */
export const APP_SILENT_AFTER_MS = 15 * 60_000;
/** This many going quiet within one window is one message: likely an update or the server. */
export const MASS_SILENCE_COUNT = 3;

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

interface Row {
  workLogId: string;
  driverId: string;
  name: string;
  plate: string | null;
  silentSince: Date;
  alertAt: Date | null;
}

export interface AppSilenceSweep {
  alerted: string[];
  recovered: string[];
  combined: boolean;
}

/**
 * The office hears when a driver's app stops reaching the server during his
 * shift, so problems are noticed here and not reported by the owner
 * (owner, 09.11.2026). The phone's own location service is checked beside it:
 * positions still coming means the app is broken; nothing at all means the
 * phone is off or has no internet. Only open shifts count — no shift, no
 * message, day or night — and nothing is sent to the drivers.
 */
@Injectable()
export class AppSilenceService {
  private readonly logger = new Logger(AppSilenceService.name);
  private readonly chatId?: string;
  /** Drivers never seen since the column existed get a full window from here (tests move it). */
  startedAt = new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramSender,
    config: ConfigService<Env, true>,
  ) {
    this.chatId = config.get('TELEGRAM_OPS_CHAT_ID', { infer: true }) || config.get('TELEGRAM_GROUP_CHAT_ID', { infer: true });
  }

  async sweep(now = new Date()): Promise<AppSilenceSweep> {
    const result: AppSilenceSweep = { alerted: [], recovered: [], combined: false };
    const logs = await this.prisma.workLog.findMany({
      where: { clockOutAt: null },
      select: {
        id: true,
        driverId: true,
        clockInAt: true,
        appSilentSince: true,
        appSilentAlertAt: true,
        driver: {
          select: {
            lastAppSeenAt: true,
            locationUpdatedAt: true,
            breakUntil: true,
            user: { select: { name: true } },
            vehicle: { select: { plateNumber: true } },
          },
        },
      },
    });
    if (logs.length === 0) return result;

    const today = tashkentDateLabel(now);
    const leaves = await this.prisma.leaveRequest.findMany({
      where: { driverId: { in: logs.map((l) => l.driverId) }, status: 'approved', startDate: { lte: today }, endDate: { gte: today } },
      select: { driverId: true },
    });
    const onLeave = new Set(leaves.map((l) => l.driverId));

    const silent: Row[] = [];
    const back: { row: Row; quietMs: number }[] = [];
    for (const l of logs) {
      // Any sign of the phone counts (owner, 09.11.2026): the app's own
      // requests, or the phone's location service (screen off, app in the
      // background — the app's JS is asleep then, and that is normal).
      const app = l.driver.lastAppSeenAt;
      const native = l.driver.locationUpdatedAt;
      const seen = app && native ? (app > native ? app : native) : (app ?? native);
      const since =
        seen && seen >= l.clockInAt
          ? seen
          : seen
            ? l.clockInAt
            : new Date(Math.max(l.clockInAt.getTime(), this.startedAt.getTime()));
      const quiet = now.getTime() - since.getTime() >= APP_SILENT_AFTER_MS;
      const row: Row = {
        workLogId: l.id,
        driverId: l.driverId,
        name: l.driver.user.name,
        plate: l.driver.vehicle?.plateNumber ?? null,
        silentSince: since,
        alertAt: l.appSilentAlertAt,
      };
      if (l.appSilentAlertAt && !quiet) {
        const from = l.appSilentSince ?? l.appSilentAlertAt;
        back.push({ row, quietMs: (seen ?? now).getTime() - from.getTime() });
        continue;
      }
      const away = (l.driver.breakUntil && l.driver.breakUntil > now) || onLeave.has(l.driverId);
      if (quiet && !away) silent.push(row);
    }

    await this.sendRecoveries(back, result);
    await this.sendSilences(silent, now, result);
    return result;
  }

  private async sendSilences(silent: Row[], now: Date, result: AppSilenceSweep): Promise<void> {
    const fresh = silent.filter((r) => !r.alertAt);
    if (fresh.length === 0) return;
    // Already reported, but in this same window: together they are one event.
    const recent = silent.filter((r) => r.alertAt && now.getTime() - r.alertAt.getTime() < APP_SILENT_AFTER_MS);
    const pings = await this.prisma.driverLocationPing.groupBy({
      by: ['driverId'],
      where: { driverId: { in: [...fresh, ...recent].map((r) => r.driverId) }, recordedAt: { gte: new Date(now.getTime() - APP_SILENT_AFTER_MS) } },
      _max: { recordedAt: true },
    });
    const located = new Set(pings.filter((p) => p._max.recordedAt).map((p) => p.driverId));
    const who = (r: Row) => (r.plate ? `${r.name} (${r.plate})` : r.name);
    const where = (r: Row) => (located.has(r.driverId) ? 'telefon xizmati yuboryapti' : "yo'q");

    if (fresh.length + recent.length >= MASS_SILENCE_COUNT) {
      const all = [...fresh, ...recent];
      const lines = all.map((r) => `• ${who(r)} — ${minutes(now.getTime() - r.silentSince.getTime())} daq, joylashuv: ${where(r)}`);
      const text = `🚨 ${all.length} ta haydovchida ilova bir vaqtda jim — yangilanish yoki server muammosi bo'lishi mumkin.\n${lines.join('\n')}`;
      if (await this.post(text)) {
        await Promise.all(fresh.map((r) => this.markSilent(r, now)));
        result.alerted.push(...fresh.map((r) => r.driverId));
        result.combined = true;
      }
      return;
    }
    for (const r of fresh) {
      const text = `⚠️ ${who(r)}: ${minutes(now.getTime() - r.silentSince.getTime())} daqiqadan beri telefondan aloqa yo'q (smenada) — telefon o'chgan, internet yo'q yoki ilova yopilgan bo'lishi mumkin.`;
      if (await this.post(text)) {
        await this.markSilent(r, now);
        result.alerted.push(r.driverId);
      }
    }
  }

  private async sendRecoveries(back: { row: Row; quietMs: number }[], result: AppSilenceSweep): Promise<void> {
    if (back.length === 0) return;
    const sent =
      back.length >= MASS_SILENCE_COUNT
        ? (await this.post(
            `✅ ${back.length} ta haydovchida ilova qayta ulandi:\n${back.map((b) => `• ${b.row.name} — ${minutes(b.quietMs)} daq jim edi`).join('\n')}`,
          ))
          ? back
          : []
        : await this.filterSent(back, (b) => `✅ ${b.row.name}: ilova qayta ulandi (${minutes(b.quietMs)} daqiqa jim edi)`);
    for (const b of sent) {
      await this.prisma.workLog.updateMany({
        where: { id: b.row.workLogId, appSilentAlertAt: b.row.alertAt },
        data: { appSilentAlertAt: null, appSilentSince: null },
      });
      result.recovered.push(b.row.driverId);
    }
  }

  private async filterSent<T>(items: T[], text: (item: T) => string): Promise<T[]> {
    const sent: T[] = [];
    for (const item of items) if (await this.post(text(item))) sent.push(item);
    return sent;
  }

  /** Only when no other run marked it first: one message per silence. */
  private markSilent(r: Row, now: Date) {
    return this.prisma.workLog.updateMany({
      where: { id: r.workLogId, appSilentAlertAt: null },
      data: { appSilentAlertAt: now, appSilentSince: r.silentSince },
    });
  }

  /** True once handled (sent, or Telegram not configured — logged, not retried). False = try next tick. */
  private async post(text: string): Promise<boolean> {
    try {
      const res = await this.telegram.send({ text }, this.chatId);
      if (res.skipped) this.logger.warn(`app silence alert not sent (Telegram not configured): ${text}`);
      return true;
    } catch (err) {
      this.logger.error(`app silence alert failed: ${(err as Error).message}`);
      return false;
    }
  }
}
