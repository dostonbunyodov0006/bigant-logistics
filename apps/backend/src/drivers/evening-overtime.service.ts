import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { readOffPeriods, shiftDayEnd, type OffPeriod } from './shift-time';
import { lastPhotoAt } from './last-photo';
import { earlyAmount } from './morning-start.service';
import { insideTashkentCity } from '../geo/tashkent-city';
import { isPayDayLocked } from '../payroll/period-lock';

const MIN = 60_000;
/** Shifts closed longer ago than this are not looked at again. */
const LOOKBACK_MS = 3 * 24 * 60 * MIN;
/** Fixes from this long before the last photo are read, to know where it was taken. */
const BEFORE_PHOTO_MS = 12 * 60 * MIN;

type Fix = { lat: number; lng: number; recordedAt: Date };

/**
 * When his paid evening ended (owner, 02.11.2026). In Tashkent: at his last
 * photo. If that photo was taken in a Viloyat: when the lorry then entered
 * Tashkent city. Where the photo was taken is read from the fix nearest to it
 * in time, however long before or after — he may stand there for hours before
 * setting off (owner, 02.11.2026). With no fix at all, or a shift closed before
 * he came back in, only the photo can be judged by. `fixes` are in time order.
 */
export function eveningEnd(lastPhoto: Date, fixes: readonly Fix[]): { end: Date; border: Date | null } {
  const inCity = (f: Fix) => insideTashkentCity({ lat: f.lat, lon: f.lng });
  const gap = (f: Fix) => Math.abs(f.recordedAt.getTime() - lastPhoto.getTime());
  const nearest = fixes.reduce<Fix | null>((best, f) => (!best || gap(f) < gap(best) ? f : best), null);
  if (!nearest || inCity(nearest)) return { end: lastPhoto, border: null };
  const back = fixes.find((f) => f.recordedAt.getTime() > lastPhoto.getTime() && inCity(f));
  return back ? { end: back.recordedAt, border: back.recordedAt } : { end: lastPhoto, border: null };
}

/**
 * Minutes worked past the end of the working day: from 18:00 (his schedule's
 * end) to his last photo sent to the groups — not to when he pressed
 * «Ishni tugatish», which may be at home hours later (owner, 29.10.2026).
 */
export function eveningMinutes(
  dayEnd: Date,
  lastPhoto: Date | null,
  shift: { clockInAt?: Date; off?: readonly OffPeriod[] } = {},
): number {
  // A shift begun after six is paid from its start, and the time he was off
  // between a close and a reopen is not paid (owner, 07.11.2026).
  const start = Math.max(dayEnd.getTime(), shift.clockInAt?.getTime() ?? 0);
  if (!lastPhoto || lastPhoto.getTime() <= start) return 0;
  const end = lastPhoto.getTime();
  const off = (shift.off ?? []).reduce(
    (sum, p) => sum + Math.max(0, Math.min(end, p.to.getTime()) - Math.max(start, p.from.getTime())),
    0,
  );
  return Math.max(0, Math.floor((end - start - off) / MIN));
}

/**
 * Closed for no answer: paid only to the time he last confirmed, which is its
 * clock-out — six if he never pressed "+30", so nothing (owner, 07.11.2026).
 * Other closes keep their own end.
 */
export function capNoAnswer(closeSource: string | null, end: Date, clockOutAt: Date): Date {
  return closeSource === 'auto_no_answer' && end.getTime() > clockOutAt.getTime() ? clockOutAt : end;
}

/**
 * The evening extra (Kechki qo'shimcha): once a shift is closed — by the
 * driver or, the next day, by the system — its minutes past six are paid at
 * the lorry class's hourly rate, the same rate as the morning early start.
 */
@Injectable()
export class EveningOvertimeService {
  private readonly logger = new Logger(EveningOvertimeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runOnce(now: Date = new Date()): Promise<{ paid: number; none: number }> {
    const closed = await this.prisma.workLog.findMany({
      where: {
        clockOutAt: { not: null, gte: new Date(now.getTime() - LOOKBACK_MS) },
        eveningCheckedAt: null,
      },
      select: {
        id: true,
        driverId: true,
        clockInAt: true,
        clockOutAt: true,
        expectedEnd: true,
        closeSource: true,
        endCheckRanAt: true,
        offPeriods: true,
        driver: { select: { vehicle: { select: { category: true } } } },
      },
    });
    let paid = 0;
    let none = 0;
    for (const log of closed) {
      const dayEnd = shiftDayEnd(log.clockInAt, log.expectedEnd);
      const shift = { clockInAt: log.clockInAt, off: readOffPeriods(log.offPeriods) };
      // What the extra is paid from: six, or his clock-in if later (owner, 07.11.2026).
      const paidFrom = dayEnd && new Date(Math.max(dayEnd.getTime(), log.clockInAt.getTime()));
      let minutes = 0;
      let last: Date | null = null;
      let border: Date | null = null;
      if (dayEnd) {
        last = await lastPhotoAt(this.prisma, log.driverId, log.clockInAt, log.clockOutAt!);
        if (log.closeSource === 'auto_returned') {
          // Ended by the system as he entered the city: paid to that moment.
          border = log.clockOutAt!;
          minutes = eveningMinutes(dayEnd, border, shift);
          last = last ?? border;
        } else if (last) {
          // A shift the system closed the next night (03:00) was closed at his
          // last photo, but he was on the road until it was closed: the way
          // back is read up to that moment (owner, 05.11.2026 — positions that
          // reached the server late, once the internet came back).
          const readUntil =
            log.closeSource === 'auto_stale' && log.endCheckRanAt && log.endCheckRanAt.getTime() > log.clockOutAt!.getTime()
              ? log.endCheckRanAt
              : log.clockOutAt!;
          const fixes = await this.prisma.driverLocationPing.findMany({
            where: {
              driverId: log.driverId,
              recordedAt: { gte: new Date(last.getTime() - BEFORE_PHOTO_MS), lte: readUntil },
            },
            orderBy: { recordedAt: 'asc' },
            select: { lat: true, lng: true, recordedAt: true },
          });
          const ended = eveningEnd(last, fixes);
          border = ended.border;
          minutes = eveningMinutes(dayEnd, capNoAnswer(log.closeSource, ended.end, log.clockOutAt!), shift);
        }
      }
      const wrote = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.workLog.updateMany({ where: { id: log.id, eveningCheckedAt: null }, data: { eveningCheckedAt: now } });
        if (count === 0 || minutes === 0 || !paidFrom || !last) return false;
        // A shift in a paid, locked period gets no new extra (owner, 07.11.2026).
        if (isPayDayLocked(log.clockInAt, now) || isPayDayLocked(last, now)) return false;
        const category = log.driver.vehicle?.category ?? null;
        const rate = category
          ? ((await tx.vehicleTariff.findUnique({ where: { category }, select: { earlyHourSom: true } }))?.earlyHourSom ?? 0)
          : 0;
        await tx.eveningOvertime.create({
          data: {
            driverId: log.driverId,
            workLogId: log.id,
            dayEndAt: paidFrom,
            lastPhotoAt: last,
            borderAt: border,
            minutes,
            rateHourSom: rate,
            amountSom: earlyAmount(rate, minutes),
          },
        });
        return true;
      });
      if (wrote) {
        paid++;
        this.logger.log(`evening overtime for shift ${log.id}: ${minutes} min`);
      } else {
        none++;
      }
    }
    return { paid, none };
  }
}
