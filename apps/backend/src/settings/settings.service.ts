import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { WorkSettings as WorkSettingsRow } from '@prisma/client';
import type { UpdateWorkSettingsInput, WorkSettings } from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';
import { setShiftClock } from '../common/shift-clock';

// The work settings are a singleton keyed by this fixed id.
const SINGLETON_ID = 'default';

@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** The code reads the shift start and end from shift-clock.ts; keep it current. */
  async onModuleInit(): Promise<void> {
    await this.syncClock();
    this.timer = setInterval(() => void this.syncClock(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async syncClock(): Promise<void> {
    try {
      const s = await this.getWorkSettings();
      setShiftClock(s.shift_start, s.shift_end);
    } catch (err) {
      this.logger.warn(`work settings not read: ${(err as Error)?.message}`);
    }
  }

  /** Return the work settings, creating the default row on first access. */
  async getWorkSettings(): Promise<WorkSettings> {
    const row = await this.prisma.workSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
    return this.toPublic(row);
  }

  async updateWorkSettings(input: UpdateWorkSettingsInput): Promise<WorkSettings> {
    const data = {
      ...(input.expected_hours_per_day !== undefined && {
        expectedHoursPerDay: input.expected_hours_per_day,
      }),
      // Store a de-duplicated, sorted weekday set.
      ...(input.workdays !== undefined && { workdays: [...new Set(input.workdays)].sort((a, b) => a - b) }),
      ...(input.shift_start !== undefined && { shiftStart: input.shift_start }),
      ...(input.shift_end !== undefined && { shiftEnd: input.shift_end }),
      ...(input.late_grace_minutes !== undefined && {
        lateGraceMinutes: input.late_grace_minutes,
      }),
    };
    const row = await this.prisma.workSettings.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });
    // The new times take effect at once on this backend, within a minute on any other.
    setShiftClock(row.shiftStart, row.shiftEnd);
    return this.toPublic(row);
  }

  private toPublic(row: WorkSettingsRow): WorkSettings {
    return {
      expected_hours_per_day: row.expectedHoursPerDay,
      workdays: row.workdays,
      shift_start: row.shiftStart,
      shift_end: row.shiftEnd,
      late_grace_minutes: row.lateGraceMinutes,
      updated_at: row.updatedAt.toISOString(),
    };
  }
}
