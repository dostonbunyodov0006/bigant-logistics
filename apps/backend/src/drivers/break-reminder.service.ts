import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** How long before a break's end the driver is asked whether he is coming back (owner, 12.11.2026). */
export const BREAK_REMIND_BEFORE_MS = 5 * 60_000;

const hhmm = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });

/**
 * Five minutes before a break ends the driver is told (owner, 12.11.2026):
 * back to work, or a longer break with a reason. Once per end — an extended
 * break is reminded again before its new end.
 */
@Injectable()
export class BreakReminderService {
  private readonly logger = new Logger(BreakReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(now: Date = new Date()): Promise<{ told: number }> {
    const due = await this.prisma.driverBreak.findMany({
      where: {
        endedAt: null,
        until: { gt: now, lte: new Date(now.getTime() + BREAK_REMIND_BEFORE_MS) },
      },
      select: { id: true, until: true, remindedFor: true, driver: { select: { userId: true } } },
    });
    let told = 0;
    for (const b of due) {
      if (b.remindedFor && b.remindedFor.getTime() === b.until.getTime()) continue;
      const { count } = await this.prisma.driverBreak.updateMany({
        where: { id: b.id, OR: [{ remindedFor: null }, { remindedFor: { not: b.until } }] },
        data: { remindedFor: b.until },
      });
      if (count === 0) continue;
      told++;
      await this.notifications
        .notify(b.driver.userId, {
          type: 'break_ending',
          title: 'Tanaffusingiz tugayapti',
          body: `Tanaffus ${hhmm(b.until)} da tugaydi. Ishga qaytasizmi yoki tanaffusni cho'zasizmi? Tugagach 5 daqiqadan keyin GPS, internet va quvvat tejash tekshiriladi.`,
          data: { kind: 'break_ending' },
        })
        .catch((err: Error) => this.logger.warn(`break reminder failed: ${err.message}`));
    }
    return { told };
  }
}
