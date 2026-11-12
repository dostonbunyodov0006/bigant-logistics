import { ShiftEndCheckService } from './shift-end-check.service';

/** HH:MM Tashkent on a day, as a UTC instant. */
const tas = (hhmm: string, day = '2026-09-26') => new Date(new Date(`${day}T${hhmm}:00.000Z`).getTime() - 5 * 3_600_000);

const TASHKENT_GPS = { state: null, city: 'Toshkent' };
const SAMARKAND_GPS = { state: 'Samarqand Viloyati', city: 'Samarqand' };
/** Where the city rings put a fix: Samarkand, Sirdaryo, the city centre. */
const IN_SAMARKAND = { locationLat: 39.65, locationLng: 66.96 };
const IN_SIRDARYO = { locationLat: 40.84, locationLng: 68.66 };

function openShift(over: Record<string, unknown> = {}, driver: Record<string, unknown> = {}) {
  return {
    id: 'wl1', driverId: 'd1', clockInAt: tas('09:02'), clockOutAt: null, expectedEnd: '18:00',
    endCheckRanAt: null, endCheckZone: null, endCheckSentAt: null, endCheckAnsweredAt: null, endCheckUnanswered: 0,
    ...over,
    driver: { id: 'd1', userId: 'u1', locationLat: 41.31, locationLng: 69.28, locationUpdatedAt: tas('18:05'), ...driver },
  };
}

function make(opts: {
  shifts: ReturnType<typeof openShift>[];
  inHand?: unknown[];
  bookedTonight?: number;
  fixes?: { lat: number; lng: number; recordedAt: Date }[];
  geocode?: unknown | 'throw';
  lastOrderIsCity?: boolean | null;
  activity?: Partial<Record<'delivered' | 'returned' | 'legReturned' | 'fuel' | 'service' | 'posted', Date>>;
}) {
  const a = opts.activity ?? {};
  const prisma = {
    driverBreak: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    workLog: {
      findMany: jest.fn().mockResolvedValue(opts.shifts),
      findFirst: jest.fn().mockResolvedValue(opts.shifts[0] ?? null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      // ordersInHand reads status + timing; zoneOf reads the delivery region.
      findMany: jest.fn().mockResolvedValue(opts.inHand ?? []),
      count: jest.fn().mockResolvedValue(opts.bookedTonight ?? 0),
      findFirst: jest.fn().mockImplementation(({ where }: { where: { status: { in: string[] } } }) =>
        Promise.resolve(
          where.status.in.includes('delivered') && opts.lastOrderIsCity != null ? { region: { isCity: opts.lastOrderIsCity } } : null,
        ),
      ),
      aggregate: jest.fn().mockImplementation(({ _max }: { _max: Record<string, true> }) =>
        Promise.resolve({ _max: _max.deliveredAt ? { deliveredAt: a.delivered ?? null } : { returnedAt: a.returned ?? null } }),
      ),
    },
    orderPickupSource: { aggregate: jest.fn().mockResolvedValue({ _max: { returnedAt: a.legReturned ?? null } }) },
    fuelLog: { aggregate: jest.fn().mockResolvedValue({ _max: { capturedAt: a.fuel ?? null } }) },
    serviceVisit: { aggregate: jest.fn().mockResolvedValue({ _max: { completedAt: a.service ?? null } }) },
    telegramReport: { aggregate: jest.fn().mockResolvedValue({ _max: { createdAt: a.posted ?? null } }) },
    driver: { update: jest.fn().mockResolvedValue({}) },
    driverLocationPing: { findMany: jest.fn().mockResolvedValue(opts.fixes ?? []) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const day = { isDayOff: false, startTime: '09:00', endTime: '18:00', startMinutes: 540, endMinutes: 1080 };
  const schedule = { resolver: jest.fn().mockResolvedValue(() => day), effectiveDay: jest.fn().mockResolvedValue(day) };
  const photon = {
    reverse: jest.fn().mockImplementation(() =>
      opts.geocode === 'throw' ? Promise.reject(new Error('photon down')) : Promise.resolve(opts.geocode ? [opts.geocode] : []),
    ),
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const realtime = { driverStatusChanged: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new ShiftEndCheckService(prisma as any, schedule as any, notifications as any, realtime as any);
  return { svc, prisma, photon, notifications, realtime };
}

describe('ShiftEndCheckService.runOnce — the diagram against data', () => {
  it('before 18:30 nothing is looked at (owner, 10.11.2026)', async () => {
    const { svc, notifications, prisma } = make({ shifts: [openShift()], geocode: TASHKENT_GPS });
    expect((await svc.runOnce(tas('18:29'))).checked).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.workLog.update).not.toHaveBeenCalled();
  });

  it('18:30, in Tashkent, no order: asked, and the shift stays open — no close, no "closed" push', async () => {
    const { svc, notifications, prisma } = make({ shifts: [openShift()], geocode: TASHKENT_GPS });
    const run = await svc.runOnce(tas('18:30'));
    expect(run.byAction).toEqual({ remind: 1 });
    expect(prisma.workLog.updateMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalledWith('u1', expect.objectContaining({ data: expect.objectContaining({ kind: 'shift_auto_closed' }) }));
  });

  it('with an order in hand he is working: no push', async () => {
    const { svc, notifications, prisma } = make({
      shifts: [openShift()],
      geocode: TASHKENT_GPS,
      inHand: [{ status: 'on_the_way', bookingKind: null, deliveryDatetime: tas('17:00') }],
    });
    expect((await svc.runOnce(tas('18:30'))).byAction).toEqual({ skip_active: 1 });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.workLog.update.mock.calls[0][0].data).toMatchObject({ endCheckSentAt: null, endCheckUnanswered: 0 });
  });

  it('in Samarkand: flagged Viloyat, left alone', async () => {
    const { svc, notifications, prisma } = make({ shifts: [openShift({}, IN_SAMARKAND)], geocode: SAMARKAND_GPS });
    expect((await svc.runOnce(tas('18:30'))).byAction).toEqual({ skip_viloyat: 1 });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.workLog.update.mock.calls[0][0].data).toMatchObject({ endCheckZone: 'viloyat' });
  });

  it('GPS hours old: where his last drop-off was decides — a region order makes him Viloyat', async () => {
    const { svc, photon } = make({ shifts: [openShift({}, { locationUpdatedAt: tas('11:00') })], lastOrderIsCity: false });
    expect((await svc.runOnce(tas('18:30'))).byAction).toEqual({ skip_viloyat: 1 });
    expect(photon.reverse).not.toHaveBeenCalled();
  });

  it('a fresh fix is judged by the city rings alone, with no geocoder', async () => {
    const { svc, photon } = make({ shifts: [openShift()], geocode: 'throw', lastOrderIsCity: false });
    expect((await svc.runOnce(tas('18:30'))).byAction).toEqual({ remind: 1 });
    expect(photon.reverse).not.toHaveBeenCalled();
  });

  it("the owner's case: out in Sirdaryo after six, then a fix inside the city — closed there, told, no question", async () => {
    const out = openShift({ endCheckRanAt: tas('19:50'), endCheckZone: 'viloyat' }, { ...IN_SIRDARYO, locationUpdatedAt: tas('19:49') });
    const a = make({ shifts: [out] });
    // Ten minutes later, still out: looked at again (a Viloyat shift is checked every ten minutes).
    expect((await a.svc.runOnce(tas('20:00'))).byAction).toEqual({ skip_viloyat: 1 });

    const back = openShift({ endCheckRanAt: tas('20:00'), endCheckZone: 'viloyat' }, { locationUpdatedAt: tas('20:05') });
    const b = make({ shifts: [back] });
    expect((await b.svc.runOnce(tas('20:10'))).byAction).toEqual({ close_returned: 1 });
    expect(b.prisma.workLog.updateMany.mock.calls[0][0].data).toMatchObject({ clockOutAt: tas('20:05'), closeSource: 'auto_returned', earlyMinutes: 0 });
    expect(b.notifications.notify).toHaveBeenCalledWith('u1', expect.objectContaining({ title: 'Siz ishni tugatdingiz' }));
  });

  it('fixes kept on the phone without internet: closed where he crossed the border, not where the internet came back (owner, 04.11.2026)', async () => {
    const back = openShift({ endCheckRanAt: tas('20:00'), endCheckZone: 'viloyat' }, { locationUpdatedAt: tas('20:40') });
    const fixes = [
      { lat: 40.84, lng: 68.66, recordedAt: tas('19:50') },
      { lat: 41.0, lng: 69.0, recordedAt: tas('20:05') },
      { lat: 41.31, lng: 69.28, recordedAt: tas('20:15') },
      { lat: 41.31, lng: 69.28, recordedAt: tas('20:40') },
    ];
    const b = make({ shifts: [back], fixes });
    expect((await b.svc.runOnce(tas('20:41'))).byAction).toEqual({ close_returned: 1 });
    expect(b.prisma.workLog.updateMany.mock.calls[0][0].data).toMatchObject({ clockOutAt: tas('20:15'), closeSource: 'auto_returned' });
  });

  it('back in the city with an order still in hand: he is working, not closed', async () => {
    const back = openShift({ endCheckRanAt: tas('20:00'), endCheckZone: 'viloyat' }, { locationUpdatedAt: tas('20:05') });
    const { svc } = make({ shifts: [back], inHand: [{ status: 'on_the_way', bookingKind: null, deliveryDatetime: tas('17:00') }] });
    expect((await svc.runOnce(tas('20:10'))).byAction).toEqual({ skip_active: 1 });
  });

  it('nothing to go by at all: asked, not skipped', async () => {
    const { svc } = make({ shifts: [openShift({}, { locationUpdatedAt: null, locationLat: null, locationLng: null })] });
    expect((await svc.runOnce(tas('18:30'))).byAction).toEqual({ remind: 1 });
  });

  it('two reminders unanswered by 19:10, never "+30": closed at 19:10 but ended at 18:00, and told (owner, 10.11.2026)', async () => {
    const shift = openShift({ endCheckRanAt: tas('19:00'), endCheckSentAt: tas('19:00'), endCheckUnanswered: 1 });
    const { svc, prisma, notifications } = make({ shifts: [shift], geocode: TASHKENT_GPS });
    expect((await svc.runOnce(tas('19:10'))).byAction).toEqual({ close_no_answer: 1 });
    expect(prisma.workLog.updateMany.mock.calls[0][0].data).toMatchObject({
      clockOutAt: tas('18:00'),
      closeSource: 'auto_no_answer',
      earlyMinutes: 0,
      isEarlyLeave: false,
      endCheckRanAt: tas('19:10'),
      endCheckUnanswered: 2,
    });
    expect(notifications.notify).toHaveBeenCalledWith('u1', expect.objectContaining({ type: 'shift_closed_no_answer' }));
    expect(notifications.notify.mock.calls[0][1].body).toContain('18:00');
  });

  it('the first ask (18:30) is not the last: no close time in it, and not closed at 18:40', async () => {
    const { svc, notifications, prisma } = make({ shifts: [openShift()], geocode: TASHKENT_GPS });
    expect((await svc.runOnce(tas('18:30'))).byAction).toEqual({ remind: 1 });
    expect(notifications.notify.mock.calls[0][1].body).not.toContain('avtomatik');
    expect(prisma.workLog.update.mock.calls[0][0].data).toMatchObject({ endCheckUnanswered: 0 });
    const after = openShift({ endCheckRanAt: tas('18:30'), endCheckSentAt: tas('18:30'), endCheckUnanswered: 0 });
    expect((await make({ shifts: [after], geocode: TASHKENT_GPS }).svc.runOnce(tas('18:40'))).checked).toBe(0);
  });

  it('the second ask (19:00) is the last and says when the shift will close by itself', async () => {
    const shift = openShift({ endCheckRanAt: tas('18:30'), endCheckSentAt: tas('18:30'), endCheckUnanswered: 0 });
    const { svc, notifications } = make({ shifts: [shift], geocode: TASHKENT_GPS });
    expect((await svc.runOnce(tas('19:00'))).byAction).toEqual({ remind: 1 });
    expect(notifications.notify.mock.calls[0][1].body).toContain('19:10');
  });

  it('pressed "+30" once at 18:30, then two asks unanswered: closed at 19:40, ended at 18:30', async () => {
    const shift = openShift({
      endCheckRanAt: tas('19:30'),
      endCheckSentAt: tas('19:30'),
      endCheckAnsweredAt: tas('18:30'),
      endCheckUnanswered: 1,
      endCheckNotes: [{ at: tas('18:30').toISOString(), note: 'Yunusobodda yuk tushiryapman' }],
    });
    const { svc, prisma, notifications } = make({ shifts: [shift], geocode: TASHKENT_GPS });
    expect((await svc.runOnce(tas('19:40'))).byAction).toEqual({ close_no_answer: 1 });
    expect(prisma.workLog.updateMany.mock.calls[0][0].data).toMatchObject({ clockOutAt: tas('18:30'), closeSource: 'auto_no_answer' });
    expect(notifications.notify.mock.calls[0][1].body).toContain('18:30');
  });

  it('reopened at 20:00 for an order, no "+30" since: ended at the reopen, not back at six', async () => {
    const shift = openShift({
      endCheckRanAt: tas('21:30'),
      endCheckSentAt: tas('21:30'),
      endCheckUnanswered: 2,
      offPeriods: [{ from: tas('19:10').toISOString(), to: tas('20:00').toISOString() }],
      endCheckNotes: [{ at: tas('18:00').toISOString(), note: 'yuk' }],
    });
    const { svc, prisma } = make({ shifts: [shift], geocode: TASHKENT_GPS });
    await svc.runOnce(tas('21:40'));
    expect(prisma.workLog.updateMany.mock.calls[0][0].data).toMatchObject({ clockOutAt: tas('20:00') });
  });

  it('a break begun after the time he last confirmed is not taken off', async () => {
    const shift = openShift(
      { endCheckRanAt: tas('19:00'), endCheckSentAt: tas('19:00'), endCheckUnanswered: 2 },
      { breakStartedAt: tas('18:40'), breakUntil: tas('19:40') },
    );
    const { svc, prisma } = make({ shifts: [shift], geocode: TASHKENT_GPS });
    await svc.runOnce(tas('19:10'));
    expect(prisma.workLog.updateMany.mock.calls[0][0].data).toMatchObject({ clockOutAt: tas('18:00'), breakMinutes: { increment: 0 } });
  });

  it('the next morning, still open: ended at his last photo to the groups, 19:41', async () => {
    const shift = openShift({}, { locationUpdatedAt: tas('07:30', '2026-09-27') }); // the app left open all night
    const { svc, prisma, notifications, realtime } = make({
      shifts: [shift],
      lastOrderIsCity: true,
      activity: { delivered: tas('19:20'), posted: tas('19:41') },
    });
    expect((await svc.runOnce(tas('07:40', '2026-09-27'))).byAction).toEqual({ close_stale: 1 });
    const data = prisma.workLog.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ clockOutAt: tas('19:41'), closeSource: 'auto_stale', autoClosed: true, isEarlyLeave: false });
    expect(prisma.driver.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { currentStatus: 'offline', breakUntil: null, breakStartedAt: null } });
    expect(realtime.driverStatusChanged).toHaveBeenCalledWith('d1', 'offline');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('the next morning, last photo at 16:30: ended at six, not as an early leave', async () => {
    const { svc, prisma } = make({ shifts: [openShift()], lastOrderIsCity: true, activity: { posted: tas('16:30') } });
    await svc.runOnce(tas('07:40', '2026-09-27'));
    expect(prisma.workLog.updateMany.mock.calls[0][0].data).toMatchObject({ clockOutAt: tas('18:00'), isEarlyLeave: false });
  });

  it('"+30 min" in between keeps him asked, not closed', async () => {
    const shift = openShift({ endCheckRanAt: tas('18:40'), endCheckSentAt: tas('18:30'), endCheckAnsweredAt: tas('18:40'), endCheckUnanswered: 0 });
    const { svc } = make({ shifts: [shift], geocode: TASHKENT_GPS });
    expect((await svc.runOnce(tas('19:00'))).checked).toBe(0); // asked again 30 min after his answer
    expect((await svc.runOnce(tas('19:10'))).byAction).toEqual({ remind: 1 });
  });

  it('open since 15.09 with nothing in hand: ended without asking, at his last activity', async () => {
    const shift = openShift({ clockInAt: tas('09:39', '2026-09-15') }, { locationUpdatedAt: tas('11:53', '2026-09-23') });
    const { svc, prisma, notifications } = make({ shifts: [shift], lastOrderIsCity: true });
    expect((await svc.runOnce(tas('07:00'))).byAction).toEqual({ close_stale: 1 });
    const data = prisma.workLog.updateMany.mock.calls[0][0].data;
    // No photo since: the end of his working day that day, not the phone's last GPS fix.
    expect(data).toMatchObject({ clockOutAt: tas('18:00', '2026-09-15'), closeSource: 'auto_stale', autoClosed: true });
    // Ended on a later day than it started: not an early leave.
    expect(data).toMatchObject({ isEarlyLeave: false, earlyMinutes: 0 });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('if he clocked out himself a moment before, the close changes nothing', async () => {
    const shift = openShift({ endCheckRanAt: tas('19:00'), endCheckSentAt: tas('19:00'), endCheckUnanswered: 2 });
    const { svc, prisma, realtime } = make({ shifts: [shift], geocode: TASHKENT_GPS });
    prisma.workLog.updateMany.mockResolvedValue({ count: 0 });
    await svc.runOnce(tas('19:10'));
    expect(prisma.driver.update).not.toHaveBeenCalled();
    expect(realtime.driverStatusChanged).not.toHaveBeenCalled();
  });

  it('one broken shift does not stop the others', async () => {
    const { svc, prisma } = make({ shifts: [openShift({ id: 'bad' }), openShift({ id: 'good' }, { id: 'd2', userId: 'u2' })], geocode: TASHKENT_GPS });
    // The reminder is written through update; one of the two trips on it.
    prisma.workLog.update.mockRejectedValueOnce(new Error('db hiccup'));
    const run = await svc.runOnce(tas('18:30'));
    expect(run.checked).toBe(2);
    expect(run.byAction).toEqual({ remind: 1 });
  });
});

describe('ShiftEndCheckService.afterWorkPhoto — the photo after hours', () => {
  it('after six, in the city, nothing else in hand: NOT closed — the 18:30 check asks him (owner, 10.11.2026)', async () => {
    const { svc, prisma, notifications, realtime } = make({ shifts: [openShift({}, { locationUpdatedAt: tas('18:02') })] });
    expect(await svc.afterWorkPhoto('d1', tas('18:02'))).toBe('tashkent');
    expect(prisma.workLog.updateMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(realtime.driverStatusChanged).not.toHaveBeenCalled();
  });

  it('before the end of the working day nothing happens', async () => {
    const { svc, prisma } = make({ shifts: [openShift()] });
    expect(await svc.afterWorkPhoto('d1', tas('17:40'))).toBe('before_end');
    expect(prisma.workLog.updateMany).not.toHaveBeenCalled();
  });

  it('another order still in hand, or a booking left for tonight: he is working', async () => {
    const a = make({ shifts: [openShift()], inHand: [{ status: 'on_the_way', bookingKind: null, deliveryDatetime: tas('17:00') }] });
    expect(await a.svc.afterWorkPhoto('d1', tas('18:20'))).toBe('working');
    const b = make({ shifts: [openShift()], bookedTonight: 1 });
    expect(await b.svc.afterWorkPhoto('d1', tas('18:20'))).toBe('working');
    expect(b.prisma.workLog.updateMany).not.toHaveBeenCalled();
  });

  it('the photo taken in Sirdaryo: left open and flagged Viloyat — the border will close it', async () => {
    const { svc, prisma } = make({ shifts: [openShift({}, { ...IN_SIRDARYO, locationUpdatedAt: tas('18:30') })] });
    expect(await svc.afterWorkPhoto('d1', tas('18:30'))).toBe('viloyat');
    expect(prisma.workLog.updateMany).not.toHaveBeenCalled();
    expect(prisma.workLog.update.mock.calls[0][0].data).toMatchObject({ endCheckZone: 'viloyat' });
  });

  it('off shift: nothing', async () => {
    const { svc } = make({ shifts: [] });
    expect(await svc.afterWorkPhoto('d1', tas('18:20'))).toBe('off_shift');
  });
});
