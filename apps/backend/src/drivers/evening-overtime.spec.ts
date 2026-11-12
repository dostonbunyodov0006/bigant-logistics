import { capNoAnswer, eveningEnd, EveningOvertimeService, eveningMinutes } from './evening-overtime.service';
import { lastPhotoAt } from './last-photo';

jest.mock('./last-photo', () => ({ lastPhotoAt: jest.fn() }));

/** Tashkent wall time on 28.10.2026 as a UTC instant. */
const tas = (hhmm: string) => new Date(new Date(`2026-10-28T${hhmm}:00.000Z`).getTime() - 5 * 3_600_000);

function make(shift: Record<string, unknown>, rate = 70_000, fixes: unknown[] = []) {
  const created: unknown[] = [];
  const prisma = {
    workLog: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'wl1', driverId: 'd1', clockInAt: tas('08:55'), clockOutAt: tas('22:00'), expectedEnd: '18:00',
          driver: { vehicle: { category: 'katta' } }, ...shift,
        },
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    vehicleTariff: { findUnique: jest.fn().mockResolvedValue({ earlyHourSom: rate }) },
    driverLocationPing: { findMany: jest.fn().mockResolvedValue(fixes) },
    eveningOvertime: { create: jest.fn().mockImplementation(({ data }) => created.push(data)) },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new EveningOvertimeService(prisma as any), prisma, created };
}

describe('evening extra — minutes from six to the last photo', () => {
  it('counts from the end of the day to the last photo', () => {
    expect(eveningMinutes(tas('18:00'), tas('19:41'))).toBe(101);
  });
  it('nothing when the last photo is before six, or there is none', () => {
    expect(eveningMinutes(tas('18:00'), tas('16:30'))).toBe(0);
    expect(eveningMinutes(tas('18:00'), null)).toBe(0);
  });
});

describe('evening extra — a late start and time off (owner, 07.11.2026)', () => {
  it('a shift begun at 20:00 and ended at 21:00: 60 min, not from six', () => {
    expect(eveningMinutes(tas('18:00'), tas('21:00'), { clockInAt: tas('20:00') })).toBe(60);
  });
  it('04:30–19:30, reopened 20:00–21:00: 90 + 60 = 150, the 30 min off not paid', () => {
    const off = [{ from: tas('19:30'), to: tas('20:00') }];
    expect(eveningMinutes(tas('18:00'), tas('21:00'), { clockInAt: tas('04:30'), off })).toBe(150);
  });
  it('off time outside the evening is not taken off', () => {
    const off = [{ from: tas('12:00'), to: tas('13:00') }];
    expect(eveningMinutes(tas('18:00'), tas('19:00'), { clockInAt: tas('08:00'), off })).toBe(60);
  });
  it('no photo after the reopen: the evening ends at the earlier photo, nothing off', () => {
    const off = [{ from: tas('19:30'), to: tas('20:00') }];
    expect(eveningMinutes(tas('18:00'), tas('19:20'), { clockInAt: tas('08:00'), off })).toBe(80);
  });
});

describe('EveningOvertimeService — reopened and late shifts (owner, 07.11.2026)', () => {
  beforeEach(() => (lastPhotoAt as jest.Mock).mockReset());

  it('04:30–19:30 then 20:00–21:00 (one shift, reopened): one row of 150 min', async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('21:00'));
    const { svc, created } = make({
      clockInAt: tas('04:30'),
      clockOutAt: tas('21:00'),
      offPeriods: [{ from: tas('19:30').toISOString(), to: tas('20:00').toISOString() }],
    });
    await svc.runOnce(tas('21:05'));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ minutes: 150, dayEndAt: tas('18:00') });
  });

  it('a new shift begun at 20:00, last photo 21:00: 60 min, paid from 20:00', async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('21:00'));
    const { svc, created } = make({ clockInAt: tas('20:00'), clockOutAt: tas('21:00') });
    await svc.runOnce(tas('21:05'));
    expect(created[0]).toMatchObject({ minutes: 60, dayEndAt: tas('20:00') });
  });
});

describe('EveningOvertimeService', () => {
  beforeEach(() => (lastPhotoAt as jest.Mock).mockReset());

  it("the owner's example: last photo 19:41, pressed at home at 22:00 — paid 101 min, 117 833 so'm", async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('19:41'));
    const { svc, created, prisma } = make({});
    expect(await svc.runOnce(tas('22:01'))).toEqual({ paid: 1, none: 0 });
    expect(created[0]).toMatchObject({ workLogId: 'wl1', minutes: 101, rateHourSom: 70_000, amountSom: 117_833 });
    expect(prisma.workLog.updateMany).toHaveBeenCalledWith({ where: { id: 'wl1', eveningCheckedAt: null }, data: { eveningCheckedAt: tas('22:01') } });
  });

  it('a small lorry is paid at 40 000', async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('18:55'));
    const { svc, created } = make({ driver: { vehicle: { category: 'kichik' } } }, 40_000);
    await svc.runOnce(tas('22:01'));
    expect(created[0]).toMatchObject({ minutes: 55, amountSom: 36_667 });
  });

  it('done by six: marked, nothing paid', async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('17:40'));
    const { svc, created, prisma } = make({});
    expect(await svc.runOnce(tas('22:01'))).toEqual({ paid: 0, none: 1 });
    expect(created).toHaveLength(0);
    expect(prisma.workLog.updateMany).toHaveBeenCalled();
  });

  it('a shift of the 15th in a locked period: marked, no extra written (owner, 07.11.2026)', async () => {
    const at = (s: string) => new Date(`2026-11-${s}+05:00`);
    (lastPhotoAt as jest.Mock).mockResolvedValue(at('15T19:41:00'));
    const { svc, created, prisma } = make({ clockInAt: at('15T08:55:00'), clockOutAt: at('15T22:00:00') });
    expect(await svc.runOnce(at('16T12:00:00'))).toEqual({ paid: 0, none: 1 });
    expect(created).toHaveLength(0);
    expect(prisma.workLog.updateMany).toHaveBeenCalled();
  });

  it('the same shift on the 16th before 12:00 is still paid', async () => {
    const at = (s: string) => new Date(`2026-11-${s}+05:00`);
    (lastPhotoAt as jest.Mock).mockResolvedValue(at('15T19:41:00'));
    const { svc, created } = make({ clockInAt: at('15T08:55:00'), clockOutAt: at('15T22:00:00') });
    expect(await svc.runOnce(at('16T11:59:00'))).toEqual({ paid: 1, none: 0 });
    expect(created[0]).toMatchObject({ minutes: 101 });
  });
});

describe('closed for no answer: paid to the time he last confirmed (owner, 07.11.2026)', () => {
  beforeEach(() => (lastPhotoAt as jest.Mock).mockReset());

  it('capNoAnswer caps only a no-answer close, and only when the end runs past the clock-out', () => {
    expect(capNoAnswer('auto_no_answer', tas('19:41'), tas('18:30'))).toEqual(tas('18:30'));
    expect(capNoAnswer('auto_no_answer', tas('18:10'), tas('18:30'))).toEqual(tas('18:10'));
    expect(capNoAnswer('driver', tas('19:41'), tas('18:30'))).toEqual(tas('19:41'));
    expect(capNoAnswer('auto_stale', tas('19:41'), tas('18:30'))).toEqual(tas('19:41'));
  });

  it('pressed "+30" once at 18:00, closed 19:40, ended 18:30: a later photo pays only to 18:30', async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('19:20'));
    const { svc, created } = make({ clockOutAt: tas('18:30'), closeSource: 'auto_no_answer' });
    await svc.runOnce(tas('19:45'));
    expect(created[0]).toMatchObject({ minutes: 30 });
  });

  it('never pressed "+30": ended at 18:00, no evening extra', async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('17:50'));
    const { svc, created } = make({ clockOutAt: tas('18:00'), closeSource: 'auto_no_answer' });
    expect(await svc.runOnce(tas('19:15'))).toEqual({ paid: 0, none: 1 });
    expect(created).toHaveLength(0);
  });

  it('a Viloyat photo with the border after the clock-out: still capped at the clock-out', async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('18:20'));
    const fixes = [
      { lat: 40.84, lng: 68.66, recordedAt: tas('18:20') },
      { lat: 41.31, lng: 69.28, recordedAt: tas('19:30') },
    ];
    const { svc, created } = make({ clockOutAt: tas('19:00'), closeSource: 'auto_no_answer' }, 70_000, fixes);
    await svc.runOnce(tas('20:00'));
    expect(created[0]).toMatchObject({ minutes: 60 });
  });

  it("the same photo and close by the driver himself: today's rule, to the last photo", async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('19:20'));
    const { svc, created } = make({ clockOutAt: tas('21:00'), closeSource: 'driver' });
    await svc.runOnce(tas('21:05'));
    expect(created[0]).toMatchObject({ minutes: 80 });
  });
});

describe('EveningOvertimeService — back from a Viloyat', () => {
  it('a shift the system ended at the city border is paid from six to the border', async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('18:40'));
    const { svc, created } = make({ clockOutAt: tas('20:05'), closeSource: 'auto_returned' });
    await svc.runOnce(tas('22:01'));
    expect(created[0]).toMatchObject({ borderAt: tas('20:05'), minutes: 125 });
  });

  it('pays from six to the Tashkent border, by the hour, and keeps the photo too', async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('18:40'));
    const { svc, created } = make({}, 70_000, [
      { lat: 40.84, lng: 68.66, recordedAt: tas('18:39') },
      { lat: 41.3111, lng: 69.2797, recordedAt: tas('20:05') },
    ]);
    await svc.runOnce(tas('22:01'));
    expect(created[0]).toMatchObject({ lastPhotoAt: tas('18:40'), borderAt: tas('20:05'), minutes: 125 });
  });

  it('closed by the system at 03:00 at his 18:40 photo: the way back is read up to 03:00, and the border pays (owner, 05.11.2026)', async () => {
    (lastPhotoAt as jest.Mock).mockResolvedValue(tas('18:40'));
    const { svc, prisma, created } = make(
      { clockOutAt: tas('18:40'), closeSource: 'auto_stale', endCheckRanAt: new Date(tas('03:00').getTime() + 86_400_000) },
      70_000,
      [
        { lat: 40.84, lng: 68.66, recordedAt: tas('18:39') },
        { lat: 41.3111, lng: 69.2797, recordedAt: tas('20:30') },
      ],
    );
    await svc.runOnce(new Date(tas('08:00').getTime() + 86_400_000));
    expect(prisma.driverLocationPing.findMany.mock.calls[0][0].where.recordedAt.lte).toEqual(new Date(tas('03:00').getTime() + 86_400_000));
    expect(created[0]).toMatchObject({ borderAt: tas('20:30'), minutes: 150 });
  });
});

describe('where the evening ends', () => {
  const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00+05:00`);
  const fix = (hhmm: string, where: { lat: number; lng: number }) => ({ ...where, recordedAt: at(hhmm) });
  const SIRDARYO = { lat: 40.84, lng: 68.66 };
  const ROAD = { lat: 41.0, lng: 69.0 };
  const TASHKENT = { lat: 41.3111, lng: 69.2797 };

  it("the owner's example: photo in Sirdaryo at 18:40, ends when he enters Tashkent", () => {
    const res = eveningEnd(at('18:40'), [
      fix('18:39', SIRDARYO),
      fix('19:15', ROAD),
      fix('20:05', TASHKENT),
      fix('20:30', TASHKENT),
    ]);
    expect(res).toEqual({ end: at('20:05'), border: at('20:05') });
  });

  it('a photo in Tashkent ends the evening there, wherever he goes after', () => {
    expect(eveningEnd(at('19:41'), [fix('19:40', TASHKENT), fix('20:30', ROAD)])).toEqual({ end: at('19:41'), border: null });
  });

  it('a shift closed before he came back in is judged by the photo', () => {
    expect(eveningEnd(at('18:40'), [fix('18:39', SIRDARYO), fix('19:15', ROAD)])).toEqual({ end: at('18:40'), border: null });
  });

  it('with no fix at all it goes by the photo', () => {
    expect(eveningEnd(at('18:40'), [])).toEqual({ end: at('18:40'), border: null });
  });

  it("the owner's case: photo in Sirdaryo, stood there for hours, set off at 22:00 — still paid to the border", () => {
    const res = eveningEnd(at('18:40'), [fix('18:30', SIRDARYO), fix('22:00', SIRDARYO), fix('23:20', TASHKENT)]);
    expect(res).toEqual({ end: at('23:20'), border: at('23:20') });
  });

  it('reads the place of the photo from the nearest fix in time, before or after', () => {
    // Only a fix long after the photo, and it is already in the city: the photo cannot be placed outside.
    expect(eveningEnd(at('18:40'), [fix('19:30', TASHKENT)])).toEqual({ end: at('18:40'), border: null });
    // A Viloyat fix minutes after the photo places it outside.
    expect(eveningEnd(at('18:40'), [fix('18:46', SIRDARYO), fix('20:05', TASHKENT)])).toEqual({ end: at('20:05'), border: at('20:05') });
  });

  it('a Viloyat photo before six, back by five past seven, pays from six', () => {
    const { end } = eveningEnd(at('17:10'), [fix('17:09', SIRDARYO), fix('19:05', TASHKENT)]);
    expect(eveningMinutes(at('18:00'), end)).toBe(65);
  });
});
