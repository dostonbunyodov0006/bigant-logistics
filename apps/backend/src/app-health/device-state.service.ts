import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramSender } from '../telegram/telegram.sender';

/** What the phone says about itself: location services off, battery saver on. */
export interface DeviceState {
  gps_off?: boolean;
  low_power?: boolean;
}

type Flag = 'gps_off' | 'low_power';

const TEXT: Record<Flag, { on: string; off: string }> = {
  gps_off: {
    on: "📍❌ {who}: telefonda joylashuv xizmati O'CHIRILDI (smenada) — joylashuvi ofisga bormaydi.",
    off: '📍✅ {who}: joylashuv xizmati qayta yoqildi.',
  },
  low_power: {
    on: '🔋 {who}: telefonda quvvat tejash rejimi YOQILDI (smenada) — joylashuv kam yoki kech kelishi mumkin.',
    off: "🔋✅ {who}: quvvat tejash rejimi o'chirildi.",
  },
};

/**
 * The phone tells the office when location services are switched off or the
 * battery saver comes on during a shift (owner, 10.11.2026: an iPhone driver
 * may do either, and the office should hear it at once, not when the position
 * has been missing for a quarter of an hour). One message when it happens and
 * one when it is put back; nothing off shift. The last state is kept in
 * memory: after a restart the next change is reported, repeats are not.
 */
@Injectable()
export class DeviceStateService {
  private readonly logger = new Logger(DeviceStateService.name);
  private readonly chatId?: string;
  /** driverId -> the state last reported to the office. */
  private readonly last = new Map<string, Record<Flag, boolean>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramSender,
    config: ConfigService<Env, true>,
  ) {
    this.chatId = config.get('TELEGRAM_OPS_CHAT_ID', { infer: true }) || config.get('TELEGRAM_GROUP_CHAT_ID', { infer: true });
  }

  async report(userId: string, state: DeviceState): Promise<{ ok: true }> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: {
        id: true,
        user: { select: { name: true } },
        vehicle: { select: { plateNumber: true } },
        workLogs: { where: { clockOutAt: null }, select: { id: true }, take: 1 },
      },
    });
    if (!driver) return { ok: true };
    const onShift = driver.workLogs.length > 0;
    const prev = this.last.get(driver.id) ?? { gps_off: false, low_power: false };
    const next = { ...prev };
    const who = `${driver.user.name}${driver.vehicle?.plateNumber ? ` (${driver.vehicle.plateNumber})` : ''}`;
    for (const flag of ['gps_off', 'low_power'] as const) {
      const now = state[flag];
      if (now === undefined || now === prev[flag]) continue;
      next[flag] = now;
      // Turned on off shift: remembered, not reported. Put back: reported only
      // if its turning on was.
      if (!onShift && now) continue;
      if (!onShift && !now) continue;
      await this.post(TEXT[flag][now ? 'on' : 'off'].replace('{who}', who));
    }
    this.last.set(driver.id, next);
    return { ok: true };
  }

  private async post(text: string): Promise<void> {
    try {
      const res = await this.telegram.send({ text }, this.chatId);
      if (res.skipped) this.logger.warn(`device state not sent (Telegram not configured): ${text}`);
    } catch (err) {
      this.logger.error(`device state message failed: ${(err as Error).message}`);
    }
  }
}
