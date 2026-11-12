import {
  BadRequestException,
  ConflictException,
  NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { driverLocationBatchSchema } from '@bigant/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { bearingDegrees, bonusPeriodRange, DriversService, motionFrom, nextTarget, hashLocationKey } from './drivers.service';

function baseDriver() {
  return {
    id: 'd1',
    userId: 'u1',
    currentStatus: 'offline',
    vehicleInfo: null,
    locationLat: null,
    locationLng: null,
    locationUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: 'u1',
      name: 'Ali',
      phoneNumber: '+998901112233',
      passwordHash: 'x',
      role: 'driver',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

/** An order the driver has in hand, with what clock-out reads from it. */
function inHandOrder(over: Record<string, unknown> = {}) {
  return { id: 'o1', orderNumber: 42, status: 'on_the_way', clientName: 'Barakat', bookingKind: null, deliveryDatetime: new Date(), createdBySellerId: 's1', ...over };
}

function makeService(
  opts: {
    activeOrders?: number;
    newStatus?: string;
    vehicleExists?: boolean;
    vehicleTakenBy?: Record<string, unknown> | null;
    openShift?: Record<string, unknown> | null;
    // Drive the schedule deterministically instead of depending on wall-clock
    // time: the boundary minutes are pushed far enough out that "late"/"early"
    // is decided purely by these flags.
    late?: boolean;
    early?: boolean;
    shiftsEarlierToday?: number;
    /** The day's real work start, minutes after midnight (owner, 07.11.2026). */
    workStart?: number;
  } = {},
) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...baseDriver().user, ...data }),
        ),
    },
    driver: {
      findUnique: jest.fn().mockResolvedValue(baseDriver()),
      findFirst: jest.fn().mockResolvedValue(opts.vehicleTakenBy ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...baseDriver(), vehicleId: data.vehicleId ?? null }),
        ),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...baseDriver(), ...data }),
        ),
    },
    vehicle: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.vehicleExists === false ? null : { id: 'veh1', plateNumber: '01A', model: 'X' },
        ),
    },
    order: {
      count: jest.fn().mockResolvedValue(opts.activeOrders ?? 0),
      // The status rules read the orders themselves now — their date decides
      // whether they are work yet. `activeOrders` of them, all workable today.
      findMany: jest.fn().mockResolvedValue(
        Array.from({ length: opts.activeOrders ?? 0 }, (_, i) => inHandOrder({ id: `o${i + 1}`, orderNumber: 40 + i })),
      ),
    },
    // No leave today unless a test says so.
    leaveRequest: { count: jest.fn().mockResolvedValue(0) },
    driverBreak: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    workLog: {
      // Clock-out judges "early" against the shift's own snapshot: an "early"
      // shift began just now and was due to end at 23:59 the same day.
      findFirst: jest.fn().mockResolvedValue(
        opts.openShift
          ? { clockInAt: new Date(), expectedEnd: opts.early ? '23:59' : null, ...opts.openShift }
          : null,
      ),
      updateMany: jest.fn().mockResolvedValue({ count: opts.openShift ? 1 : 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(opts.shiftsEarlierToday ?? 0),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'wl1', driverId: 'd1', clockInAt: new Date(), clockOutAt: null }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'wl1',
          driverId: 'd1',
          clockInAt: new Date(Date.now() - 3_600_000),
          clockOutAt: (data.clockOutAt as Date) ?? new Date(),
          ...data,
        }),
      ),
      findUniqueOrThrow: jest.fn().mockImplementation(() =>
        Promise.resolve({ id: 'wl1', driverId: 'd1', clockInAt: new Date(Date.now() - 3_600_000), clockOutAt: new Date(), carryOvers: [] }),
      ),
    },
    orderCarryOver: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    morningStart: { aggregate: jest.fn().mockResolvedValue({ _sum: { earlyMinutes: null, amountSom: null } }) }, eveningOvertime: { aggregate: jest.fn().mockResolvedValue({ _sum: { minutes: null, amountSom: null } }) }, fine: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } }) },
    driverDocument: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'ddoc1',
          driverId: 'd1',
          type: 'license',
          number: null,
          issuedAt: null,
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      findUnique: jest.fn().mockResolvedValue({ id: 'ddoc1', driverId: 'd1' }),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'ddoc1',
          number: null,
          issuedAt: null,
          notes: null,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  const vehicles = {
    logKm: jest.fn().mockResolvedValue({ id: 'km1', km: 100 }),
    addIncident: jest.fn().mockResolvedValue({ id: 'inc1', type: 'accident' }),
  };
  // Run transactions inline against the same mock (tx === prisma).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$transaction = (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma);
  const realtime = { driverStatusChanged: jest.fn(), orderStatusChanged: jest.fn() };
  const notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) };
  const schedule = {
    effectiveDay: jest.fn().mockResolvedValue({
      isDayOff: false,
      startTime: '09:00',
      endTime: '18:00',
      // Far past / far future so the outcome never depends on the clock.
      startMinutes: opts.workStart ?? (opts.late ? -10_000 : 10_000),
      endMinutes: opts.early ? 10_000 : -10_000,
    }),
    graceMinutes: jest.fn().mockResolvedValue(10),
  };
  // The odometer photo reader: no answer unless a test says otherwise.
  const reader = { read: jest.fn().mockResolvedValue(null) };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: new DriversService(prisma as any, vehicles as any, realtime as any, schedule as any, notifications as any, reader as any),
    notifications,
    prisma,
    vehicles,
    schedule,
    reader,
  };
}

describe('DriversService.updateProfile (vehicle assignment)', () => {
  it('assigns a vehicle to a driver', async () => {
    const { service, prisma } = makeService();
    await service.updateProfile('d1', { vehicle_id: 'veh1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vehicle: { connect: { id: 'veh1' } } }),
      }),
    );
  });

  it('unassigns a vehicle when vehicle_id is null', async () => {
    const { service, prisma } = makeService();
    await service.updateProfile('d1', { vehicle_id: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ vehicle: { disconnect: true } }) }),
    );
  });

  it('updates the driver name and phone via the user relation', async () => {
    const { service, prisma } = makeService();
    await service.updateProfile('d1', { name: 'New Name', phone_number: '+998900000009' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user: { update: { name: 'New Name', phoneNumber: '+998900000009' } },
        }),
      }),
    );
  });

  it('rejects an edit whose phone collides with another user', async () => {
    const { service, prisma } = makeService();
    // getManageable path uses driver.findUnique; the phone check uses user.findUnique.
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'other',
      phoneNumber: '+998900000009',
    });
    await expect(
      service.updateProfile('d1', { phone_number: '+998900000009' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects assigning a vehicle already taken by another driver', async () => {
    const { service } = makeService({ vehicleTakenBy: { id: 'd2' } });
    await expect(service.updateProfile('d1', { vehicle_id: 'veh1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects assigning a non-existent vehicle', async () => {
    const { service } = makeService({ vehicleExists: false });
    await expect(service.updateProfile('d1', { vehicle_id: 'veh1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('DriversService.create (with vehicle)', () => {
  it('creates a driver with an assigned vehicle', async () => {
    const { service, prisma } = makeService();
    await service.create({
      name: 'Ali',
      phone_number: '+998900000001',
      password: 'secret1',
      vehicle_id: 'veh1',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vehicle: { connect: { id: 'veh1' } } }),
      }),
    );
  });

  it('rejects creating a driver with an already-assigned vehicle', async () => {
    const { service } = makeService({ vehicleTakenBy: { id: 'd2' } });
    await expect(
      service.create({
        name: 'Ali',
        phone_number: '+998900000001',
        password: 'secret1',
        vehicle_id: 'veh1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DriversService.logMyKm', () => {
  it('refuses kilometres without the odometer photo (owner, 05.11.2026)', async () => {
    const { service, prisma, vehicles } = makeService();
    (prisma.driver.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'd1',
      userId: 'u1',
      vehicleId: 'veh1',
    });
    await expect(service.logMyKm('u1', 48500)).rejects.toMatchObject({ message: 'odometer_photo_required' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((vehicles as any).logKm).not.toHaveBeenCalled();
  });

  it('the Monday photo and the typed km are both taken as they are — no AI check (owner, 05.11.2026)', async () => {
    const { service, prisma, reader, vehicles } = makeService();
    (prisma.driver.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'd1', userId: 'u1', vehicleId: 'veh1' });
    const PHOTO = 'https://logistics.example.com/media/km/1.jpg';
    await service.logMyKm('u1', 48500, PHOTO);
    expect(reader.read).not.toHaveBeenCalled();
    expect(vehicles.logKm).toHaveBeenCalledWith('veh1', 48500, 'u1', PHOTO, { aiKm: null, status: 'skipped' });
  });

  it('asks for the odometer from Monday until that week has its reading', async () => {
    const monday = new Date('2026-11-02T04:30:00Z'); // Monday 09:30 in Tashkent
    const friday = new Date('2026-10-30T08:00:00Z');
    const { service, prisma } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prisma as any;
    p.driver.findUnique = jest.fn().mockResolvedValue({ vehicleId: 'veh1', vehicle: { currentKm: 152_300 } });
    p.kmRecord = { findFirst: jest.fn().mockResolvedValue(null) };
    expect(await service.myKmDue('u1', monday)).toEqual({ due: true, last_km: 152_300 });
    // Counted from Monday 00:00 Tashkent (Sunday 19:00 UTC).
    expect(p.kmRecord.findFirst.mock.calls[0][0].where.recordedAt.gte.toISOString()).toBe('2026-11-01T19:00:00.000Z');
    p.kmRecord.findFirst.mockResolvedValue({ id: 'k1' });
    expect((await service.myKmDue('u1', monday)).due).toBe(false);
    p.kmRecord.findFirst.mockResolvedValue(null);
    expect((await service.myKmDue('u1', friday)).due).toBe(true);
  });

  // Owner, 07.11.2026: a Monday missed is asked on the following days until it is in.
  it('Tuesday with no reading since Monday: due; with a Monday reading: not due', async () => {
    const tuesday = new Date('2026-11-03T05:00:00Z'); // Tuesday 10:00 Tashkent
    const { service, prisma } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prisma as any;
    p.driver.findUnique = jest.fn().mockResolvedValue({ vehicleId: 'veh1', vehicle: { currentKm: 152_300 } });
    p.kmRecord = { findFirst: jest.fn().mockResolvedValue(null) };
    expect(await service.myKmDue('u1', tuesday)).toEqual({ due: true, last_km: 152_300 });
    // Still counted from this week's Monday 00:00 Tashkent.
    expect(p.kmRecord.findFirst.mock.calls[0][0].where.recordedAt.gte.toISOString()).toBe('2026-11-01T19:00:00.000Z');
    expect(p.kmRecord.findFirst.mock.calls[0][0].where.vehicleId).toBe('veh1');
    p.kmRecord.findFirst.mockResolvedValue({ id: 'k-monday' });
    expect((await service.myKmDue('u1', tuesday)).due).toBe(false);
    // Sunday belongs to the week begun the Monday before.
    p.kmRecord.findFirst.mockResolvedValue(null);
    await service.myKmDue('u1', new Date('2026-11-08T06:00:00Z'));
    expect(p.kmRecord.findFirst.mock.calls.at(-1)[0].where.recordedAt.gte.toISOString()).toBe('2026-11-01T19:00:00.000Z');
  });

  it('no vehicle: never due', async () => {
    const { service, prisma } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).driver.findUnique = jest.fn().mockResolvedValue({ vehicleId: null, vehicle: null });
    expect(await service.myKmDue('u1', new Date('2026-11-03T05:00:00Z'))).toEqual({ due: false, last_km: null });
  });

  it('rejects when the driver has no assigned vehicle', async () => {
    const { service } = makeService();
    await expect(service.logMyKm('u1', 48500)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DriversService.reportIncident', () => {
  it('reports an incident for the driver assigned vehicle', async () => {
    const { service, prisma, vehicles } = makeService();
    (prisma.driver.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'd1',
      userId: 'u1',
      vehicleId: 'veh1',
    });
    await service.reportIncident('u1', { type: 'accident', order_id: 'o1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((vehicles as any).addIncident).toHaveBeenCalledWith(
      'veh1',
      expect.objectContaining({ type: 'accident', order_id: 'o1' }),
      'u1',
    );
  });

  it('tells the admins and dispatchers on the site, not Telegram', async () => {
    const { service, prisma, notifications } = makeService();
    (prisma.driver.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'd1', userId: 'u1', vehicleId: 'veh1' })
      .mockResolvedValueOnce({ user: { name: 'Haydovchi 2' }, vehicle: { plateNumber: '01 S 002 SS' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user as any).findMany = jest.fn().mockResolvedValue([{ id: 'admin1' }, { id: 'disp1' }]);
    await service.reportIncident('u1', { type: 'breakdown', description: 'Shina teshildi' });
    expect(notifications.notifyMany).toHaveBeenCalledWith(['admin1', 'disp1'], {
      type: 'vehicle.incident',
      title: 'Buzilish: Haydovchi 2 (01 S 002 SS)',
      body: 'Shina teshildi',
      relatedOrderId: null,
    });
  });

  it('rejects an incident report when the driver has no vehicle', async () => {
    const { service } = makeService();
    await expect(service.reportIncident('u1', { type: 'accident' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('DriversService work shifts', () => {
  it('clocks in: opens a shift and brings an offline driver online', async () => {
    const { service, prisma } = makeService({ openShift: null });
    const res = await service.clockIn('u1');
    expect(res.clock_out_at).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ driverId: 'd1' }) }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentStatus: 'available' } }),
    );
  });

  it('started again the same day: the closed shift carries on, not a second one (owner, 04.11.2026)', async () => {
    // An order came to him after he ended the day (owner, 07.11.2026).
    const { service, prisma } = makeService({ openShift: null, activeOrders: 1, workStart: 0 });
    const closedAt = new Date(Date.now() - 30 * 60_000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wl = prisma.workLog as any;
    wl.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'wl9', driverId: 'd1', clockInAt: new Date(Date.now() - 60 * 60_000), clockOutAt: closedAt });
    wl.updateMany.mockResolvedValue({ count: 1 });
    wl.findUniqueOrThrow.mockResolvedValue({ id: 'wl9', driverId: 'd1', clockInAt: new Date(Date.now() - 60 * 60_000), clockOutAt: null, carryOvers: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evening = ((prisma as any).eveningOvertime.deleteMany = jest.fn().mockResolvedValue({ count: 1 }));
    const res = await service.clockIn('u1');
    expect(res.clock_out_at).toBeNull();
    expect(wl.create).not.toHaveBeenCalled();
    const data = wl.updateMany.mock.calls[0][0].data;
    expect(wl.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'wl9' });
    expect(data).toMatchObject({ clockOutAt: null, closeSource: null, autoClosed: false, eveningCheckedAt: null, endCheckUnanswered: 0 });
    // The half hour he was off is not worked time.
    expect(data.breakMinutes.increment).toBeGreaterThanOrEqual(29);
    expect(evening).toHaveBeenCalledWith({ where: { workLogId: 'wl9' } });
  });

  it('ended the day with no order since: he cannot start again (owner, 07.11.2026)', async () => {
    const { service, prisma } = makeService({ openShift: null, activeOrders: 0, workStart: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wl = prisma.workLog as any;
    wl.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'wl9', driverId: 'd1', clockInAt: new Date(Date.now() - 60 * 60_000), clockOutAt: new Date(Date.now() - 30 * 60_000) });
    await expect(service.clockIn('u1')).rejects.toMatchObject({ message: 'shift_closed_no_order' });
    expect(wl.updateMany).not.toHaveBeenCalled();
    expect(wl.create).not.toHaveBeenCalled();
  });

  it('an order offered but not yet taken keeps GPS required (owner, 07.11.2026)', async () => {
    const { service, prisma } = makeService({ openShift: null, activeOrders: 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([inHandOrder({ status: 'assigned_to_driver' })]);
    const w = await service.gpsRequired('d1', true, new Date());
    expect(w).not.toBeNull();
  });

  it('a shift from an earlier shift day is not reopened: a new one starts', async () => {
    const { service, prisma } = makeService({ openShift: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wl = prisma.workLog as any;
    const old = new Date(Date.now() - 2 * 86_400_000);
    wl.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'wl8', driverId: 'd1', clockInAt: old, clockOutAt: old });
    await service.clockIn('u1');
    expect(wl.create).toHaveBeenCalled();
    expect(wl.updateMany).not.toHaveBeenCalled();
  });

  it('rejects clock-in when a shift is already open', async () => {
    const { service } = makeService({ openShift: { id: 'wl0' } });
    await expect(service.clockIn('u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores a late reason on clock-in and flags the shift late', async () => {
    const { service, prisma } = makeService({ openShift: null, late: true });
    await service.clockIn('u1', { late_reason: 'Traffic jam' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lateReason: 'Traffic jam',
          isLate: true,
          expectedStart: '09:00',
        }),
      }),
    );
  });

  it('stores an early-leave reason on clock-out and flags it', async () => {
    const { service, prisma } = makeService({
      openShift: { id: 'wl1' },
      activeOrders: 0,
      early: true,
    });
    await service.clockOut('u1', { early_leave_reason: 'Doctor visit' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ earlyLeaveReason: 'Doctor visit', isEarlyLeave: true }),
      }),
    );
  });

  it('"Polniy": the day off ends the shift early with no reason asked, marked as a day off (owner, 12.11.2026)', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' }, activeOrders: 0, early: true });
    await service.clockOut('u1', { day_off: true, early_leave_reason: 'Uyda ish bor' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dayOff: true, earlyLeaveReason: 'Javob olgan (polniy): Uyda ish bor' }),
      }),
    );
  });

  it('"Polniy" with an order in hand is refused, as a break is', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' }, activeOrders: 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([inHandOrder({ status: 'driver_accepted' })]);
    await expect(service.clockOut('u1', { day_off: true })).rejects.toMatchObject({ message: 'driver_busy_finish_delivery' });
  });

  it('clocks out: closes the shift and takes the driver offline', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' }, activeOrders: 0 });
    const res = await service.clockOut('u1');
    expect(res.clock_out_at).not.toBeNull();
    expect(res.duration_minutes).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentStatus: 'offline', breakUntil: null, breakStartedAt: null, breakReason: null } }),
    );
  });

  it('refuses a late clock-in with no reason, so the prompt cannot be skipped', async () => {
    const { service, prisma } = makeService({ openShift: null, late: true });
    await expect(service.clockIn('u1')).rejects.toBeInstanceOf(BadRequestException);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).create).not.toHaveBeenCalled();
  });

  it('a day of leave: he is told first, and if he starts anyway he is not late', async () => {
    const { service, prisma } = makeService({ openShift: null, late: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).leaveRequest.count.mockResolvedValue(1);
    await expect(service.clockIn('u1')).rejects.toMatchObject({ message: 'on_leave_today' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).create).not.toHaveBeenCalled();
    await service.clockIn('u1', { on_leave_ok: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (prisma.workLog as any).create.mock.calls[0][0].data;
    expect(data).toMatchObject({ isLate: false, lateReason: null });
  });

  it('refuses an early clock-out with no reason', async () => {
    const { service } = makeService({ openShift: { id: 'wl1' }, activeOrders: 0, early: true });
    await expect(service.clockOut('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not re-flag lateness on the second clock-in of the same day', async () => {
    // Back from lunch: the schedule still says "late", but an earlier shift today
    // means this is not a late arrival, so no reason is demanded.
    const { service, prisma } = makeService({ openShift: null, late: true, shiftsEarlierToday: 1 });
    await service.clockIn('u1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isLate: false, lateMinutes: 0 }) }),
    );
  });

  it('treats an arrival inside the grace period as on time', async () => {
    const { service, prisma, schedule } = makeService({ openShift: null });
    // Shift started 5 minutes ago, grace is 10 → on time, no reason demanded.
    const nowMinutes =
      new Date(Date.now() + 5 * 3_600_000).getUTCHours() * 60 +
      new Date(Date.now() + 5 * 3_600_000).getUTCMinutes();
    schedule.effectiveDay.mockResolvedValue({
      isDayOff: false,
      startTime: '09:00',
      endTime: '18:00',
      startMinutes: nowMinutes - 5,
      endMinutes: nowMinutes + 60,
    });
    await service.clockIn('u1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isLate: false }) }),
    );
  });

  it('counts an arrival past the grace period as late', async () => {
    const { service, schedule } = makeService({ openShift: null });
    const shiftedNow = new Date(Date.now() + 5 * 3_600_000);
    const nowMinutes = shiftedNow.getUTCHours() * 60 + shiftedNow.getUTCMinutes();
    // 11 minutes past a 10-minute grace.
    schedule.effectiveDay.mockResolvedValue({
      isDayOff: false,
      startTime: '09:00',
      endTime: '18:00',
      startMinutes: nowMinutes - 11,
      endMinutes: nowMinutes + 60,
    });
    await expect(service.clockIn('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never counts a clock-in on a non-working day as late', async () => {
    const { service, prisma, schedule } = makeService({ openShift: null, late: true });
    schedule.effectiveDay.mockResolvedValue({
      isDayOff: true,
      startTime: '09:00',
      endTime: '18:00',
      startMinutes: -10_000,
      endMinutes: 10_000,
    });
    await service.clockIn('u1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isLate: false, expectedStart: null }),
      }),
    );
  });

  it('rejects clock-out when there is no open shift', async () => {
    const { service } = makeService({ openShift: null });
    await expect(service.clockOut('u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks clock-out mid-delivery', async () => {
    const { service } = makeService({ openShift: { id: 'wl1' }, activeOrders: 1 });
    await expect(service.clockOut('u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('a return being carried back is an order in hand like any other: he is asked, not refused', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([inHandOrder({ status: 'returning' })]);
    await expect(service.clockOut('u1')).rejects.toThrow('driver_has_orders');
  });
});

describe('DriversService.findAll (search)', () => {
  it("the Ishdan bo'shatilganlar list asks for the drivers let go", async () => {
    const { service, prisma } = makeService();
    await service.findAll(undefined, 'inactive');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user: { status: 'inactive' } } }),
    );
  });

  it('returns all drivers when no search term', async () => {
    const { service, prisma } = makeService();
    await service.findAll();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user: { status: 'active' } } }),
    );
  });

  it('filters drivers by name / phone / vehicle when searching', async () => {
    const { service, prisma } = makeService();
    await service.findAll('hamza');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user: { status: 'active' },
          OR: expect.arrayContaining([
            { user: { name: { contains: 'hamza', mode: 'insensitive' } } },
            { vehicle: { plateNumber: { contains: 'hamza', mode: 'insensitive' } } },
          ]),
        },
      }),
    );
  });
});

describe('DriversService.remove', () => {
  it('deactivates the account, releases the vehicle, and preserves driver history', async () => {
    const { service, prisma } = makeService({ activeOrders: 0 });

    await expect(service.remove('d1')).resolves.toEqual({ deleted: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driver as any).update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: {
        currentStatus: 'offline',
        vehicle: { disconnect: true },
        breakUntil: null,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.user as any).update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'inactive' },
    });
  });

  it('refuses to deactivate a driver who still has an active order', async () => {
    const { service, prisma } = makeService({ activeOrders: 1 });

    await expect(service.remove('d1')).rejects.toThrow('driver_has_active_order');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.user as any).update).not.toHaveBeenCalled();
  });
});

describe('DriversService.getTimesheet', () => {
  it('aggregates completed shifts per driver over the range', async () => {
    const { service, prisma } = makeService();
    (prisma.workLog.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'w1',
        driverId: 'd1',
        clockInAt: new Date('2026-07-01T08:00:00.000Z'),
        clockOutAt: new Date('2026-07-01T12:00:00.000Z'), // 4h
        driver: { user: { name: 'Ali' } },
      },
      {
        id: 'w2',
        driverId: 'd1',
        clockInAt: new Date('2026-07-02T09:00:00.000Z'),
        clockOutAt: new Date('2026-07-02T11:30:00.000Z'), // 2.5h
        driver: { user: { name: 'Ali' } },
      },
    ]);
    const rows = await service.getTimesheet({ from: '2026-07-01', to: '2026-07-31' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      driver_id: 'd1',
      name: 'Ali',
      days_worked: 2,
      shift_count: 2,
      total_minutes: 390,
    });
  });

  it('returns an empty timesheet when no shifts fall in the range', async () => {
    const { service } = makeService();
    const rows = await service.getTimesheet({ from: '2026-07-01', to: '2026-07-31' });
    expect(rows).toEqual([]);
  });
});

describe('DriversService.getWorkReport', () => {
  it('rolls up summary, per-day and per-driver totals', async () => {
    const { service, prisma } = makeService();
    (prisma.workLog.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'w1',
        driverId: 'd1',
        clockInAt: new Date('2026-07-01T08:00:00.000Z'),
        clockOutAt: new Date('2026-07-01T12:00:00.000Z'), // 240m
        driver: { user: { name: 'Ali' } },
      },
      {
        id: 'w2',
        driverId: 'd2',
        clockInAt: new Date('2026-07-01T09:00:00.000Z'),
        clockOutAt: new Date('2026-07-01T10:00:00.000Z'), // 60m, same day
        driver: { user: { name: 'Vali' } },
      },
    ]);
    const report = await service.getWorkReport({ from: '2026-07-01', to: '2026-07-31' });
    expect(report.summary).toMatchObject({
      total_minutes: 300,
      total_shifts: 2,
      driver_count: 2,
      avg_minutes_per_driver: 150,
    });
    expect(report.by_day).toEqual([{ date: '2026-07-01', total_minutes: 300, shift_count: 2 }]);
    expect(report.by_driver[0]).toMatchObject({ name: 'Ali', total_minutes: 240 });
  });
});

describe('DriversService documents', () => {
  it('adds a driver document', async () => {
    const { service, prisma } = makeService();
    await service.addDocument('d1', { type: 'license', expires_at: '2027-01-01' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverDocument as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driverId: 'd1', type: 'license' }),
      }),
    );
  });

  it('lists driver documents', async () => {
    const { service } = makeService();
    const res = await service.listDocuments('d1');
    expect(res).toHaveLength(1);
    expect(res[0].type).toBe('license');
  });

  it('deletes a driver document', async () => {
    const { service, prisma } = makeService();
    await service.removeDocument('d1', 'ddoc1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.driverDocument as any).delete).toHaveBeenCalledWith({ where: { id: 'ddoc1' } });
  });

  it('flags a driver whose document is expiring soon', async () => {
    const { service, prisma } = makeService();
    const soon = new Date(Date.now() + 10 * 86_400_000);
    (prisma.driver.findUnique as jest.Mock).mockResolvedValueOnce({
      ...baseDriver(),
      documents: [{ expiresAt: soon }],
    });
    const res = await service.findOne('d1');
    expect(res.docs_expiry_alert).toBe('soon');
  });

  it('reads pickup and delivery pay from the action ledger', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { type: 'pickup_outside', _count: { _all: 2 }, _sum: { amount: 40 } },
      { type: 'delivery_city', _count: { _all: 1 }, _sum: { amount: 100 } },
    ]);
    const prisma = {
      driver: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'd1', vehicle: { category: 'katta' }, workLogs: [] }),
      },
      workLog: { findMany: jest.fn().mockResolvedValue([]) },
      vehicleTariff: {
        findUnique: jest.fn().mockResolvedValue({
          category: 'katta',
          dailyWageSom: 0,
          pickupCitySom: 10,
          pickupOutsideSom: 20,
          deliveryCitySom: 100,
          deliveryOutsideSom: 200,
        }),
      },
      morningStart: { aggregate: jest.fn().mockResolvedValue({ _sum: { earlyMinutes: null, amountSom: null } }) }, eveningOvertime: { aggregate: jest.fn().mockResolvedValue({ _sum: { minutes: null, amountSom: null } }) }, fine: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } }) },
      driverTariffEarning: { groupBy },
    };
    const realtime = { driverStatusChanged: jest.fn(), orderStatusChanged: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new DriversService(prisma as any, {} as any, realtime as any, {} as any);

    const res = await service.getMyEarnings('u1', 'month');
    const by = Object.fromEntries(res.lines.map((l) => [l.type, l]));
    expect(by.pickup_outside).toMatchObject({ count: 2, unit_price_som: 20, amount_som: 40 });
    expect(by.delivery_city).toMatchObject({ count: 1, unit_price_som: 100, amount_som: 100 });
    expect(res.total_som).toBe(140);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['type'],
        where: expect.objectContaining({ driverId: 'd1', earnedAt: expect.any(Object) }),
      }),
    );
  });

  it('uses the snapshotted ledger amount when the current tariff has changed', async () => {
    const prisma = {
      driver: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'd1', vehicle: { category: 'katta' }, workLogs: [] }),
      },
      workLog: { findMany: jest.fn().mockResolvedValue([]) },
      vehicleTariff: {
        findUnique: jest.fn().mockResolvedValue({
          category: 'katta',
          dailyWageSom: 0,
          pickupCitySom: 999,
          pickupOutsideSom: 0,
          deliveryCitySom: 0,
          deliveryOutsideSom: 0,
        }),
      },
      morningStart: { aggregate: jest.fn().mockResolvedValue({ _sum: { earlyMinutes: null, amountSom: null } }) }, eveningOvertime: { aggregate: jest.fn().mockResolvedValue({ _sum: { minutes: null, amountSom: null } }) }, fine: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } }) },
      driverTariffEarning: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ type: 'pickup_city', _count: { _all: 2 }, _sum: { amount: 25 } }]),
      },
    };
    const realtime = { driverStatusChanged: jest.fn(), orderStatusChanged: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new DriversService(prisma as any, {} as any, realtime as any, {} as any);

    const res = await service.getMyEarnings('u1', 'month');
    const pickup = res.lines.find((line) => line.type === 'pickup_city');
    expect(pickup).toMatchObject({ count: 2, unit_price_som: 13, amount_som: 25 });
    expect(res.total_som).toBe(25);
  });
});

describe('DriversService — the shift and orders from another day', () => {
  // 27.09 10:00 Tashkent.
  const NOW = new Date('2026-09-27T05:00:00Z');
  const tomorrowsBooking = { status: 'driver_accepted', bookingKind: 'bron', deliveryDatetime: new Date('2026-09-28T00:00:00Z') };
  const yesterdaysOrder = { status: 'driver_accepted', bookingKind: 'zanyat', deliveryDatetime: new Date('2026-09-26T06:00:00Z') };
  const todaysBooking = { status: 'driver_accepted', bookingKind: 'bron', deliveryDatetime: new Date('2026-09-27T00:00:00Z') };
  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  const statusWrites = (prisma: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((prisma.driver as any).update.mock.calls as { data: { currentStatus?: string } }[][]).map((c) => c[0].data.currentStatus);

  it("can end today's shift with a booking for tomorrow — it used to block, leaving shifts open for days", async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([tomorrowsBooking]);
    await expect(service.clockOut('u1')).resolves.toBeDefined();
    expect(statusWrites(prisma)).toEqual(['offline']);
  });

  it("with yesterday's order unfinished he is asked whether he'll deliver it today", async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([inHandOrder(yesterdaysOrder)]);
    await expect(service.clockOut('u1')).rejects.toThrow('driver_has_orders');
  });

  it("clocking in the next morning with yesterday's order open comes back busy, not Bo'sh", async () => {
    const { service, prisma } = makeService({ openShift: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([yesterdaysOrder]);
    await service.clockIn('u1');
    expect(statusWrites(prisma)).toEqual(['busy']);
  });

  it('a driver on shift when his booking opens at 03:00 turns busy with the sweep', async () => {
    const { service, prisma } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.driver as any).findMany.mockResolvedValue([{ id: 'd1' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.driver as any).findUnique.mockResolvedValue({ currentStatus: 'available' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([todaysBooking]);
    expect(await service.settleOpenedBookings()).toBe(1);
    expect(statusWrites(prisma)).toEqual(['busy']);
  });

  it('the sweep leaves a driver alone whose booking is for tomorrow', async () => {
    const { service, prisma } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.driver as any).findMany.mockResolvedValue([{ id: 'd1' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.driver as any).findUnique.mockResolvedValue({ currentStatus: 'available' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([tomorrowsBooking]);
    expect(await service.settleOpenedBookings()).toBe(0);
    expect(statusWrites(prisma)).toEqual([]);
  });
});

describe('DriversService — answering the end-of-day reminder', () => {
  const logWrites = (prisma: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((prisma.workLog as any).updateMany.mock.calls as { data: Record<string, unknown> }[][]).map((c) => c[0].data);

  it('the toggle records the shift as ended by the driver', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
    await service.clockOut('u1');
    expect(logWrites(prisma)[0]).toMatchObject({ closeSource: 'driver' });
    expect(logWrites(prisma)[0]).not.toHaveProperty('endCheckAnsweredAt');
  });

  it('STOP ends the shift, as his answer to the reminder', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
    await service.stopShift('u1');
    expect(logWrites(prisma)[0]).toMatchObject({ closeSource: 'end_check_stop', endCheckAnsweredAt: expect.any(Date) });
  });

  it('STOP with an order in hand asks the same question as the toggle', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' }, activeOrders: 1 });
    // No return being carried — just the order in hand.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).count.mockResolvedValue(0);
    await expect(service.stopShift('u1')).rejects.toThrow('driver_has_orders');
  });

  it('"+30 min" starts the count over, asks again in 30 minutes, and keeps his note with its time (owner, 07.11.2026)', async () => {
    const earlier = { at: '2026-09-26T13:00:00.000Z', note: 'Chilonzorda yuk tushiryapman' };
    const { service, prisma } = makeService({ openShift: { id: 'wl1', endCheckNotes: [earlier] } });
    await service.extendShift('u1', { note: '  Sergelida mijoz kutyapti  ' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (prisma.workLog as any).updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'wl1', clockOutAt: null });
    expect(call.data).toMatchObject({ endCheckUnanswered: 0, endCheckAnsweredAt: expect.any(Date), endCheckRanAt: expect.any(Date) });
    expect(call.data.endCheckNotes).toEqual([earlier, { at: (call.data.endCheckAnsweredAt as Date).toISOString(), note: 'Sergelida mijoz kutyapti' }]);
  });

  // Off while the note field is held back in the app (09.11.2026).
  it.skip('"+30 min" without saying what work he is on is refused (owner, 07.11.2026)', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
    await expect(service.extendShift('u1')).rejects.toThrow('end_check_note_required');
    await expect(service.extendShift('u1', { note: '   ' })).rejects.toThrow('end_check_note_required');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).updateMany).not.toHaveBeenCalled();
  });

  it('"+30 min" with no shift open is refused', async () => {
    const { service } = makeService({ openShift: null });
    await expect(service.extendShift('u1', { note: 'yuk' })).rejects.toThrow('no_open_shift');
  });

  it("the app sees a reminder waiting for his answer on /drivers/me", async () => {
    const { service, prisma } = makeService();
    const asked = new Date('2026-09-26T13:30:00Z'); // 18:30, the first ask
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.driver as any).findUnique.mockResolvedValue({
      ...baseDriver(),
      workLogs: [{ id: 'wl1', clockInAt: new Date('2026-09-26T04:00:00Z'), expectedEnd: '18:00', endCheckRanAt: asked, endCheckSentAt: asked, endCheckAnsweredAt: null, endCheckUnanswered: 0, endCheckZone: 'tashkent' }],
    });
    const me = await service.findByUserId('u1');
    expect(me.shift_end_check).toEqual({ awaiting_answer: true, asked_at: asked.toISOString(), unanswered: 0, zone: 'tashkent', shift_end: '18:00', closes_at: null });
  });

  it('on the last ask (19:00) the app is told when the shift closes by itself (owner, 10.11.2026)', async () => {
    const { service, prisma } = makeService();
    const asked = new Date('2026-09-26T14:00:00Z');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.driver as any).findUnique.mockResolvedValue({
      ...baseDriver(),
      workLogs: [{ id: 'wl1', clockInAt: new Date('2026-09-26T04:00:00Z'), expectedEnd: '18:00', endCheckRanAt: asked, endCheckSentAt: asked, endCheckAnsweredAt: null, endCheckUnanswered: 1, endCheckZone: 'tashkent' }],
    });
    const me = await service.findByUserId('u1');
    expect(me.shift_end_check?.closes_at).toBe('2026-09-26T14:10:00.000Z');
  });

  it('the office sees each "+30" note on the shift (owner, 07.11.2026)', async () => {
    const { service, prisma } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.workLog as any).findMany.mockResolvedValue([
      {
        id: 'wl1', driverId: 'd1', clockInAt: new Date('2026-09-26T04:00:00Z'), clockOutAt: new Date('2026-09-26T13:30:00Z'),
        breakMinutes: 0, carryOvers: [], closeSource: 'auto_no_answer',
        endCheckNotes: [{ at: '2026-09-26T13:00:00.000Z', note: 'Chilonzorda yuk tushiryapman' }, { bad: true }],
      },
    ]);
    const logs = await service.listMyWorkLogs('u1');
    expect(logs[0].end_check_notes).toEqual([{ at: '2026-09-26T13:00:00.000Z', note: 'Chilonzorda yuk tushiryapman' }]);
  });
});

describe('DriversService — ending a shift with an order in hand ("not today")', () => {
  const NOON = new Date('2026-09-26T07:00:00Z'); // 12:00 Tashkent, before an 18:00 end
  beforeEach(() => jest.useFakeTimers({ now: NOON, doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  it('the first press answers with the orders, so the app can ask "will you deliver today?"', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' }, early: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([inHandOrder()]);
    await expect(service.clockOut('u1')).rejects.toMatchObject({
      response: { message: 'driver_has_orders', orders: [{ id: 'o1', order_number: 42, status: 'on_the_way', client_name: 'Barakat' }] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workLog as any).updateMany).not.toHaveBeenCalled();
  });

  it('"not today" with a reason ends the shift, records each order, and the reason also explains leaving early', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' }, early: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([inHandOrder(), inHandOrder({ id: 'o2', orderNumber: 43, createdBySellerId: 's2' })]);
    await service.clockOut('u1', { carry_over: { reason: 'customer_not_ready', comment: 'Ertaga 10:00 da' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderCarryOver as any).createMany).toHaveBeenCalledWith({
      data: [
        { orderId: 'o1', driverId: 'd1', workLogId: 'wl1', reason: 'customer_not_ready', comment: 'Ertaga 10:00 da' },
        { orderId: 'o2', driverId: 'd1', workLogId: 'wl1', reason: 'customer_not_ready', comment: 'Ertaga 10:00 da' },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const written = (prisma.workLog as any).updateMany.mock.calls[0][0].data;
    expect(written).toMatchObject({ isEarlyLeave: true, earlyLeaveReason: 'Mijoz bugun qabul qila olmaydi. Ertaga 10:00 da' });
  });

  it("each order's seller and staff are told it won't arrive today, and why", async () => {
    const { service, prisma, notifications } = makeService({ openShift: { id: 'wl1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([inHandOrder({ createdBySellerId: 's1' })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user as any).findMany = jest.fn().mockResolvedValue([{ id: 'admin1' }, { id: 's1' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.driver as any).findUnique.mockResolvedValue({ ...baseDriver(), user: { name: 'Bahodir' } });
    await service.clockOut('u1', { carry_over: { reason: 'vehicle_problem' } });
    expect(notifications.notifyMany).toHaveBeenCalledWith(['s1', 'admin1'], {
      type: 'order.carried_over',
      title: 'Buyurtma bugun yetkazilmaydi',
      body: 'Barakat buyurtmasi bugun yetkazilmaydi — Bahodir: Mashina nosoz. Ertaga yetkaziladi.',
      relatedOrderId: 'o1',
      clientName: 'Barakat',
    });
  });

  it('a notice that fails does not undo the clock-out', async () => {
    const { service, prisma, notifications } = makeService({ openShift: { id: 'wl1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([inHandOrder()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user as any).findMany = jest.fn().mockResolvedValue([]);
    notifications.notifyMany.mockRejectedValue(new Error('push down'));
    await expect(service.clockOut('u1', { carry_over: { reason: 'out_of_time' } })).resolves.toBeDefined();
  });

  it('with nothing in hand a carry-over is ignored — nothing recorded, nobody told', async () => {
    const { service, prisma, notifications } = makeService({ openShift: { id: 'wl1' } });
    await service.clockOut('u1', { carry_over: { reason: 'out_of_time' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderCarryOver as any).createMany).not.toHaveBeenCalled();
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });
});

describe('DriversService.getShiftAlerts', () => {
  const now = new Date('2026-09-26T08:00:00Z');
  const who = { driver: { user: { name: 'Bahodir' } } };

  it('lists Viloyat shifts, system-closed shifts and undelivered carry-overs', async () => {
    const { service, prisma } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findMany = (prisma.workLog as any).findMany as jest.Mock;
    findMany
      .mockResolvedValueOnce([
        { id: 'wl1', driverId: 'd1', clockInAt: new Date('2026-09-25T04:00:00Z'), endCheckRanAt: new Date('2026-09-25T13:10:00Z'), ...who },
      ])
      .mockResolvedValueOnce([
        {
          id: 'wl2',
          driverId: 'd1',
          clockInAt: new Date('2026-09-25T04:00:00Z'),
          clockOutAt: new Date('2026-09-25T12:40:00Z'),
          closeSource: 'auto_no_answer',
          ...who,
        },
      ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.orderCarryOver as any).findMany = jest.fn().mockResolvedValue([
      { driverId: 'd1', orderId: 'o1', reason: 'out_of_time', comment: null, createdAt: new Date('2026-09-25T13:00:00Z'), order: { orderNumber: 42 }, ...who },
    ]);

    const alerts = await service.getShiftAlerts(now);
    expect(findMany.mock.calls[0][0].where).toEqual({ clockOutAt: null, endCheckZone: 'viloyat' });
    expect(findMany.mock.calls[1][0].where).toEqual({ autoClosed: true, correctedAt: null, clockOutAt: { gte: new Date('2026-09-25T08:00:00Z') } });
    expect(alerts.viloyat).toEqual([
      { driver_id: 'd1', name: 'Bahodir', work_log_id: 'wl1', clock_in_at: '2026-09-25T04:00:00.000Z', checked_at: '2026-09-25T13:10:00.000Z' },
    ]);
    expect(alerts.auto_closed[0]).toMatchObject({ work_log_id: 'wl2', close_source: 'auto_no_answer', clock_out_at: '2026-09-25T12:40:00.000Z' });
    expect(alerts.carried_over).toEqual([
      { driver_id: 'd1', name: 'Bahodir', order_id: 'o1', order_number: 42, reason: 'out_of_time', comment: null, at: '2026-09-25T13:00:00.000Z' },
    ]);
  });
});

describe('DriversService — shift rules', () => {
  const HOUR = 3_600_000;

  it('clocking out after midnight is not early: judged against the day the shift began', async () => {
    const { service, prisma } = makeService({
      openShift: { id: 'wl1', clockInAt: new Date(Date.now() - 30 * HOUR), expectedEnd: '23:59' },
    });
    await service.clockOut('u1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (prisma.workLog as any).updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ isEarlyLeave: false, earlyMinutes: 0, earlyLeaveReason: null });
    // The snapshot taken at clock-in is not overwritten with another day's.
    expect(data).not.toHaveProperty('expectedEnd');
  });

  it('a second clock-in racing the first is refused by the one-open-shift index', async () => {
    const { service, prisma } = makeService({ openShift: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.workLog as any).create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.clockIn('u1')).rejects.toThrow('shift_already_open');
  });

  describe('breaks', () => {
    it('cannot start off shift', async () => {
      const { service } = makeService({ openShift: null });
      await expect(service.startBreak('u1', 1)).rejects.toThrow('no_open_shift');
    });

    it('cannot start in the middle of a delivery', async () => {
      const { service } = makeService({ openShift: { id: 'wl1' }, activeOrders: 1 });
      await expect(service.startBreak('u1', 1)).rejects.toThrow('driver_busy_finish_delivery');
    });

    it('records when it began and until when', async () => {
      const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
      await service.startBreak('u1', 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (prisma.driver as any).update.mock.calls[0][0].data;
      expect(data.breakStartedAt).toBeInstanceOf(Date);
      expect(data.breakUntil.getTime() - data.breakStartedAt.getTime()).toBe(HOUR);
    });

    it('ending it adds the time taken to the shift', async () => {
      const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.driver as any).findUnique.mockResolvedValue({
        ...baseDriver(),
        breakStartedAt: new Date(Date.now() - 20 * 60_000),
        breakUntil: new Date(Date.now() + 40 * 60_000),
      });
      await service.endBreak('u1');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.workLog as any).updateMany).toHaveBeenCalledWith({
        where: { driverId: 'd1', clockOutAt: null },
        data: { breakMinutes: { increment: 20 } },
      });
    });

    it('clock-out ends a running break and counts it', async () => {
      const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.driver as any).findUnique.mockResolvedValue({
        ...baseDriver(),
        breakStartedAt: new Date(Date.now() - 30 * 60_000),
        breakUntil: new Date(Date.now() + 30 * 60_000),
      });
      await service.clockOut('u1');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.workLog as any).updateMany.mock.calls[0][0].data.breakMinutes).toEqual({ increment: 30 });
    });
  });

  describe('staff correcting a shift', () => {
    // A fixed day mid-period: on the 16th after 12:00 "yesterday" is in a locked pay period.
    const FIXED = new Date('2026-11-07T07:00:00Z');
    beforeEach(() => jest.useFakeTimers({ now: FIXED, doNotFake: ['nextTick', 'setImmediate'] }));
    afterEach(() => jest.useRealTimers());
    const actor = { userId: 'admin1' };
    const yesterday9 = new Date(FIXED.getTime() - 26 * HOUR);
    const snapshot = { expectedStart: '09:00', expectedEnd: '18:00' };

    function withLog(log: Record<string, unknown>, other: Record<string, unknown> | null = null) {
      const made = makeService();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wl = made.prisma.workLog as any;
      wl.findFirst = jest.fn().mockImplementation(({ where }: { where: { id?: unknown } }) =>
        Promise.resolve(where.id === 'wl1' ? { id: 'wl1', driverId: 'd1', ...snapshot, ...log } : other),
      );
      wl.update = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'wl1', driverId: 'd1', breakMinutes: 0, carryOvers: [], ...log, ...data }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (made.prisma.driver as any).findUniqueOrThrow = jest.fn().mockResolvedValue(baseDriver());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (made.prisma.user as any).findUnique = jest.fn().mockResolvedValue({ name: 'Admin' });
      return made;
    }

    it('leaves a driver on duty when the shift being closed is not the one he is on', async () => {
      const { service, prisma } = withLog({ clockInAt: yesterday9, clockOutAt: null });
      // He clocked in again today; that shift is still open.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.workLog as any).count = jest
        .fn()
        .mockImplementation(({ where }: { where?: { clockOutAt?: unknown } }) =>
          Promise.resolve('clockOutAt' in (where ?? {}) ? 1 : 0),
        );
      const out = new Date(yesterday9.getTime() + 9 * HOUR);
      await service.correctWorkLog('d1', 'wl1', { clock_out_at: out.toISOString(), note: 'Unutgan' }, actor);
      expect(prisma.driver.update).not.toHaveBeenCalled();
    });

    it('closes a forgotten shift, records who and why, and takes the driver off shift', async () => {
      const { service, prisma } = withLog({ clockInAt: yesterday9, clockOutAt: null });
      const out = new Date(yesterday9.getTime() + 9 * HOUR);
      const res = await service.correctWorkLog('d1', 'wl1', { clock_out_at: out.toISOString(), note: 'Unutgan' }, actor);
      expect(res).toMatchObject({ clock_out_at: out.toISOString(), corrected_by_name: 'Admin', correction_note: 'Unutgan' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((prisma.workLog as any).update.mock.calls[0][0].data).toMatchObject({ closeSource: 'admin', correctedById: 'admin1' });
      expect(prisma.driver.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { currentStatus: 'offline', breakUntil: null, breakStartedAt: null, breakReason: null },
      });
    });

    it('refuses an end before the start, or a time in the future', async () => {
      const { service } = withLog({ clockInAt: yesterday9, clockOutAt: null });
      const before = new Date(yesterday9.getTime() - HOUR).toISOString();
      const future = new Date(Date.now() + HOUR).toISOString();
      await expect(service.correctWorkLog('d1', 'wl1', { clock_out_at: before, note: 'x' }, actor)).rejects.toThrow(
        'shift_end_before_start',
      );
      await expect(service.correctWorkLog('d1', 'wl1', { clock_out_at: future, note: 'x' }, actor)).rejects.toThrow(
        'shift_time_in_future',
      );
    });

    it('refuses times that run into another of his shifts', async () => {
      const { service } = withLog({ clockInAt: yesterday9, clockOutAt: null }, { id: 'wl2' });
      const out = new Date(yesterday9.getTime() + HOUR).toISOString();
      await expect(service.correctWorkLog('d1', 'wl1', { clock_out_at: out, note: 'x' }, actor)).rejects.toThrow(
        'shift_overlaps_another',
      );
    });

    it("a shift that is not this driver's is not found", async () => {
      const { service } = withLog({ clockInAt: yesterday9, clockOutAt: null });
      await expect(
        service.correctWorkLog('d1', 'nope', { clock_out_at: new Date().toISOString(), note: 'x' }, actor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('the work report uses Tashkent days and splits a shift over midnight', async () => {
    const { service, prisma } = makeService();
    const tas = (hhmm: string, day: string) => new Date(`${day}T${hhmm}:00.000+05:00`);
    const who = { driver: { user: { name: 'Bahodir' } } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.workLog as any).findMany.mockResolvedValue([
      { driverId: 'd1', clockInAt: tas('20:00', '2026-09-24'), clockOutAt: tas('02:00', '2026-09-25'), breakMinutes: 0, ...who },
      // 03:00 Tashkent — on the UTC calendar this was still the 24th.
      { driverId: 'd1', clockInAt: tas('03:00', '2026-09-25'), clockOutAt: tas('05:00', '2026-09-25'), breakMinutes: 0, ...who },
    ]);
    const report = await service.getWorkReport({ from: '2026-09-25', to: '2026-09-25' });
    // 2 h after midnight + the 2 h shift; the evening before is outside the range.
    expect(report.by_driver).toEqual([
      { driver_id: 'd1', name: 'Bahodir', days_worked: 1, total_minutes: 240, shift_count: 1 },
    ]);
    expect(report.by_day).toEqual([{ date: '2026-09-25', total_minutes: 240, shift_count: 1 }]);
  });
});

describe('DriversService.getMyEarnings — only what the office shows', () => {
  function make() {
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', vehicle: { category: 'orta' }, workLogs: [{ clockInAt: new Date() }] }) },
      vehicleTariff: {
        findUnique: jest.fn().mockResolvedValue({
          category: 'orta',
          dailyWageSom: 200_000,
          pickupCitySom: 20_000,
          pickupOutsideSom: 40_000,
          deliveryCitySom: 20_000,
          deliveryOutsideSom: 40_000,
          earlyHourSom: 70_000,
        }),
      },
      driverTariffEarning: { groupBy: jest.fn().mockResolvedValue([{ type: 'pickup_city', _count: { _all: 1 }, _sum: { amount: 20_000 } }]) },
      morningStart: { aggregate: jest.fn().mockResolvedValue({ _sum: { earlyMinutes: 30, amountSom: 35_000 } }) },
      eveningOvertime: { aggregate: jest.fn().mockResolvedValue({ _sum: { minutes: 60, amountSom: 70_000 } }) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { prisma, svc: new DriversService(prisma as any, {} as any, {} as any, {} as any, {} as any) };
  }

  it('has the bonuses and the extra hours; no daily wage, viloyat km or fine, in lines or total', async () => {
    const res = await make().svc.getMyEarnings('u1', 'month');
    expect(res.lines.map((l) => l.type)).toEqual([
      'pickup_city',
      'pickup_outside',
      'delivery_city',
      'delivery_outside',
      'early_start',
      'evening_overtime',
    ]);
    expect(res.total_som).toBe(20_000 + 35_000 + 70_000);
  });

  it('counts the month from the 16th to the 15th, in Tashkent', () => {
    const iso = (d: Date) => d.toISOString();
    // 15 Nov, 23:30 in Tashkent: still the period begun on 16 Oct.
    expect(iso(bonusPeriodRange(new Date('2026-11-15T18:30:00Z')).from)).toBe('2026-10-15T19:00:00.000Z');
    // 16 Nov, 00:30 in Tashkent: the new one, to 16 Dec.
    const next = bonusPeriodRange(new Date('2026-11-15T19:30:00Z'));
    expect(iso(next.from)).toBe('2026-11-15T19:00:00.000Z');
    expect(iso(next.to)).toBe('2026-12-15T19:00:00.000Z');
    // Across the new year, both ways.
    expect(iso(bonusPeriodRange(new Date('2027-01-05T06:00:00Z')).from)).toBe('2026-12-15T19:00:00.000Z');
    expect(iso(bonusPeriodRange(new Date('2026-12-20T06:00:00Z')).to)).toBe('2027-01-15T19:00:00.000Z');
  });
});

describe('DriversService.findAllLocations', () => {
  it('names the lorry beside each pin, and none for a driver without one', async () => {
    const prisma = {
      driver: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'd1', currentStatus: 'available', locationLat: 41.3, locationLng: 69.2, locationUpdatedAt: new Date(),
            user: { name: 'Ergashev Ali', status: 'active' },
            vehicle: { plateNumber: '01 X 222 XX', model: 'GAZelle NEXT 4.20 metr' },
          },
          {
            id: 'd2', currentStatus: 'offline', locationLat: null, locationLng: null, locationUpdatedAt: null,
            user: { name: 'Miraziz', status: 'active' }, vehicle: null,
          },
        ]),
      },
      fuelStation: { findMany: jest.fn().mockResolvedValue([]) },
      // Newest first: d1 drove north-east from (41.300, 69.200) to (41.301, 69.201).
      driverLocationPing: {
        findMany: jest.fn().mockResolvedValue([
          { driverId: 'd1', lat: 41.301, lng: 69.201 },
          { driverId: 'd1', lat: 41.3, lng: 69.2 },
        ]),
      },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new DriversService(prisma as any, {} as any, {} as any, {} as any);

    const res = await service.findAllLocations();
    expect(res[0]!.heading).toBeGreaterThan(30);
    expect(res[0]!.heading).toBeLessThan(45);
    expect(res[1]!.heading).toBeNull();

    expect(res[0]).toMatchObject({ name: 'Ergashev Ali', vehicle_plate: '01 X 222 XX', vehicle_model: 'GAZelle NEXT 4.20 metr' });
    expect(res[1]).toMatchObject({ vehicle_plate: null, vehicle_model: null, lat: null });
    expect(prisma.driver.findMany.mock.calls[0][0].include.vehicle).toEqual({ select: { plateNumber: true, model: true } });
  });
});

describe('bearingDegrees', () => {
  it('reads north, east, south and west', () => {
    const at = { lat: 41.3, lng: 69.2 };
    expect(bearingDegrees(at, { lat: 41.31, lng: 69.2 })).toBe(0);
    expect(bearingDegrees(at, { lat: 41.3, lng: 69.21 })).toBe(90);
    expect(bearingDegrees(at, { lat: 41.29, lng: 69.2 })).toBe(180);
    expect(bearingDegrees(at, { lat: 41.3, lng: 69.19 })).toBe(270);
  });
});

describe('the lorry faces where it has to go', () => {
  const stop = (over: Record<string, unknown> = {}) => ({
    position: 0, legStatus: 'pending', lat: 41.33, lng: 69.25, returnRequired: false, returnedAt: null, ...over,
  });

  it('before loading: the first pickup not reached; after: the client', () => {
    const order = { deliveryLat: 41.36, deliveryLng: 69.29, pickupSources: [stop({ legStatus: 'arrived' }), stop({ position: 1, lat: 41.2 })] };
    expect(nextTarget({ ...order, status: 'assigned_to_driver' })).toEqual({ lat: 41.2, lng: 69.25 });
    expect(nextTarget({ ...order, status: 'on_the_way' })).toEqual({ lat: 41.36, lng: 69.29 });
    expect(nextTarget({ ...order, status: 'returning', pickupSources: [stop({ returnRequired: true })] })).toEqual({ lat: 41.33, lng: 69.25 });
  });

  it('turns his nose to his next stop rather than the way he last drove', async () => {
    const prisma = {
      driver: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'd1', currentStatus: 'busy', locationLat: 41.3, locationLng: 69.2, locationUpdatedAt: new Date(), user: { name: 'A', status: 'active' }, vehicle: null },
        ]),
      },
      fuelStation: { findMany: jest.fn().mockResolvedValue([]) },
      // He last drove north…
      driverLocationPing: { findMany: jest.fn().mockResolvedValue([{ driverId: 'd1', lat: 41.3, lng: 69.2 }, { driverId: 'd1', lat: 41.29, lng: 69.2 }]) },
      // …but his client is due east.
      order: { findMany: jest.fn().mockResolvedValue([{ assignedDriverId: 'd1', status: 'on_the_way', deliveryLat: 41.3, deliveryLng: 69.3, pickupSources: [] }]) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new DriversService(prisma as any, {} as any, {} as any, {} as any);
    const [d] = await service.findAllLocations();
    expect(d!.heading).toBeGreaterThan(85);
    expect(d!.heading).toBeLessThan(95);
  });
});

describe('DriversService.updateLocation — the answer to the background service', () => {
  const make = (open: number) => {
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue({ id: 'd1' }), update: jest.fn().mockResolvedValue({}) },
      driverLocationPing: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      workLog: { count: jest.fn().mockResolvedValue(open) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new DriversService(prisma as any, {} as any, {} as any, {} as any);
    jest.spyOn(svc, 'gpsWindows').mockResolvedValue({ gps_required: null, gps_only: null });
    return svc;
  };

  it('says whether the shift is still open, so the phone can stop itself', async () => {
    expect(await make(1).updateLocation('u1', { lat: 41.3, lng: 69.2 })).toEqual({ on_shift: true, gps_required: null, gps_only: null });
    expect(await make(0).updateLocation('u1', { lat: 41.3, lng: 69.2 })).toEqual({ on_shift: false, gps_required: null, gps_only: null });
  });
});

describe('DriversService.updateLocationBatch — fixes kept without internet (owner, 04.11.2026)', () => {
  const make = (lastAt: Date | null) => {
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', locationUpdatedAt: lastAt }), update: jest.fn().mockResolvedValue({}) },
      driverLocationPing: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      workLog: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new DriversService(prisma as any, {} as any, {} as any, {} as any);
    jest.spyOn(svc, 'gpsWindows').mockResolvedValue({ gps_required: null, gps_only: null });
    return { svc, prisma };
  };
  const ago = (min: number) => new Date(Date.now() - min * 60_000);

  it('each fix goes on the trail at the moment it was taken; the newest moves the lorry', async () => {
    const { svc, prisma } = make(ago(60));
    const res = await svc.updateLocationBatch('u1', {
      points: [
        { lat: 41.0, lng: 69.0, recorded_at: ago(30).toISOString() },
        { lat: 41.3, lng: 69.2, recorded_at: ago(10).toISOString() },
      ],
    });
    expect(res).toEqual({ on_shift: true, kept: 2, gps_required: null, gps_only: null, break_until: null });
    const rows = prisma.driverLocationPing.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { lat: number }) => r.lat)).toEqual([41.0, 41.3]);
    expect(prisma.driver.update.mock.calls[0][0].data).toMatchObject({ locationLat: 41.3 });
  });

  it('older than what we have: on the trail, but the lorry stays where the live fix put it', async () => {
    const { svc, prisma } = make(ago(1));
    await svc.updateLocationBatch('u1', { points: [{ lat: 41.0, lng: 69.0, recorded_at: ago(30).toISOString() }] });
    expect(prisma.driverLocationPing.createMany).toHaveBeenCalled();
    expect(prisma.driver.update).not.toHaveBeenCalled();
  });

  it('times older than two days are dropped', async () => {
    const { svc, prisma } = make(null);
    const res = await svc.updateLocationBatch('u1', { points: [{ lat: 41.0, lng: 69.0, recorded_at: ago(3 * 24 * 60).toISOString() }] });
    expect(res.kept).toBe(0);
    expect(prisma.driverLocationPing.createMany).not.toHaveBeenCalled();
  });

  it('one bad point is left out, the rest are kept (owner, 06.11.2026)', async () => {
    const pipe = new ZodValidationPipe(driverLocationBatchSchema);
    const good = [
      { lat: 41.0, lng: 69.0, recorded_at: ago(30).toISOString() },
      { lat: 41.3, lng: 69.2, recorded_at: ago(10).toISOString() },
    ];
    const body = pipe.transform({
      points: [good[0], { lat: 123, lng: 69.1, recorded_at: ago(20).toISOString() }, { lat: 41.1, lng: 69.1, recorded_at: 'yesterday' }, null, good[1]],
    }) as { points: typeof good };
    expect(body.points).toEqual(good);
    const { svc } = make(ago(60));
    expect((await svc.updateLocationBatch('u1', body)).kept).toBe(2);
  });

  it('a list of only bad points is taken (nothing kept), not refused', async () => {
    const pipe = new ZodValidationPipe(driverLocationBatchSchema);
    const body = pipe.transform({ points: [{ lat: 'x' }] }) as { points: unknown[] };
    expect(body.points).toEqual([]);
    const { svc, prisma } = make(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await svc.updateLocationBatch('u1', body as any)).kept).toBe(0);
    expect(prisma.driver.update).not.toHaveBeenCalled();
  });

  it('a body that is not a list of points is still refused', () => {
    const pipe = new ZodValidationPipe(driverLocationBatchSchema);
    expect(() => pipe.transform({ points: [] })).toThrow(BadRequestException);
    expect(() => pipe.transform({ points: 'x' })).toThrow(BadRequestException);
  });
});

describe("the phone's own location service, by its key (owner, 05.11.2026)", () => {
  const make = (driverRow: unknown) => {
    const prisma = {
      driver: {
        findUnique: jest.fn().mockResolvedValue(driverRow),
        update: jest.fn().mockResolvedValue({}),
      },
      driverLocationPing: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      workLog: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new DriversService(prisma as any, {} as any, {} as any, {} as any);
    jest.spyOn(svc, 'gpsWindows').mockResolvedValue({ gps_required: null, gps_only: null });
    return { svc, prisma };
  };
  const point = { lat: 41.3, lng: 69.2, recorded_at: new Date(Date.now() - 60_000).toISOString() };

  it('a key is issued, and only its hash is kept', async () => {
    const { svc, prisma } = make({ id: 'd1' });
    const { key } = await svc.issueLocationKey('u1');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.driver.update.mock.calls[0][0].data.locationKeyHash).toBe(hashLocationKey(key));
    expect(prisma.driver.update.mock.calls[0][0].data.locationKeyHash).not.toBe(key);
  });

  it("positions sent with the key go on the driver's trail", async () => {
    const { svc, prisma } = make({ id: 'd1', locationUpdatedAt: null, user: { status: 'active' } });
    const res = await svc.ingestLocationByKey('a'.repeat(64), { points: [point] });
    expect(prisma.driver.findUnique.mock.calls[0][0].where).toEqual({ locationKeyHash: hashLocationKey('a'.repeat(64)) });
    expect(res).toMatchObject({ on_shift: true, kept: 1 });
  });

  it('no key, a wrong key, or a driver no longer active: refused', async () => {
    await expect(make(null).svc.ingestLocationByKey(undefined, { points: [point] })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(make(null).svc.ingestLocationByKey('b'.repeat(64), { points: [point] })).rejects.toBeInstanceOf(UnauthorizedException);
    const gone = make({ id: 'd1', locationUpdatedAt: null, user: { status: 'inactive' } });
    await expect(gone.svc.ingestLocationByKey('a'.repeat(64), { points: [point] })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('late positions reopen the evening extra of a closed shift (owner, 05.11.2026)', () => {
  it('a shift closed at 03:00 whose way back arrives in the morning is worked out again', async () => {
    const t = (iso: string) => new Date(iso);
    const log = {
      id: 'wl1', clockInAt: t('2026-11-04T04:00:00Z'), clockOutAt: t('2026-11-04T14:00:00Z'),
      closeSource: 'auto_stale', endCheckRanAt: t('2026-11-04T22:00:00Z'),
    };
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', locationUpdatedAt: null }), update: jest.fn() },
      driverLocationPing: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      workLog: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([log]), update: jest.fn() },
      eveningOvertime: { deleteMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new DriversService(prisma as any, {} as any, {} as any, {} as any);
    jest.spyOn(svc, 'gpsWindows').mockResolvedValue({ gps_required: null, gps_only: null });
    // The border crossing at 20:30 Tashkent (15:30 UTC), after the 19:00 photo, sent the next morning.
    jest.useFakeTimers().setSystemTime(t('2026-11-05T03:00:00Z'));
    await svc.updateLocationBatch('u1', { points: [{ lat: 41.3, lng: 69.2, recorded_at: '2026-11-04T15:30:00.000Z' }] });
    jest.useRealTimers();
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.workLog.update).toHaveBeenCalledWith({ where: { id: 'wl1' }, data: { eveningCheckedAt: null } });
    expect(prisma.eveningOvertime.deleteMany).toHaveBeenCalledWith({ where: { workLogId: 'wl1' } });
  });
});

describe('pay period lock: late positions (owner, 07.11.2026)', () => {
  afterEach(() => jest.useRealTimers());
  // A shift on 15.10, 09:00–19:00 Tashkent; its way back sent the next morning.
  const log = {
    id: 'wl1', clockInAt: new Date('2026-10-15T04:00:00Z'), clockOutAt: new Date('2026-10-15T14:00:00Z'),
    closeSource: 'auto_stale', endCheckRanAt: new Date('2026-10-15T22:00:00Z'),
  };
  async function sendAt(now: string) {
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', locationUpdatedAt: null }), update: jest.fn() },
      driverLocationPing: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      workLog: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([log]), update: jest.fn() },
      eveningOvertime: { deleteMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new DriversService(prisma as any, {} as any, {} as any, {} as any);
    jest.spyOn(svc, 'gpsWindows').mockResolvedValue({ gps_required: null, gps_only: null });
    jest.useFakeTimers().setSystemTime(new Date(now));
    await svc.updateLocationBatch('u1', { points: [{ lat: 41.3, lng: 69.2, recorded_at: '2026-10-15T15:30:00.000Z' }] });
    jest.useRealTimers();
    return prisma;
  }

  it('sent on the 16th at 12:00, once 16.09–15.10 is locked: the evening extra stays', async () => {
    const prisma = await sendAt('2026-10-16T07:00:00Z');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.eveningOvertime.deleteMany).not.toHaveBeenCalled();
  });

  it('sent on the 16th at 11:59: worked out again as before', async () => {
    const prisma = await sendAt('2026-10-16T06:59:00Z');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.eveningOvertime.deleteMany).toHaveBeenCalledWith({ where: { workLogId: 'wl1' } });
  });
});

describe('motionFrom — speed and standing, from the fixes', () => {
  const now = new Date('2026-11-02T06:00:00Z');
  const was = (secAgo: number, anchor = true) => ({
    locationLat: 41.3,
    locationLng: 69.2,
    locationUpdatedAt: new Date(now.getTime() - secAgo * 1000),
    anchorLat: anchor ? 41.3 : null,
    anchorLng: anchor ? 69.2 : null,
  });
  // 0.001 degree of latitude is about 110 m.
  const moved = { lat: 41.301, lng: 69.2 };

  it('reads the speed from two fixes', () => {
    expect(motionFrom(was(20), moved, now).locationSpeedKmh).toBe(20);
  });

  it('calls under 15 m standing, and says nothing when the fixes are too far apart', () => {
    expect(motionFrom(was(20), { lat: 41.3001, lng: 69.2 }, now).locationSpeedKmh).toBe(0);
    expect(motionFrom(was(600), moved, now).locationSpeedKmh).toBeNull();
    expect(motionFrom(was(2), moved, now).locationSpeedKmh).toBeNull();
  });

  it('throws out an impossible jump', () => {
    expect(motionFrom(was(5), { lat: 41.31, lng: 69.2 }, now).locationSpeedKmh).toBeNull();
  });

  it('moves the standing point only past 50 m, keeping the time he stopped', () => {
    expect(motionFrom(was(20), moved, now)).toMatchObject({ anchorLat: 41.301, movedAt: now });
    expect(motionFrom(was(20), { lat: 41.3001, lng: 69.2 }, now).movedAt).toBeUndefined();
    expect(motionFrom(was(20, false), { lat: 41.3001, lng: 69.2 }, now).movedAt).toEqual(now);
  });
});

describe('clockSkewMs — a phone clock set wrong by hand (owner, 06.11.2026)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { clockSkewMs } = require('./drivers.service') as typeof import('./drivers.service');
  const now = new Date('2026-11-06T12:00:00Z');
  it('an hour behind moves every point an hour forward', () => {
    expect(clockSkewMs('2026-11-06T11:00:00Z', now)).toBe(3_600_000);
  });
  it('an hour ahead moves them back', () => {
    expect(clockSkewMs('2026-11-06T13:00:00Z', now)).toBe(-3_600_000);
  });
  it('under two minutes, or no clock sent, is left alone', () => {
    expect(clockSkewMs('2026-11-06T11:59:10Z', now)).toBe(0);
    expect(clockSkewMs(undefined, now)).toBe(0);
  });
});

describe('reopening a closed shift: only the same day or the night after it (audit, 07.11.2026)', () => {
  afterEach(() => jest.useRealTimers());
  // 07.11 09:00–18:00 Tashkent.
  const closed = { id: 'wl9', driverId: 'd1', clockInAt: new Date('2026-11-07T04:00:00Z'), clockOutAt: new Date('2026-11-07T13:00:00Z') };

  function at(now: string, activeOrders: number) {
    jest.useFakeTimers({ now: new Date(now), doNotFake: ['nextTick', 'setImmediate'] });
    const made = makeService({ openShift: null, activeOrders, workStart: 9 * 60 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wl = made.prisma.workLog as any;
    wl.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(closed);
    wl.updateMany.mockResolvedValue({ count: 1 });
    wl.findUniqueOrThrow.mockResolvedValue({ ...closed, clockOutAt: null, carryOvers: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (made.prisma as any).eveningOvertime.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    return { ...made, wl };
  }

  it('19:00 the same day with an order: reopened', async () => {
    const { service, wl } = at('2026-11-07T14:00:00Z', 1);
    await service.clockIn('u1');
    expect(wl.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'wl9' });
    expect(wl.create).not.toHaveBeenCalled();
  });

  it('01:00 the night after with an order: reopened', async () => {
    const { service, wl } = at('2026-11-07T20:00:00Z', 1);
    await service.clockIn('u1');
    expect(wl.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'wl9' });
    expect(wl.create).not.toHaveBeenCalled();
  });

  it('04:30 with an order (Ertangi opened at 00:01): a new shift, the old one left closed', async () => {
    const { service, wl } = at('2026-11-07T23:30:00Z', 1);
    await service.clockIn('u1');
    expect(wl.create).toHaveBeenCalled();
    expect(wl.updateMany).not.toHaveBeenCalled();
  });

  it('04:30 with no order: still shift_closed_no_order', async () => {
    const { service, wl } = at('2026-11-07T23:30:00Z', 0);
    await expect(service.clockIn('u1')).rejects.toMatchObject({ message: 'shift_closed_no_order' });
    expect(wl.create).not.toHaveBeenCalled();
    expect(wl.updateMany).not.toHaveBeenCalled();
  });
});

describe('a shift begun 00:00–04:59 counts as today for a second start (owner, 07.11.2026)', () => {
  afterEach(() => jest.useRealTimers());
  // 07.11 04:30–19:30 Tashkent: keyed to 06.11's shift day, but begun on 07.11.
  const closed = { id: 'wl7', driverId: 'd1', clockInAt: new Date('2026-11-06T23:30:00Z'), clockOutAt: new Date('2026-11-07T14:30:00Z'), offPeriods: null };

  function at(now: string, activeOrders: number) {
    jest.useFakeTimers({ now: new Date(now), doNotFake: ['nextTick', 'setImmediate'] });
    const made = makeService({ openShift: null, activeOrders, workStart: 9 * 60 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wl = made.prisma.workLog as any;
    wl.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(closed);
    wl.updateMany.mockResolvedValue({ count: 1 });
    wl.findUniqueOrThrow.mockResolvedValue({ ...closed, clockOutAt: null, carryOvers: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (made.prisma as any).eveningOvertime.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    return { ...made, wl };
  }

  it('20:00 the same day without an order: shift_closed_no_order, nothing opened', async () => {
    const { service, wl } = at('2026-11-07T15:00:00Z', 0);
    await expect(service.clockIn('u1')).rejects.toMatchObject({ message: 'shift_closed_no_order' });
    expect(wl.create).not.toHaveBeenCalled();
    expect(wl.updateMany).not.toHaveBeenCalled();
  });

  it('20:00 with an order: reopened, the 30 min off kept as a break and as an off period', async () => {
    const { service, wl } = at('2026-11-07T15:00:00Z', 1);
    await service.clockIn('u1');
    expect(wl.create).not.toHaveBeenCalled();
    const { where, data } = wl.updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ id: 'wl7' });
    expect(data.breakMinutes).toEqual({ increment: 30 });
    expect(data.offPeriods).toEqual([{ from: '2026-11-07T14:30:00.000Z', to: '2026-11-07T15:00:00.000Z' }]);
  });

  it('a second reopen keeps the first off period too', async () => {
    const { service, wl } = at('2026-11-07T17:00:00Z', 1);
    wl.findFirst.mockReset();
    wl.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...closed,
        clockOutAt: new Date('2026-11-07T16:00:00Z'),
        offPeriods: [{ from: '2026-11-07T14:30:00.000Z', to: '2026-11-07T15:00:00.000Z' }],
      });
    await service.clockIn('u1');
    expect(wl.updateMany.mock.calls[0][0].data.offPeriods).toEqual([
      { from: '2026-11-07T14:30:00.000Z', to: '2026-11-07T15:00:00.000Z' },
      { from: '2026-11-07T16:00:00.000Z', to: '2026-11-07T17:00:00.000Z' },
    ]);
  });

  it('the next morning at 09:00: a new shift, no order needed', async () => {
    const { service, wl } = at('2026-11-08T04:00:00Z', 0);
    await service.clockIn('u1');
    expect(wl.create).toHaveBeenCalled();
    expect(wl.updateMany).not.toHaveBeenCalled();
  });
});

describe('clock-out twice at once (audit, 07.11.2026)', () => {
  it('the second one finds the shift already closed: refused, no break, no carry-over, no status change', async () => {
    const { service, prisma, notifications } = makeService({ openShift: { id: 'wl1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wl = prisma.workLog as any;
    wl.updateMany.mockResolvedValue({ count: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.order as any).findMany.mockResolvedValue([inHandOrder()]);
    await expect(service.clockOut('u1', { carry_over: { reason: 'out_of_time' } })).rejects.toThrow('no_open_shift');
    expect(wl.updateMany.mock.calls[0][0].where).toEqual({ id: 'wl1', clockOutAt: null });
    expect(prisma.driver.update).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.orderCarryOver as any).createMany).not.toHaveBeenCalled();
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });
});

describe('correcting the times of a closed shift redoes its evening extra (audit, 07.11.2026)', () => {
  const HOUR = 3_600_000;
  // A fixed day mid-period, so the pay lock of the 16th never catches it.
  const FIXED = new Date('2026-11-07T07:00:00Z');
  beforeEach(() => jest.useFakeTimers({ now: FIXED, doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());
  const inAt = new Date(FIXED.getTime() - 30 * HOUR);
  const outAt = new Date(inAt.getTime() + 9 * HOUR);

  function withClosed() {
    const made = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = made.prisma as any;
    p.workLog.findFirst = jest.fn().mockImplementation(({ where }: { where: { id?: unknown } }) =>
      Promise.resolve(
        where.id === 'wl1'
          ? { id: 'wl1', driverId: 'd1', expectedStart: '09:00', expectedEnd: '18:00', clockInAt: inAt, clockOutAt: outAt }
          : null,
      ),
    );
    p.workLog.update = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'wl1', driverId: 'd1', breakMinutes: 0, carryOvers: [], ...data }),
    );
    p.user.findUnique = jest.fn().mockResolvedValue({ name: 'Admin' });
    p.eveningOvertime.deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    return { ...made, p };
  }

  it('a new clock-out: its evening rows go and the shift is checked again', async () => {
    const { service, p } = withClosed();
    const later = new Date(outAt.getTime() + 2 * HOUR).toISOString();
    await service.correctWorkLog('d1', 'wl1', { clock_out_at: later, note: 'Kech tugadi' }, { userId: 'admin1' });
    expect(p.eveningOvertime.deleteMany).toHaveBeenCalledWith({ where: { workLogId: 'wl1' } });
    expect(p.workLog.update.mock.calls[0][0].data).toMatchObject({ eveningCheckedAt: null });
  });

  it('the same times again: the evening extra stays', async () => {
    const { service, p } = withClosed();
    await service.correctWorkLog('d1', 'wl1', { clock_out_at: outAt.toISOString(), note: 'x' }, { userId: 'admin1' });
    expect(p.eveningOvertime.deleteMany).not.toHaveBeenCalled();
    expect(p.workLog.update.mock.calls[0][0].data).not.toHaveProperty('eveningCheckedAt');
  });
});

describe('pay period lock: an admin correcting a shift (owner, 07.11.2026)', () => {
  afterEach(() => jest.useRealTimers());
  const HOUR = 3_600_000;

  function withClosed(inAt: Date) {
    const made = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = made.prisma as any;
    p.workLog.findFirst = jest.fn().mockImplementation(({ where }: { where: { id?: unknown } }) =>
      Promise.resolve(
        where.id === 'wl1'
          ? { id: 'wl1', driverId: 'd1', expectedStart: '09:00', expectedEnd: '18:00', clockInAt: inAt, clockOutAt: new Date(inAt.getTime() + 9 * HOUR) }
          : null,
      ),
    );
    p.workLog.update = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'wl1', driverId: 'd1', breakMinutes: 0, carryOvers: [], ...data }),
    );
    p.user.findUnique = jest.fn().mockResolvedValue({ name: 'Admin' });
    p.eveningOvertime.deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    return { ...made, p };
  }

  it('a shift of 15.10 corrected on 16.10 at 12:00: period_locked, nothing written', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-16T07:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const { service, p } = withClosed(new Date('2026-10-15T04:00:00Z'));
    await expect(
      service.correctWorkLog('d1', 'wl1', { clock_out_at: '2026-10-15T15:00:00.000Z', note: 'x' }, { userId: 'admin1' }),
    ).rejects.toThrow('period_locked');
    expect(p.workLog.update).not.toHaveBeenCalled();
    expect(p.eveningOvertime.deleteMany).not.toHaveBeenCalled();
  });

  it('an open period moved into a locked one: period_locked', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-17T07:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const { service, p } = withClosed(new Date('2026-10-16T04:00:00Z'));
    await expect(
      service.correctWorkLog('d1', 'wl1', { clock_in_at: '2026-10-15T04:00:00.000Z', note: 'x' }, { userId: 'admin1' }),
    ).rejects.toThrow('period_locked');
    expect(p.workLog.update).not.toHaveBeenCalled();
  });

  // Owner, 07.11.2026: a shift still open in a locked period may be closed, nothing else.
  function withOpen(inAt: Date) {
    const made = withClosed(inAt);
    made.p.workLog.findFirst = jest.fn().mockImplementation(({ where }: { where: { id?: unknown } }) =>
      Promise.resolve(
        where.id === 'wl1'
          ? { id: 'wl1', driverId: 'd1', expectedStart: '09:00', expectedEnd: '18:00', clockInAt: inAt, clockOutAt: null }
          : null,
      ),
    );
    made.p.workLog.count = jest.fn().mockResolvedValue(0);
    made.p.driver.findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'd1', breakStartedAt: null, breakUntil: null });
    made.p.driver.update = jest.fn().mockResolvedValue({});
    return made;
  }

  it('an open Viloyat shift of 15.10 closed on 16.10 after 12:00: allowed', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-16T09:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const { service, p } = withOpen(new Date('2026-10-15T04:00:00Z'));
    await service.correctWorkLog('d1', 'wl1', { clock_out_at: '2026-10-16T08:00:00.000Z', note: 'Viloyat' }, { userId: 'admin1' });
    expect(p.workLog.update.mock.calls[0][0].data).toMatchObject({ closeSource: 'admin' });
    expect(p.workLog.update.mock.calls[0][0].data.clockOutAt.toISOString()).toBe('2026-10-16T08:00:00.000Z');
  });

  it('an open shift in a locked period with its start moved too: period_locked', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-16T09:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const { service, p } = withOpen(new Date('2026-10-15T04:00:00Z'));
    await expect(
      service.correctWorkLog(
        'd1',
        'wl1',
        { clock_in_at: '2026-10-15T05:00:00.000Z', clock_out_at: '2026-10-16T08:00:00.000Z', note: 'x' },
        { userId: 'admin1' },
      ),
    ).rejects.toThrow('period_locked');
    expect(p.workLog.update).not.toHaveBeenCalled();
  });

  it('the same shift corrected on 16.10 at 11:59: written, its evening worked out again', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-16T06:59:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const { service, p } = withClosed(new Date('2026-10-15T04:00:00Z'));
    await service.correctWorkLog('d1', 'wl1', { clock_out_at: '2026-10-15T15:00:00.000Z', note: 'x' }, { userId: 'admin1' });
    expect(p.workLog.update).toHaveBeenCalled();
    expect(p.eveningOvertime.deleteMany).toHaveBeenCalledWith({ where: { workLogId: 'wl1' } });
  });
});

describe("a shift ended before the day's work start stays closed (owner, 07.11.2026)", () => {
  afterEach(() => jest.useRealTimers());

  function at(now: string, closed: Record<string, unknown>, activeOrders = 0) {
    jest.useFakeTimers({ now: new Date(now), doNotFake: ['nextTick', 'setImmediate'] });
    const made = makeService({ openShift: null, activeOrders, workStart: 9 * 60 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wl = made.prisma.workLog as any;
    wl.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(closed);
    wl.updateMany.mockResolvedValue({ count: 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (made.prisma as any).eveningOvertime.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    return { ...made, wl };
  }

  it('04:30–06:00, then 09:00 without an order: a new shift, the early one not reopened', async () => {
    // 07.11 04:30–06:00 Tashkent.
    const early = { id: 'wl5', driverId: 'd1', clockInAt: new Date('2026-11-06T23:30:00Z'), clockOutAt: new Date('2026-11-07T01:00:00Z') };
    const { service, wl } = at('2026-11-07T04:00:00Z', early);
    await service.clockIn('u1');
    expect(wl.create).toHaveBeenCalled();
    expect(wl.updateMany).not.toHaveBeenCalled();
  });

  it('04:30–06:00, then 07:30 with an order: also a new shift', async () => {
    const early = { id: 'wl5', driverId: 'd1', clockInAt: new Date('2026-11-06T23:30:00Z'), clockOutAt: new Date('2026-11-07T01:00:00Z') };
    const { service, wl } = at('2026-11-07T02:30:00Z', early, 1);
    await service.clockIn('u1');
    expect(wl.create).toHaveBeenCalled();
    expect(wl.updateMany).not.toHaveBeenCalled();
  });

  it('09:00–14:00, then 15:00 without an order: shift_closed_no_order, as before', async () => {
    const day = { id: 'wl6', driverId: 'd1', clockInAt: new Date('2026-11-07T04:00:00Z'), clockOutAt: new Date('2026-11-07T09:00:00Z') };
    const { service, wl } = at('2026-11-07T10:00:00Z', day);
    await expect(service.clockIn('u1')).rejects.toMatchObject({ message: 'shift_closed_no_order' });
    expect(wl.create).not.toHaveBeenCalled();
  });

  it('ended exactly at 09:00: the rule applies — no order, no start', async () => {
    const day = { id: 'wl6', driverId: 'd1', clockInAt: new Date('2026-11-06T23:30:00Z'), clockOutAt: new Date('2026-11-07T04:00:00Z') };
    const { service } = at('2026-11-07T05:00:00Z', day);
    await expect(service.clockIn('u1')).rejects.toMatchObject({ message: 'shift_closed_no_order' });
  });
});

describe('DriversService — breaks kept and extended (owner, 12.11.2026)', () => {
  it('starting a break keeps a row of its own for the office', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prisma as any;
    await service.startBreak('u1', { from: new Date(Date.now() + 1000).toISOString(), to: new Date(Date.now() + 3_600_000).toISOString(), reason: 'Tushlik' });
    expect(p.driverBreak.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workLogId: 'wl1', reason: 'Tushlik' }) });
  });

  it('extending moves the end, with the reason, and keeps the history', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prisma as any;
    const until = new Date(Date.now() - 2 * 60_000); // ran out two minutes ago, not back yet
    p.driver.findUnique.mockResolvedValue({ ...baseDriver(), breakStartedAt: new Date(Date.now() - 3_600_000), breakUntil: until, breakReason: 'Tushlik' });
    p.driverBreak.findFirst.mockResolvedValue({ id: 'b1', extensions: [] });
    const to = new Date(Date.now() + 30 * 60_000);
    await service.extendBreak('u1', { to: to.toISOString(), reason: "Mashina navbatda" });
    expect(p.driver.update).toHaveBeenCalledWith({ where: { id: baseDriver().id }, data: { breakUntil: to } });
    const data = p.driverBreak.update.mock.calls[0][0].data;
    expect(data.until).toEqual(to);
    expect(data.extensions).toEqual([{ at: expect.any(String), from: until.toISOString(), to: to.toISOString(), reason: 'Mashina navbatda' }]);
  });

  it('no break to extend, or a new end not later: refused', async () => {
    const { service, prisma } = makeService({ openShift: { id: 'wl1' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prisma as any;
    await expect(service.extendBreak('u1', { to: new Date(Date.now() + 60_000).toISOString(), reason: 'x y' })).rejects.toThrow('no_break_to_extend');
    p.driver.findUnique.mockResolvedValue({ ...baseDriver(), breakUntil: new Date(Date.now() + 3_600_000) });
    await expect(service.extendBreak('u1', { to: new Date(Date.now() + 60_000).toISOString(), reason: 'x y' })).rejects.toThrow('break_extend_not_later');
  });
});
