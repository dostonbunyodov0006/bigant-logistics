import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { shouldWarnSilent } from './location-silence';
import { DriversService } from './drivers.service';

/**
 * Tells a driver on shift that his position stopped coming (owner,
 * 04.11.2026): GPS off, or the internet with the app closed. Once per silence;
 * run every minute by ShiftEndCheckDispatcher.
 */
@Injectable()
export class LocationSilenceService {
  private readonly logger = new Logger(LocationSilenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly drivers?: DriversService,
  ) {}

  async runOnce(now: Date = new Date()): Promise<number> {
    const open = await this.prisma.workLog.findMany({
      where: { clockOutAt: null },
      select: {
        id: true,
        driverId: true,
        clockInAt: true,
        silenceWarnedAt: true,
        driver: { select: { userId: true, locationUpdatedAt: true, breakUntil: true } },
      },
    });
    let warned = 0;
    for (const log of open) {
      const onBreak = !!log.driver.breakUntil && log.driver.breakUntil.getTime() > now.getTime();
      if (
        !shouldWarnSilent({
          now,
          clockInAt: log.clockInAt,
          lastFixAt: log.driver.locationUpdatedAt,
          onBreak,
          warnedAt: log.silenceWarnedAt,
        })
      ) {
        continue;
      }
      // Only when GPS is required: working hours, or work in hand (owner, 04.11.2026).
      const window = this.drivers ? await this.drivers.gpsRequired(log.driverId, true, now).catch(() => null) : null;
      if (this.drivers && (!window || now.getTime() < Date.parse(window.from) || now.getTime() >= Date.parse(window.until))) continue;
      try {
        await this.prisma.workLog.update({ where: { id: log.id }, data: { silenceWarnedAt: now } });
        await this.notifications.notify(log.driver.userId, {
          type: 'shift.location_silent',
          title: "GPS yoki internet o'chiq",
          body: "Joylashuvingiz kelmayapti. GPS va internetni yoqing — o'chiq vaqtda yo'l vaqti hisoblanmaydi.",
          data: { kind: 'location_silent' },
        });
        warned++;
      } catch (err) {
        this.logger.error(`silence warning failed for shift ${log.id}: ${(err as Error).message}`);
      }
    }
    return warned;
  }
}
