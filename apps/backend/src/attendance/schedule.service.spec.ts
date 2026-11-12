import { ScheduleService } from './schedule.service';

function makeService(rows: Record<string, unknown>[], settings?: Record<string, unknown>) {
  const prisma = {
    workSettings: {
      upsert: jest.fn().mockResolvedValue({
        id: 'default',
        workdays: [1, 2, 3, 4, 5, 6],
        shiftStart: '09:00',
        shiftEnd: '18:00',
        lateGraceMinutes: 10,
        ...settings,
      }),
    },
    workSchedule: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  return { svc: new ScheduleService(prisma as never), prisma };
}

const row = (o: Partial<Record<string, unknown>>) => ({
  id: 'x',
  driverId: null,
  weekday: 1,
  isDayOff: false,
  startTime: '08:00',
  endTime: '17:00',
  ...o,
});

describe('ScheduleService.resolver', () => {
  it('falls back to WorkSettings when nothing is configured', async () => {
    const { svc } = makeService([]);
    const resolve = await svc.resolver(['d1']);
    expect(resolve('d1', 1)).toMatchObject({
      isDayOff: false,
      startTime: '09:00',
      startMinutes: 540,
      endMinutes: 1080,
    });
    // Sunday is not in workdays → a day off.
    expect(resolve('d1', 0).isDayOff).toBe(true);
  });

  it('an org row overrides the settings fallback for that weekday', async () => {
    const { svc } = makeService([row({ weekday: 6, startTime: '09:00', endTime: '14:00' })]);
    const resolve = await svc.resolver(['d1']);
    // Saturday is a short day now…
    expect(resolve('d1', 6)).toMatchObject({ endTime: '14:00', endMinutes: 840 });
    // …but the other weekdays still come from settings.
    expect(resolve('d1', 2).endTime).toBe('18:00');
  });

  it('a driver row wins over the org row for the same weekday', async () => {
    const { svc } = makeService([
      row({ weekday: 1, startTime: '08:00' }),
      row({ id: 'y', driverId: 'd1', weekday: 1, startTime: '11:00' }),
    ]);
    const resolve = await svc.resolver(['d1', 'd2']);
    expect(resolve('d1', 1).startTime).toBe('11:00'); // own override
    expect(resolve('d2', 1).startTime).toBe('08:00'); // inherits the org row
  });

  it('honours a per-driver day off', async () => {
    const { svc } = makeService([row({ id: 'y', driverId: 'd1', weekday: 3, isDayOff: true })]);
    const resolve = await svc.resolver(['d1']);
    expect(resolve('d1', 3).isDayOff).toBe(true);
    expect(resolve('d2', 3).isDayOff).toBe(false);
  });
});
