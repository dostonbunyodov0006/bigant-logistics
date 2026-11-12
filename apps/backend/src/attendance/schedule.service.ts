import { Injectable, NotFoundException } from '@nestjs/common';
import type { WorkSchedule as WorkScheduleRow } from '@prisma/client';
import type { UpdateWorkScheduleInput, WorkSchedule, WorkScheduleDay } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { hhmmToMinutes } from '../common/tashkent-time';

/** The schedule that actually applies to a driver on one weekday. */
export interface EffectiveDay {
  isDayOff: boolean;
  /** "HH:MM" — meaningless when isDayOff. */
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
}

const SINGLETON_ID = 'default';

/**
 * Resolves the schedule for a driver on a given weekday, in three layers:
 *
 *   1. a driver-specific WorkSchedule row  (per-driver override)
 *   2. an organisation WorkSchedule row    (per-weekday override)
 *   3. WorkSettings                        (workdays + shiftStart/shiftEnd)
 *
 * Layer 3 means the feature works with zero configuration — the existing
 * settings keep behaving as the company default.
 */
@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve one weekday for one driver. */
  async effectiveDay(driverId: string, weekday: number): Promise<EffectiveDay> {
    const resolver = await this.resolver([driverId]);
    return resolver(driverId, weekday);
  }

  /**
   * Pre-load everything needed to resolve many (driver, weekday) pairs without
   * re-querying — the attendance report resolves drivers x days.
   */
  async resolver(driverIds: string[]): Promise<(driverId: string, weekday: number) => EffectiveDay> {
    const [settings, rows] = await Promise.all([
      this.prisma.workSettings.upsert({
        where: { id: SINGLETON_ID },
        update: {},
        create: { id: SINGLETON_ID },
      }),
      this.prisma.workSchedule.findMany({
        where: { OR: [{ driverId: null }, { driverId: { in: driverIds } }] },
      }),
    ]);

    const orgByWeekday = new Map<number, WorkScheduleRow>();
    const driverByKey = new Map<string, WorkScheduleRow>();
    for (const r of rows) {
      if (r.driverId === null) orgByWeekday.set(r.weekday, r);
      else driverByKey.set(`${r.driverId}:${r.weekday}`, r);
    }

    const fallbackStart = settings.shiftStart;
    const fallbackEnd = settings.shiftEnd;
    const workdays = new Set(settings.workdays);

    return (driverId: string, weekday: number): EffectiveDay => {
      const row = driverByKey.get(`${driverId}:${weekday}`) ?? orgByWeekday.get(weekday);
      if (row) {
        return this.toEffective(row.isDayOff, row.startTime, row.endTime);
      }
      return this.toEffective(!workdays.has(weekday), fallbackStart, fallbackEnd);
    };
  }

  /** Grace period (minutes past the shift start still counted as on time). */
  async graceMinutes(): Promise<number> {
    const settings = await this.prisma.workSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
    return settings.lateGraceMinutes;
  }

  // --- Schedule CRUD (org default = driverId null) ---

  async get(driverId: string | null): Promise<WorkSchedule> {
    if (driverId) await this.assertDriver(driverId);
    const rows = await this.prisma.workSchedule.findMany({
      where: { driverId },
      orderBy: { weekday: 'asc' },
    });
    return {
      driver_id: driverId,
      inherited: !!driverId && rows.length === 0,
      days: rows.map((r) => this.dayToPublic(r)),
    };
  }

  /** Replace the whole week. An empty list clears the override (re-inherit). */
  async replace(driverId: string | null, input: UpdateWorkScheduleInput): Promise<WorkSchedule> {
    if (driverId) await this.assertDriver(driverId);
    // Last write wins per weekday, so a duplicated weekday can't break the
    // partial unique index.
    const byWeekday = new Map(input.days.map((d) => [d.weekday, d]));
    await this.prisma.$transaction(async (tx) => {
      await tx.workSchedule.deleteMany({ where: { driverId } });
      if (byWeekday.size > 0) {
        await tx.workSchedule.createMany({
          data: [...byWeekday.values()].map((d) => ({
            driverId,
            weekday: d.weekday,
            isDayOff: d.is_day_off,
            startTime: d.start_time,
            endTime: d.end_time,
          })),
        });
      }
    });
    return this.get(driverId);
  }

  private async assertDriver(driverId: string): Promise<void> {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found');
  }

  private dayToPublic(r: WorkScheduleRow): WorkScheduleDay {
    return {
      weekday: r.weekday,
      is_day_off: r.isDayOff,
      start_time: r.startTime,
      end_time: r.endTime,
    };
  }

  private toEffective(isDayOff: boolean, startTime: string, endTime: string): EffectiveDay {
    return {
      isDayOff,
      startTime,
      endTime,
      startMinutes: hhmmToMinutes(startTime) ?? 0,
      endMinutes: hhmmToMinutes(endTime) ?? 24 * 60,
    };
  }
}
