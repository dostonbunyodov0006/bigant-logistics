import { Injectable, Logger } from '@nestjs/common';
import type { WorkLog } from '@prisma/client';
import { IN_PROGRESS_ORDER_STATUSES } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleService } from '../attendance/schedule.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { tashkentDateKey, tashkentDayStartUtc, tashkentHhmm, tashkentWeekday } from '../common/tashkent-time';
import { ordersInHand } from './driver-status';
import { breakTakenMinutes, earlyMinutesAt } from './shift-time';
import { lastPhotoAt } from './last-photo';
import {
  CLOSE_AFTER_LAST_MIN,
  END_CHECK_MAX_UNANSWERED,
  GPS_FRESH_MIN,
  confirmedUntil,
  decide,
  firstCheckAt,
  isDue,
  isStale,
  readEndCheckNotes,
  type EndCheckAction,
  type Zone,
} from './shift-end-check';
import { insideTashkentCity } from '../geo/tashkent-city';
import { borderCrossing } from './location-silence';
import { readOffPeriods, shiftDayEnd } from './shift-time';

const MIN = 60_000;

type DriverFacts = {
  id: string;
  userId: string;
  locationLat: number | null;
  locationLng: number | null;
  locationUpdatedAt: Date | null;
  breakStartedAt: Date | null;
  breakUntil: Date | null;
};
type OpenShift = WorkLog & { driver: DriverFacts };

export interface EndCheckRun {
  checked: number;
  byAction: Partial<Record<EndCheckAction, number>>;
}

/**
 * Runs the end-of-day check (shift-end-check.ts) over every open shift: finds
 * where each driver is and whether he is working, then reminds him or ends the
 * shift. Called every minute by ShiftEndCheckDispatcher; a shift is only looked
 * at when it is due (its end, then every 30 minutes, 10 after the last ask).
 */
@Injectable()
export class ShiftEndCheckService {
  private readonly logger = new Logger(ShiftEndCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async runOnce(now: Date = new Date()): Promise<EndCheckRun> {
    const open: OpenShift[] = await this.prisma.workLog.findMany({
      where: { clockOutAt: null },
      include: {
        driver: {
          select: {
            id: true,
            userId: true,
            locationLat: true,
            locationLng: true,
            locationUpdatedAt: true,
            breakStartedAt: true,
            breakUntil: true,
          },
        },
      },
    });
    const run: EndCheckRun = { checked: 0, byAction: {} };
    if (open.length === 0) return run;
    const resolve = await this.schedule.resolver([...new Set(open.map((l) => l.driverId))]);

    for (const log of open) {
      const day = resolve(log.driverId, tashkentWeekday(log.clockInAt));
      if (!isDue({ ...log, endMinutes: day.endMinutes }, now)) continue;
      run.checked++;
      try {
        const action = await this.checkOne(log, now, day.endMinutes);
        run.byAction[action] = (run.byAction[action] ?? 0) + 1;
      } catch (err) {
        this.logger.error(`end check failed for shift ${log.id}: ${(err as Error).message}`);
      }
    }
    return run;
  }

  private async checkOne(log: OpenShift, now: Date, endMinutes: number): Promise<EndCheckAction> {
    const hasActiveOrder = (await ordersInHand(this.prisma, log.driverId, IN_PROGRESS_ORDER_STATUSES, { now })).length > 0;
    const zone = await this.zoneOf(log.driver, now);
    const decision = decide({
      stale: isStale(log.clockInAt, now),
      zone,
      hasActiveOrder,
      returnedToCity: log.endCheckZone === 'viloyat' && this.freshlyInsideCity(log.driver, now),
      sentAt: log.endCheckSentAt,
      answeredAt: log.endCheckAnsweredAt,
      unanswered: log.endCheckUnanswered,
    });

    switch (decision.action) {
      case 'skip_viloyat':
      case 'skip_active':
        // Nothing asked is waiting any more: a later reminder starts the count afresh.
        await this.prisma.workLog.update({
          where: { id: log.id },
          data: { endCheckRanAt: now, endCheckZone: zone, endCheckSentAt: null, endCheckUnanswered: 0 },
        });
        break;
      case 'remind':
        await this.prisma.workLog.update({
          where: { id: log.id },
          data: { endCheckRanAt: now, endCheckZone: zone, endCheckSentAt: now, endCheckUnanswered: decision.unanswered },
        });
        await this.notifications.notify(log.driver.userId, {
          type: 'shift_end_check',
          title: 'Ish kuningiz tugadimi?',
          body:
            decision.unanswered >= END_CHECK_MAX_UNANSWERED - 1
              ? `Tugagan bo'lsa «Ishni tugatish»ni bosing. Javob bo'lmasa smena ${tashkentHhmm(new Date(now.getTime() + CLOSE_AFTER_LAST_MIN * MIN))} da avtomatik yopiladi.`
              : "Tugagan bo'lsa «Ishni tugatish»ni bosing. Hali ishlayotgan bo'lsangiz — «+30 daqiqa».",
          data: { kind: 'shift_end_check', work_log_id: log.id },
        });
        break;
      case 'close_no_answer': {
        // Three asks, no answer: closed now, but ended at the time he last
        // confirmed — six, or six + 30 min per "+30" (owner, 07.11.2026).
        const offs = readOffPeriods(log.offPeriods);
        const at = confirmedUntil({
          dayEnd: shiftDayEnd(log.clockInAt, log.expectedEnd) ?? firstCheckAt(log.clockInAt, endMinutes),
          clockInAt: log.clockInAt,
          reopenedAt: offs.length ? new Date(Math.max(...offs.map((p) => p.to.getTime()))) : null,
          notes: readEndCheckNotes(log.endCheckNotes),
          now,
        });
        await this.close(log, zone, 'auto_no_answer', now, decision.unanswered, at);
        await this.notifications.notify(log.driver.userId, {
          type: 'shift_closed_no_answer',
          title: 'Ish kuni yakunlandi',
          body: `Eslatmalarga javob bo'lmadi — smena yopildi, ish vaqti ${tashkentHhmm(at)} gacha hisoblandi.`,
          data: { kind: 'shift_closed_no_answer', work_log_id: log.id },
        });
        break;
      }
      case 'close_returned': {
        // At the border: the first fix inside the city after the last one
        // outside — taken then even if it reached us later, once the internet
        // came back (owner, 04.11.2026).
        await this.close(log, zone, 'auto_returned', now, 0, (await this.borderAt(log, now)) ?? log.driver.locationUpdatedAt ?? now);
        await this.notifications.notify(log.driver.userId, {
          type: 'shift_closed_returned',
          title: 'Siz ishni tugatdingiz',
          body: "Toshkentga kirdingiz — ish kuni yakunlandi, qo'shimcha ish soati bonusi hisoblandi.",
          data: { kind: 'shift_closed_returned', work_log_id: log.id },
        });
        break;
      }
      case 'close_stale': {
        // At his last photo sent to the groups — not at the phone's last GPS
        // fix, which an app left open all night pushes into the morning. Not
        // before the end of his working day: a last photo at 16:30 on an 18:00
        // day means he worked till six, not that he left at half four.
        const lastWork = await this.lastWorkActivity(log, now);
        const dayEnd = shiftDayEnd(log.clockInAt, log.expectedEnd);
        const at = dayEnd && dayEnd.getTime() > lastWork.getTime() && dayEnd.getTime() <= now.getTime() ? dayEnd : lastWork;
        await this.close(log, zone, 'auto_stale', now, 0, at);
        break;
      }
    }
    return decision.action;
  }

  /**
   * The photo that finishes an order after hours. In a Viloyat he is flagged
   * and left to drive back — the border closes it. In the city nothing is
   * closed any more (owner, 10.11.2026; it closed the shift there from
   * 03.11): the 18:30 check asks him. Before the day's end, or with work still
   * in hand, nothing happens.
   */
  async afterWorkPhoto(
    driverId: string,
    at: Date = new Date(),
  ): Promise<'off_shift' | 'before_end' | 'working' | 'viloyat' | 'unknown' | 'tashkent'> {
    const log: OpenShift | null = await this.prisma.workLog.findFirst({
      where: { driverId, clockOutAt: null },
      include: {
        driver: {
          select: { id: true, userId: true, locationLat: true, locationLng: true, locationUpdatedAt: true, breakStartedAt: true, breakUntil: true },
        },
      },
    });
    if (!log) return 'off_shift';
    const dayEnd = shiftDayEnd(log.clockInAt, log.expectedEnd);
    if (!dayEnd || at.getTime() < dayEnd.getTime()) return 'before_end';
    if ((await ordersInHand(this.prisma, driverId, IN_PROGRESS_ORDER_STATUSES, { now: at })).length > 0) return 'working';
    // An order given to him for today and not yet accepted — whatever time it
    // was booked for — keeps the day open.
    const dayStart = tashkentDayStartUtc(tashkentDateKey(at));
    const dayAfter = new Date(dayStart.getTime() + 24 * 60 * MIN);
    const booked = await this.prisma.order.count({
      where: { assignedDriverId: driverId, status: 'assigned_to_driver', deliveryDatetime: { gte: dayStart, lt: dayAfter } },
    });
    if (booked > 0) return 'working';
    const zone = await this.zoneOf(log.driver, at);
    if (zone !== 'tashkent') {
      // Flagged where he is, so the sweep watches for the border crossing.
      await this.prisma.workLog.update({ where: { id: log.id }, data: { endCheckRanAt: at, endCheckZone: zone } });
      return zone;
    }
    // In the city the day is no longer closed at the photo (owner, 10.11.2026):
    // he is asked at 18:30 like anyone else and answers "+30" or "Ishni tugatdim".
    return zone;
  }

  private async borderAt(log: OpenShift, now: Date): Promise<Date | null> {
    const fixes = await this.prisma.driverLocationPing.findMany({
      where: { driverId: log.driverId, recordedAt: { gte: log.clockInAt, lte: now } },
      orderBy: { recordedAt: 'asc' },
      select: { lat: true, lng: true, recordedAt: true },
    });
    return borderCrossing(fixes, (f) => insideTashkentCity({ lat: f.lat, lon: f.lng }));
  }

  /** A fresh fix inside the city rings — the boundary itself, not the geocoder's region. */
  private freshlyInsideCity(driver: DriverFacts, now: Date): boolean {
    if (driver.locationLat == null || driver.locationLng == null || !driver.locationUpdatedAt) return false;
    if (now.getTime() - driver.locationUpdatedAt.getTime() > GPS_FRESH_MIN * MIN) return false;
    return insideTashkentCity({ lat: driver.locationLat, lon: driver.locationLng });
  }

  /**
   * Where he is: his GPS if it is fresh, else where his current order is
   * going, else where his last one went. Photon down or silent falls through
   * to the orders; nothing at all is unknown — which the rule asks, not skips.
   */
  async zoneOf(driver: DriverFacts, now: Date): Promise<Zone> {
    const fresh =
      driver.locationLat != null &&
      driver.locationLng != null &&
      !!driver.locationUpdatedAt &&
      now.getTime() - driver.locationUpdatedAt.getTime() <= GPS_FRESH_MIN * MIN;
    // Inside the city rings or not (owner, 02.11.2026): outside them is a
    // Viloyat, Tashkent viloyati included, and he is left to come back in.
    if (fresh) return insideTashkentCity({ lat: driver.locationLat!, lon: driver.locationLng! }) ? 'tashkent' : 'viloyat';
    // Current drop-off, then the last one: the delivery region is on the order.
    const order =
      (await this.prisma.order.findFirst({
        where: { assignedDriverId: driver.id, status: { in: [...IN_PROGRESS_ORDER_STATUSES] }, regionCode: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: { region: { select: { isCity: true } } },
      })) ??
      (await this.prisma.order.findFirst({
        where: { assignedDriverId: driver.id, status: { in: ['delivered', 'returned'] }, regionCode: { not: null } },
        orderBy: [{ deliveredAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
        select: { region: { select: { isCity: true } } },
      }));
    if (!order?.region) return 'unknown';
    // Region.isCity is Tashkent city + Tashkent viloyati — the same line.
    return order.region.isCity ? 'tashkent' : 'viloyat';
  }

  /**
   * The last moment he was demonstrably working during this shift: his GPS,
   * an order delivered or handed back, a fill-up, a service visit, an answer
   * to the reminder — or the clock-in itself. Never later than now.
   */
  /** His last piece of work — a delivery, a return, a fill-up, a service visit —
   *  without the GPS, which with the phone always on would always say "now". */
  async lastWorkActivity(log: OpenShift, now: Date): Promise<Date> {
    return this.lastActivity(log, now, { work: true });
  }

  async lastActivity(log: OpenShift, now: Date, opts: { work?: boolean } = {}): Promise<Date> {
    const since = log.clockInAt;
    const photo = await lastPhotoAt(this.prisma, log.driverId, since, now);
    const candidates = [
      since,
      ...(opts.work ? [] : [log.driver.locationUpdatedAt, log.endCheckAnsweredAt]),
      photo,
    ].filter((d): d is Date => !!d && d.getTime() >= since.getTime() && d.getTime() <= now.getTime());
    return new Date(Math.max(...candidates.map((d) => d.getTime())));
  }

  /**
   * End the shift at his last activity, as auto-closed. Leaving before the
   * shift day's end is recorded as leaving early — without a reason, which is
   * what admin will see and can correct.
   */
  private async close(
    log: OpenShift,
    zone: Zone,
    source: 'auto_stale' | 'auto_returned' | 'auto_no_answer' | 'auto_in_city',
    now: Date,
    unanswered: number,
    atOverride?: Date,
  ): Promise<void> {
    const at = atOverride ?? (await this.lastActivity(log, now));
    // Against the snapshot taken at clock-in, like the driver's own clock-out.
    const earlyMinutes = earlyMinutesAt(log.clockInAt, log.expectedEnd, at);

    const closed = await this.prisma.$transaction(async (tx) => {
      // He may have clocked out himself a moment ago — then this changes nothing.
      const { count } = await tx.workLog.updateMany({
        where: { id: log.id, clockOutAt: null },
        data: {
          clockOutAt: at,
          closeSource: source,
          autoClosed: true,
          isEarlyLeave: earlyMinutes > 0,
          earlyMinutes,
          earlyLeaveReason: null,
          breakMinutes: { increment: breakTakenMinutes(log.driver, at) },
          endCheckRanAt: now,
          endCheckZone: zone,
          endCheckUnanswered: unanswered,
        },
      });
      if (count === 0) return false;
      await tx.driver.update({ where: { id: log.driverId }, data: { currentStatus: 'offline', breakUntil: null, breakStartedAt: null } });
      await tx.driverBreak.updateMany({ where: { driverId: log.driverId, endedAt: null }, data: { endedAt: now } });
      return true;
    });
    if (closed) {
      this.realtime.driverStatusChanged(log.driverId, 'offline');
      this.logger.log(`auto-closed shift ${log.id} (${source}) at ${at.toISOString()}`);
    }
  }
}
