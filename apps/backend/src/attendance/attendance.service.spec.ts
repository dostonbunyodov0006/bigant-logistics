import { updateWorkScheduleSchema } from '@bigant/shared';
import { AttendanceService } from './attendance.service';
import { ScheduleService } from './schedule.service';

/** 09:00 Tashkent on the given day, as the UTC instant we'd actually store. */
function at(dateKey: string, hhmm: string): Date {
  return new Date(`${dateKey}T${hhmm}:00.000+05:00`);
}

function makeService(opts: {
  logs?: Record<string, unknown>[];
  leaves?: Record<string, unknown>[];
  daysOff?: number[];
}) {
  const prisma = {
    driver: {
      findMany: jest.fn().mockResolvedValue([{ id: 'd1', user: { name: 'Hamza' } }]),
    },
    workLog: { findMany: jest.fn().mockResolvedValue(opts.logs ?? []) },
    leaveRequest: { findMany: jest.fn().mockResolvedValue(opts.leaves ?? []) },
  };
  const daysOff = new Set(opts.daysOff ?? [0]); // Sunday off by default
  const schedule = {
    resolver: jest.fn().mockResolvedValue((_driverId: string, weekday: number) => ({
      isDayOff: daysOff.has(weekday),
      startTime: '09:00',
      endTime: '18:00',
      startMinutes: 540,
      endMinutes: 1080,
    })),
  };
  return new AttendanceService(
    prisma as never,
    schedule as unknown as ScheduleService,
  );
}

// 2026-07-20 is a Monday; 2026-07-26 is a Sunday.
const MON = '2026-07-20';
const TUE = '2026-07-21';
const SUN = '2026-07-26';

describe('AttendanceService', () => {
  it('marks a scheduled past day with no shift as absent', async () => {
    const svc = makeService({});
    const res = await svc.report({ from: MON, to: MON });
    expect(res.rows[0].days[0].status).toBe('absent');
    expect(res.rows[0].days_absent).toBe(1);
    expect(res.rows[0].days_scheduled).toBe(1);
  });

  it('marks a non-working day as day_off, not absent', async () => {
    const svc = makeService({});
    const res = await svc.report({ from: SUN, to: SUN });
    expect(res.rows[0].days[0].status).toBe('day_off');
    expect(res.rows[0].days_absent).toBe(0);
    expect(res.rows[0].days_scheduled).toBe(0);
  });

  it('an approved leave covering the day beats absent', async () => {
    const svc = makeService({
      leaves: [{ driverId: 'd1', startDate: at(MON, '00:00'), endDate: at(TUE, '00:00') }],
    });
    const res = await svc.report({ from: MON, to: TUE });
    expect(res.rows[0].days.map((d) => d.status)).toEqual(['on_leave', 'on_leave']);
    expect(res.rows[0].days_on_leave).toBe(2);
  });

  it('reports a late arrival with its minutes and reason', async () => {
    const svc = makeService({
      logs: [
        {
          id: 'w1',
          driverId: 'd1',
          clockInAt: at(MON, '09:45'),
          clockOutAt: at(MON, '18:00'),
          isLate: true,
          lateMinutes: 45,
          lateReason: 'Traffic',
          isEarlyLeave: false,
          earlyMinutes: 0,
          earlyLeaveReason: null,
        },
      ],
    });
    const res = await svc.report({ from: MON, to: MON });
    const day = res.rows[0].days[0];
    expect(day.status).toBe('late');
    expect(day.first_clock_in).toBe('09:45');
    expect(day.last_clock_out).toBe('18:00');
    expect(day.late_minutes).toBe(45);
    expect(day.late_reason).toBe('Traffic');
    expect(res.rows[0].times_late).toBe(1);
    expect(res.rows[0].total_late_minutes).toBe(45);
    expect(res.rows[0].unexplained_late).toBe(0);
  });

  it('sums a split day and only counts the closing shift as leaving early', async () => {
    const svc = makeService({
      logs: [
        // Morning: on time, clocked out for lunch (that mid-day close is not
        // "leaving early" for the day).
        {
          id: 'w1',
          driverId: 'd1',
          clockInAt: at(MON, '09:00'),
          clockOutAt: at(MON, '13:00'),
          isLate: false,
          lateMinutes: 0,
          lateReason: null,
          isEarlyLeave: true,
          earlyMinutes: 300,
          earlyLeaveReason: 'Lunch',
        },
        // Afternoon: back, then finished an hour early.
        {
          id: 'w2',
          driverId: 'd1',
          clockInAt: at(MON, '14:00'),
          clockOutAt: at(MON, '17:00'),
          isLate: false,
          lateMinutes: 0,
          lateReason: null,
          isEarlyLeave: true,
          earlyMinutes: 60,
          earlyLeaveReason: 'Doctor',
        },
      ],
    });
    const res = await svc.report({ from: MON, to: MON });
    const day = res.rows[0].days[0];
    expect(day.status).toBe('present');
    expect(day.worked_minutes).toBe(4 * 60 + 3 * 60);
    expect(day.first_clock_in).toBe('09:00');
    expect(day.last_clock_out).toBe('17:00');
    expect(day.early_minutes).toBe(60); // the closing shift, not the lunch break
    expect(res.rows[0].times_left_early).toBe(1);
  });

  it('does not call today an absence while the day is still running', async () => {
    const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
    const svc = makeService({ daysOff: [] }); // every day is a working day
    const res = await svc.report({ from: today, to: today });
    expect(res.rows[0].days[0].status).toBe('not_started');
    expect(res.rows[0].days_absent).toBe(0);
  });

  it('a trip over several days credits each day, and the days in between are present, not absent', async () => {
    const WED = '2026-07-22';
    const svc = makeService({
      logs: [
        {
          id: 'w1',
          driverId: 'd1',
          clockInAt: at(MON, '09:00'),
          clockOutAt: at(WED, '12:00'),
          isLate: false,
          lateMinutes: 0,
          lateReason: null,
          isEarlyLeave: false,
          earlyMinutes: 0,
          earlyLeaveReason: null,
          autoClosed: false,
          endCheckZone: 'viloyat',
          breakMinutes: 0,
        },
      ],
    });
    const res = await svc.report({ from: MON, to: WED });
    const days = res.rows[0].days;
    expect(days.map((d) => d.status)).toEqual(['present', 'present', 'present']);
    expect(days.map((d) => d.worked_minutes)).toEqual([900, 1440, 720]);
    expect(days.every((d) => d.viloyat)).toBe(true);
    // Only the day he clocked in has a clock-in to show.
    expect(days.map((d) => d.first_clock_in)).toEqual(['09:00', null, null]);
    expect(res.rows[0].days_absent).toBe(0);
  });

  it('a schedule over midnight is refused', () => {
    const night = { weekday: 1, is_day_off: false, start_time: '20:00', end_time: '06:00' };
    const day = { weekday: 2, is_day_off: false, start_time: '09:00', end_time: '18:00' };
    const off = { weekday: 0, is_day_off: true, start_time: '09:00', end_time: '09:00' };
    expect(updateWorkScheduleSchema.safeParse({ days: [night] }).success).toBe(false);
    expect(updateWorkScheduleSchema.safeParse({ days: [day, off] }).success).toBe(true);
  });
});
