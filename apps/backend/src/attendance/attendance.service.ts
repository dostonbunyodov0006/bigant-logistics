import { Injectable } from '@nestjs/common';
import type { WorkLog } from '@prisma/client';
import type {
  AttendanceDay,
  AttendanceFilterInput,
  AttendanceReport,
  AttendanceRow,
  AttendanceStatus,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleService } from './schedule.service';
import { workedByDay } from '../drivers/shift-time';
import {
  dateKeyRange,
  dateKeyWeekday,
  tashkentDateKey,
  tashkentDayStartUtc,
  tashkentHhmm,
} from '../common/tashkent-time';

/**
 * Attendance ("came / didn't come, late / not late") derived per driver per day.
 *
 * There is no absence table: an absence is the *absence* of a shift on a day the
 * driver was scheduled to work and had no approved leave. That keeps the roster
 * and the record from drifting apart.
 *
 * Status priority: day_off → on_leave → late/present → not_started (today) → absent.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
  ) {}

  async report(filters: AttendanceFilterInput): Promise<AttendanceReport> {
    const dates = dateKeyRange(filters.from, filters.to);
    const rangeStart = tashkentDayStartUtc(filters.from);
    // Exclusive upper bound: midnight after the last day.
    const rangeEnd = new Date(tashkentDayStartUtc(filters.to).getTime() + 86_400_000);

    const drivers = await this.prisma.driver.findMany({
      where: filters.driver_id ? { id: filters.driver_id } : {},
      include: { user: { select: { name: true } } },
    });
    const driverIds = drivers.map((d) => d.id);
    if (driverIds.length === 0 || dates.length === 0) {
      return { from: filters.from, to: filters.to, dates, rows: [] };
    }

    const [logs, leaves, resolve] = await Promise.all([
      this.prisma.workLog.findMany({
        // Shifts that overlap the range: one begun the day before still has
        // hours after midnight on the first day.
        where: {
          driverId: { in: driverIds },
          clockInAt: { lt: rangeEnd },
          OR: [{ clockInAt: { gte: rangeStart } }, { clockOutAt: { gt: rangeStart } }],
        },
        orderBy: { clockInAt: 'asc' },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          driverId: { in: driverIds },
          status: 'approved',
          startDate: { lt: rangeEnd },
          endDate: { gte: rangeStart },
        },
        select: { driverId: true, startDate: true, endDate: true },
      }),
      this.schedule.resolver(driverIds),
    ]);

    // Group shifts by driver + the Tashkent day they began; and spread each
    // closed shift's worked minutes over every day it covered, so a shift over
    // midnight or a trip of several days is not all credited to its first day.
    const logsByKey = new Map<string, WorkLog[]>();
    const workedByKey = new Map<string, { minutes: number; viloyat: boolean }>();
    for (const l of logs) {
      const key = `${l.driverId}:${tashkentDateKey(l.clockInAt)}`;
      const list = logsByKey.get(key);
      if (list) list.push(l);
      else logsByKey.set(key, [l]);
      for (const d of workedByDay(l)) {
        const k = `${l.driverId}:${d.date}`;
        const w = workedByKey.get(k) ?? { minutes: 0, viloyat: false };
        w.minutes += d.minutes;
        w.viloyat ||= l.endCheckZone === 'viloyat';
        workedByKey.set(k, w);
      }
    }

    const leaveDays = new Set<string>();
    for (const lv of leaves) {
      for (const d of dateKeyRange(tashkentDateKey(lv.startDate), tashkentDateKey(lv.endDate))) {
        leaveDays.add(`${lv.driverId}:${d}`);
      }
    }

    const today = tashkentDateKey(new Date());
    const rows: AttendanceRow[] = drivers.map((driver) => {
      const days = dates.map((date) =>
        this.resolveDay({
          date,
          today,
          onLeave: leaveDays.has(`${driver.id}:${date}`),
          isDayOff: resolve(driver.id, dateKeyWeekday(date)).isDayOff,
          shifts: logsByKey.get(`${driver.id}:${date}`) ?? [],
          carried: workedByKey.get(`${driver.id}:${date}`) ?? null,
        }),
      );
      return { driver_id: driver.id, name: driver.user.name, ...this.totals(days), days };
    });

    return { from: filters.from, to: filters.to, dates, rows };
  }

  private resolveDay(input: {
    date: string;
    today: string;
    onLeave: boolean;
    isDayOff: boolean;
    shifts: WorkLog[];
    /** Worked minutes on this day from any shift, including one begun earlier. */
    carried: { minutes: number; viloyat: boolean } | null;
  }): AttendanceDay {
    const { date, today, onLeave, isDayOff, shifts, carried } = input;
    const empty = {
      first_clock_in: null,
      last_clock_out: null,
      late_minutes: 0,
      early_minutes: 0,
      worked_minutes: 0,
      late_reason: null,
      early_leave_reason: null,
      auto_closed: false,
      viloyat: false,
    };

    // No shift began today, but one begun earlier ran through it (a trip to
    // the regions): he was working, not absent. No clock-in to judge.
    if (shifts.length === 0 && carried && carried.minutes > 0) {
      return {
        date,
        status: 'present',
        ...empty,
        worked_minutes: carried.minutes,
        viloyat: carried.viloyat,
      };
    }

    if (shifts.length === 0) {
      let status: AttendanceStatus;
      if (isDayOff) status = 'day_off';
      else if (onLeave) status = 'on_leave';
      // Today is still in progress — not yet an absence.
      else if (date >= today) status = 'not_started';
      else status = 'absent';
      return { date, status, ...empty };
    }

    const first = shifts[0];
    // The day ends with the last shift that was actually closed.
    const closed = shifts.filter((s) => s.clockOutAt);
    const last = closed.length > 0 ? closed[closed.length - 1] : null;

    return {
      date,
      status: onLeave ? 'on_leave' : first.isLate ? 'late' : 'present',
      first_clock_in: tashkentHhmm(first.clockInAt),
      last_clock_out: last?.clockOutAt ? tashkentHhmm(last.clockOutAt) : null,
      late_minutes: first.lateMinutes,
      // Only the shift that ended the day counts as leaving early.
      early_minutes: last?.isEarlyLeave ? last.earlyMinutes : 0,
      worked_minutes: carried?.minutes ?? 0,
      late_reason: first.lateReason,
      early_leave_reason: last?.earlyLeaveReason ?? null,
      // A forgotten clock-out the system ended: the hours are its estimate.
      auto_closed: last?.autoClosed ?? false,
      viloyat: shifts.some((s) => s.endCheckZone === 'viloyat') || !!carried?.viloyat,
    };
  }

  private totals(days: AttendanceDay[]) {
    const count = (s: AttendanceStatus): number => days.filter((d) => d.status === s).length;
    const leftEarly = days.filter((d) => d.early_minutes > 0);
    const late = days.filter((d) => d.status === 'late');
    return {
      days_scheduled: days.filter((d) => d.status !== 'day_off').length,
      days_present: count('present') + count('late'),
      days_absent: count('absent'),
      days_on_leave: count('on_leave'),
      times_late: late.length,
      total_late_minutes: late.reduce((s, d) => s + d.late_minutes, 0),
      times_left_early: leftEarly.length,
      total_early_minutes: leftEarly.reduce((s, d) => s + d.early_minutes, 0),
      unexplained_late: late.filter((d) => !d.late_reason).length,
    };
  }
}
