import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { FuelService, arithmeticAgrees } from './fuel.service';

/**
 * The service around the classifier: what gets stored on a draft, who may
 * confirm it, and which account a confirmed fill lands on.
 */

const driverActor = { userId: 'u-driver', role: 'driver' as const };

const A = {
  id: 'A', name: 'Hayot Gaz — Chilonzor', brand: 'Hayot Gaz', address: null,
  lat: 41.281, lng: 69.204, fuelTypes: ['gaz', 'propan'], contracted: true, active: true,
  createdAt: new Date(), updatedAt: new Date(),
};
const B = { ...A, id: 'B', name: 'Metan Servis — Yunusobod', lat: 41.362, lng: 69.289, fuelTypes: ['gaz'] };

/** Metres north of a station, as a lat/lng. */
const north = (s: { lat: number; lng: number }, m: number) => ({ lat: s.lat + m / 111_000, lng: s.lng });

function makeService(over: {
  driver?: Record<string, unknown> | null;
  stations?: unknown[];
  log?: Record<string, unknown> | null;
  logs?: unknown[];
  reading?: Record<string, unknown> | null;
} = {}) {
  const driver =
    over.driver === null
      ? null
      : {
          id: 'drv1', userId: 'u-driver', vehicleId: 'veh1',
          locationLat: null, locationLng: null, locationUpdatedAt: null,
          ...over.driver,
        };
  const stations = over.stations ?? [A, B];
  const prisma = {
    driver: { findUnique: jest.fn().mockResolvedValue(driver) },
    fuelStation: {
      findMany: jest.fn().mockResolvedValue(stations),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(stations.find((s) => (s as { id: string }).id === where.id) ?? null),
      ),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...A, ...data, id: 'new' })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...A, ...data })),
    },
    fuelLog: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'log1', status: 'draft', createdAt: new Date(), updatedAt: new Date(),
          extractedTotalSum: null, extractedQuantity: null, extractedUnitPriceSum: null, extractedReadable: null,
          totalSum: null, quantity: null, unitPriceSum: null, confirmedAt: null, settlement: null, settledAt: null,
          ...data,
          selectedStation: stations.find((s) => (s as { id: string }).id === data.selectedStationId) ?? null,
          resolvedStation: stations.find((s) => (s as { id: string }).id === data.resolvedStationId) ?? null,
        }),
      ),
      findUnique: jest.fn().mockResolvedValue(over.log === undefined ? draftRow() : over.log),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...draftRow(), ...data, selectedStation: A, resolvedStation: A }),
      ),
      findMany: jest.fn().mockResolvedValue(over.logs ?? []),
      // The confirm claims its draft first (one row), a correction or a
      // settlement writes its one log; settling a driver counts the listed logs.
      updateMany: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve({ count: where?.status === 'draft' || typeof where?.id === 'string' ? 1 : (over.logs?.length ?? 0) }),
      ),
      findUniqueOrThrow: jest.fn().mockImplementation(() =>
        Promise.resolve({ ...draftRow(), ...(over.log ?? {}), selectedStation: A, resolvedStation: A }),
      ),
    },
  };
  const upload = { uploadBase64: jest.fn().mockResolvedValue('https://cdn/fuel/1.jpg') };
  const reader = { read: jest.fn().mockResolvedValue(over.reading ?? null), enabled: !!over.reading };
  const telegram = { createForFuel: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new FuelService(prisma as any, upload as any, reader as any, telegram as any, { get: () => 'on' } as any);
  return { svc, prisma, upload, reader };
}

function draftRow(over: Record<string, unknown> = {}) {
  return {
    id: 'log1', status: 'draft', driverId: 'drv1', vehicleId: 'veh1', fuelType: 'gaz',
    photoUrl: 'https://cdn/fuel/1.jpg', selectedStationId: 'A', resolvedStationId: 'A',
    capturedAt: new Date(), captureLat: A.lat, captureLng: A.lng, captureAccuracyM: 8,
    trackedLat: null, trackedLng: null, trackedAt: null, distanceM: 12, trackingGapM: null,
    outcome: 'matched', flags: [] as string[],
    extractedTotalSum: null, extractedQuantity: null, extractedUnitPriceSum: null, extractedReadable: null,
    totalSum: null, quantity: null, unitPriceSum: null, confirmedAt: null, settlement: null, settledAt: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
  };
}

const draftInput = (over: Record<string, unknown> = {}) => ({
  fuel_type: 'gaz' as const,
  station_id: 'A',
  photo_base64: 'aGVsbG8=',
  captured_at: new Date().toISOString(),
  position: { ...north(A, 30), accuracy_m: 8 },
  ...over,
});

describe('FuelService — opening a draft', () => {
  it('never takes a photo time later than now — it would stretch the evening pay (06.11.2026)', async () => {
    const { svc, prisma } = makeService();
    const before = Date.now();
    await svc.createDraft({ ...draftInput(), captured_at: new Date(before + 5 * 3_600_000).toISOString() }, driverActor);
    const at: Date = prisma.fuelLog.create.mock.calls[0][0].data.capturedAt;
    expect(at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('stores the photo, the position, the classification, and the vehicle at the time', async () => {
    const { svc, prisma, upload } = makeService();
    const log = await svc.createDraft(draftInput(), driverActor);

    expect(upload.uploadBase64).toHaveBeenCalledWith('aGVsbG8=', 'fuel-logs');
    const data = prisma.fuelLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      driverId: 'drv1', vehicleId: 'veh1', fuelType: 'gaz', photoUrl: 'https://cdn/fuel/1.jpg',
      selectedStationId: 'A', resolvedStationId: 'A', outcome: 'matched', flags: [],
      captureAccuracyM: 8,
    });
    expect(log).toMatchObject({ status: 'draft', outcome: 'matched', unit: 'nm3', confirmed: null });
    expect(log.resolved_station?.id).toBe('A');
  });

  it("uses the driver's tracked position as the second opinion", async () => {
    // Phone says A, tracker says B: the log carries both and the gap between them.
    const { svc, prisma } = makeService({
      driver: { locationLat: B.lat, locationLng: B.lng, locationUpdatedAt: new Date() },
    });
    await svc.createDraft(draftInput(), driverActor);
    const data = prisma.fuelLog.create.mock.calls[0][0].data;
    expect(data.trackedLat).toBe(B.lat);
    expect(data.flags).toEqual(['tracking_disagrees']);
    expect(data.trackingGapM).toBeGreaterThan(1_000);
  });

  it("Ko'cha path: no station, no fence hit → unlisted, and the photo is still kept", async () => {
    const { svc, prisma } = makeService();
    const log = await svc.createDraft(draftInput({ station_id: null, position: { lat: 41.30, lng: 69.30 } }), driverActor);
    expect(log.outcome).toBe('unlisted');
    expect(log.selected_station).toBeNull();
    expect(prisma.fuelLog.create).toHaveBeenCalled();
  });

  it('no fix from the phone: unverified, not refused', async () => {
    const { svc } = makeService();
    const log = await svc.createDraft(draftInput({ position: null }), driverActor);
    expect(log).toMatchObject({ outcome: 'unverified', flags: ['no_gps'] });
  });

  it('refuses a station id that does not exist or is switched off', async () => {
    const { svc } = makeService({ stations: [{ ...A, active: false }] });
    await expect(svc.createDraft(draftInput({ station_id: 'A' }), driverActor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createDraft(draftInput({ station_id: 'nope' }), driverActor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is for drivers only', async () => {
    const { svc } = makeService({ driver: null });
    await expect(svc.createDraft(draftInput(), { userId: 'u-admin', role: 'admin' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('FuelService — what the reader adds to a draft', () => {
  const reading = { readable: true, reason: null, total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600, unit: 'nm3' };

  it('stores the extraction beside the log, separately from anything confirmed', async () => {
    const { svc, prisma, reader } = makeService({ reading });
    const log = await svc.createDraft(draftInput(), driverActor);
    expect(reader.read).toHaveBeenCalledWith('aGVsbG8=', 'gaz');
    expect(prisma.fuelLog.create.mock.calls[0][0].data).toMatchObject({
      extractedReadable: true, extractedTotalSum: 75527.2, extractedQuantity: 13.487, extractedUnitPriceSum: 5600, extractedUnit: 'nm3',
    });
    expect(prisma.fuelLog.create.mock.calls[0][0].data).not.toHaveProperty('totalSum');
    expect(log.extracted).toEqual({ total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600 });
    expect(log.extracted_readable).toBe(true);
    expect(log.confirmed).toBeNull();
  });

  it('an unreadable photo is recorded with its reason and no numbers', async () => {
    const { svc, prisma } = makeService({ reading: { readable: false, reason: 'glare', total_sum: null, quantity: null, unit_price_sum: null, unit: null } });
    const log = await svc.createDraft(draftInput(), driverActor);
    expect(prisma.fuelLog.create.mock.calls[0][0].data).toMatchObject({ extractedReadable: false, extractedReason: 'glare', extractedTotalSum: null });
    expect(log).toMatchObject({ extracted: null, extracted_readable: false, extracted_reason: 'glare' });
  });

  it('flags a display whose unit contradicts the fuel the driver tapped', async () => {
    const { svc, prisma } = makeService({ reading: { ...reading, unit: 'l' } });
    await svc.createDraft(draftInput({ fuel_type: 'gaz' }), driverActor);
    expect(prisma.fuelLog.create.mock.calls[0][0].data.flags).toEqual(['unit_mismatch']);
  });

  it('no reader answer: the draft is exactly what it was before the AI existed', async () => {
    const { svc, prisma } = makeService({ reading: null });
    const log = await svc.createDraft(draftInput(), driverActor);
    expect(prisma.fuelLog.create.mock.calls[0][0].data).toMatchObject({ extractedReadable: null, extractedTotalSum: null });
    expect(log.extracted_readable).toBeNull();
  });
});

describe('FuelService — confirming the numbers', () => {
  const reading = { total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600 };

  it('marks the log confirmed with the three numbers and a settlement', async () => {
    const { svc, prisma } = makeService();
    const log = await svc.confirm('log1', reading, driverActor);
    const data = prisma.fuelLog.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'confirmed', totalSum: 75527.2, quantity: 13.487, unitPriceSum: 5600,
      flags: [], settlement: 'station_invoice',
    });
    expect(data.confirmedAt).toBeInstanceOf(Date);
    expect(log.confirmed).toEqual(reading);
  });

  it('flags arithmetic that does not hold, without refusing', async () => {
    const { svc, prisma } = makeService();
    await svc.confirm('log1', { ...reading, quantity: 13.0 }, driverActor);
    expect(prisma.fuelLog.update.mock.calls[0][0].data.flags).toEqual(['arithmetic_off']);
  });

  it.each([
    ['matched', 'station_invoice'],
    ['other_station', 'station_invoice'],
    ['unlisted', 'driver_reimbursement'],
    ['mismatch', 'driver_reimbursement'],
    ['unverified', null],
  ])('files a %s fill under %s', async (outcome, settlement) => {
    const { svc, prisma } = makeService({ log: draftRow({ outcome }) });
    await svc.confirm('log1', reading, driverActor);
    expect(prisma.fuelLog.update.mock.calls[0][0].data.settlement).toBe(settlement);
  });

  it("refuses another driver's log", async () => {
    const { svc } = makeService({ log: draftRow({ driverId: 'someone-else' }) });
    await expect(svc.confirm('log1', reading, driverActor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to confirm twice', async () => {
    const { svc } = makeService({ log: draftRow({ status: 'confirmed' }) });
    await expect(svc.confirm('log1', reading, driverActor)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('FuelService — the numbers are the photo\'s, unless nobody could read it', () => {
  const read = { extractedReadable: true, extractedTotalSum: 75527.2, extractedQuantity: 13.487, extractedUnitPriceSum: 5600 };
  const same = { total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600 };

  it('accepts a confirm that repeats what the photo said', async () => {
    const { svc } = makeService({ log: draftRow(read) });
    await expect(svc.confirm('log1', same, driverActor)).resolves.toBeTruthy();
  });

  it('keeps a confirm that changes a number the photo gave, marked and unsettled', async () => {
    const { svc, prisma } = makeService({ log: draftRow({ ...read, outcome: 'matched' }) });
    // 13.487 × 5 600 = 75 527.2: the arithmetic still holds, only the driver disagrees with the photo.
    await expect(svc.confirm('log1', { ...same, total_sum: 75527 }, driverActor)).resolves.toBeTruthy();
    const data = prisma.fuelLog.update.mock.calls[0][0].data;
    expect(data.totalSum).toBe(75527);
    expect(data.flags).toEqual(['driver_edited']);
    expect(data.settlement).toBeNull();
  });

  it('does not mark a confirm that repeats the photo', async () => {
    const { svc, prisma } = makeService({ log: draftRow({ ...read, outcome: 'matched' }) });
    await svc.confirm('log1', same, driverActor);
    const data = prisma.fuelLog.update.mock.calls[0][0].data;
    expect(data.flags).toEqual([]);
    expect(data.settlement).toBe('station_invoice');
  });

  it('lets the driver type anything when the photo could not be read', async () => {
    const { svc } = makeService({ log: draftRow({ extractedReadable: false, extractedReason: 'blur' }) });
    await expect(svc.confirm('log1', { total_sum: 1, quantity: 1, unit_price_sum: 1 }, driverActor)).resolves.toBeTruthy();
  });

  it('lets the driver type anything when the reader was off', async () => {
    const { svc } = makeService({ log: draftRow({ extractedReadable: null }) });
    await expect(svc.confirm('log1', { total_sum: 420000, quantity: 30, unit_price_sum: 12500 }, driverActor)).resolves.toBeTruthy();
  });
});

describe('FuelService — doubtful numbers wait for a person', () => {
  it('a matched fill whose numbers do not multiply out gets no settlement', async () => {
    const { svc, prisma } = makeService({ log: draftRow({ outcome: 'matched' }) });
    await svc.confirm('log1', { total_sum: 420000, quantity: 30, unit_price_sum: 12500 }, driverActor);
    const data = prisma.fuelLog.update.mock.calls[0][0].data;
    expect(data.flags).toEqual(['arithmetic_off']);
    expect(data.settlement).toBeNull();
  });

  it('a matched fill whose display unit contradicts the fuel gets no settlement', async () => {
    const { svc, prisma } = makeService({ log: draftRow({ outcome: 'matched', flags: ['unit_mismatch'] }) });
    await svc.confirm('log1', { total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600 }, driverActor);
    expect(prisma.fuelLog.update.mock.calls[0][0].data.settlement).toBeNull();
  });

  it('holds a fill whose position nothing corroborates, fence or no fence', async () => {
    // The coordinate on the photo comes from the phone. When the trail the
    // server kept disagrees — or there is no recent fix at all — a person
    // looks before the station is invoiced or the driver is paid back.
    for (const flag of ['gps_stale', 'no_gps', 'tracking_disagrees'] as const) {
      const { svc, prisma } = makeService({ log: draftRow({ outcome: 'matched', flags: [flag] }) });
      await svc.confirm('log1', { total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600 }, driverActor);
      expect(prisma.fuelLog.update.mock.calls[0][0].data.settlement).toBeNull();
    }
  });
});

describe('FuelService — an admin corrects the numbers', () => {
  const admin = { userId: 'u-admin', role: 'admin' as const };
  const held = (over: Record<string, unknown> = {}) =>
    draftRow({ status: 'confirmed', outcome: 'matched', flags: ['arithmetic_off'], settlement: null,
      totalSum: 420000, quantity: 30, unitPriceSum: 12500, originalTotalSum: null, originalQuantity: null, originalUnitPriceSum: null, ...over });

  it('replaces the numbers, keeps the driver\'s as the original, records who and when', async () => {
    const { svc, prisma } = makeService({ log: held() });
    await svc.correctReading('log1', { total_sum: 375000, quantity: 30, unit_price_sum: 12500 }, admin);
    const data = prisma.fuelLog.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({
      totalSum: 375000, quantity: 30, unitPriceSum: 12500,
      originalTotalSum: 420000, originalQuantity: 30, originalUnitPriceSum: 12500,
      reviewedById: 'u-admin',
    });
    expect(data.reviewedAt).toBeInstanceOf(Date);
  });

  it('saving a fill held for a missing GPS fix releases it: the office has looked', async () => {
    const { svc, prisma } = makeService({ log: held({ flags: ['no_gps'], totalSum: 319989.6, quantity: 57.141, unitPriceSum: 5600 }) });
    await svc.correctReading('log1', { total_sum: 319989.6, quantity: 57.141, unit_price_sum: 5600 }, admin);
    expect(prisma.fuelLog.updateMany.mock.calls[0][0].data.settlement).toBe('station_invoice');
  });

  it("saving the driver's numbers unchanged approves them: settled, not counted as a correction", async () => {
    const { svc, prisma } = makeService({ log: held({ flags: ['driver_edited'], totalSum: 330600, quantity: 58, unitPriceSum: 5700 }) });
    await svc.correctReading('log1', { total_sum: 330600, quantity: 58, unit_price_sum: 5700 }, admin);
    const data = prisma.fuelLog.updateMany.mock.calls[0][0].data;
    expect(data.originalTotalSum).toBeUndefined();
    expect(data.settlement).toBe('station_invoice');
    expect(data.flags).toContain('driver_edited');
    expect(data.reviewedById).toBe('u-admin');
  });

  it('saving through Tahrirlash is a correction even when the digits come out the same', async () => {
    const { svc, prisma } = makeService({ log: held({ flags: [], totalSum: 67872, quantity: 12.12, unitPriceSum: 5600 }) });
    await svc.correctReading('log1', { total_sum: 67872, quantity: 12.12, unit_price_sum: 5600, corrected: true }, admin);
    const data = prisma.fuelLog.updateMany.mock.calls[0][0].data;
    expect(data.originalTotalSum).toBe(67872);
    expect(data.reviewedById).toBe('u-admin');
  });

  it('a correction that fixes the arithmetic releases the log to its default settlement', async () => {
    const { svc, prisma } = makeService({ log: held() });
    await svc.correctReading('log1', { total_sum: 375000, quantity: 30, unit_price_sum: 12500 }, admin);
    const data = prisma.fuelLog.updateMany.mock.calls[0][0].data;
    expect(data.flags).toEqual([]);
    expect(data.settlement).toBe('station_invoice');
  });

  it('a correction that still does not add up keeps the log in review', async () => {
    const { svc, prisma } = makeService({ log: held() });
    await svc.correctReading('log1', { total_sum: 400000, quantity: 30, unit_price_sum: 12500 }, admin);
    const data = prisma.fuelLog.updateMany.mock.calls[0][0].data;
    expect(data.flags).toEqual(['arithmetic_off']);
    expect(data.settlement ?? null).toBeNull();
  });

  it('a second correction keeps the first original — the driver\'s numbers, not the admin\'s', async () => {
    const { svc, prisma } = makeService({ log: held({ originalTotalSum: 420000, originalQuantity: 30, originalUnitPriceSum: 12500, totalSum: 375000 }) });
    await svc.correctReading('log1', { total_sum: 375001, quantity: 30, unit_price_sum: 12500 }, admin);
    expect(prisma.fuelLog.updateMany.mock.calls[0][0].data).not.toHaveProperty('originalTotalSum');
  });

  it('refuses to correct a paid log', async () => {
    const { svc } = makeService({ log: held({ settlement: 'station_invoice', settledAt: new Date() }) });
    await expect(svc.correctReading('log1', { total_sum: 1, quantity: 1, unit_price_sum: 1 }, admin)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('FuelService — stations', () => {
  it('lists only live contracted stations, filtered by fuel when asked', async () => {
    const { svc, prisma } = makeService();
    await svc.listStations('propan');
    expect(prisma.fuelStation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true, contracted: true, fuelTypes: { has: 'propan' } } }),
    );
  });

  it('nearby returns whole metres, nearest first', async () => {
    const { svc } = makeService();
    const near = await svc.nearbyStations(north(A, 250), 'gaz');
    expect(near.map((s) => s.id)).toEqual(['A']); // B is ~11 km away
    expect(near[0].distance_m).toBe(250);
  });

  it('far from everything, it still names the nearest ones — closest first, with real distances', async () => {
    const { svc } = makeService();
    // Tapping the fuel button on the far side of the city must answer
    // "Yujniy, 12 km", not an empty list: that answer is what gets routed.
    // Two are offered, so there is a choice, the nearer first.
    const near = await svc.nearbyStations({ lat: 41.5, lng: 69.6 }, 'gaz');
    expect(near.length).toBeGreaterThanOrEqual(1);
    expect(near.length).toBeLessThanOrEqual(2);
    expect(near[0].distance_m).toBeGreaterThan(3_000);
    if (near[1]) expect(near[1].distance_m).toBeGreaterThanOrEqual(near[0].distance_m);
  });

  it('refuses a half-pinned station', async () => {
    const { svc } = makeService();
    await expect(
      svc.createStation({ name: 'X', fuel_types: ['gaz'], lat: 41.3, lng: null, contracted: true, active: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FuelService — a person settles what the fence could not', () => {
  const confirmed = (over: Record<string, unknown> = {}) =>
    draftRow({ status: 'confirmed', outcome: 'mismatch', settlement: null, totalSum: 67256, quantity: 12.01, unitPriceSum: 5600, ...over });

  it('files a log under a station and makes that station the resolved one', async () => {
    const { svc, prisma } = makeService({ log: confirmed() });
    await svc.settle('log1', { settlement: 'station_invoice', station_id: 'B' });
    expect(prisma.fuelLog.updateMany.mock.calls[0][0].data).toEqual({ settlement: 'station_invoice', resolvedStationId: 'B' });
  });

  it('files a log as the driver\'s money without touching the station', async () => {
    const { svc, prisma } = makeService({ log: confirmed() });
    await svc.settle('log1', { settlement: 'driver_reimbursement' });
    expect(prisma.fuelLog.updateMany.mock.calls[0][0].data).toEqual({ settlement: 'driver_reimbursement' });
  });

  it('refuses to move a log onto a station that does not exist', async () => {
    const { svc } = makeService({ log: confirmed() });
    await expect(svc.settle('log1', { settlement: 'station_invoice', station_id: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to re-settle something already paid — that is bookkeeping, not a click', async () => {
    const { svc } = makeService({ log: confirmed({ settlement: 'driver_reimbursement', settledAt: new Date() }) });
    await expect(svc.settle('log1', { settlement: 'driver_reimbursement' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a draft — nothing to settle until the driver has confirmed', async () => {
    const { svc } = makeService({ log: draftRow() });
    await expect(svc.settle('log1', { settlement: 'driver_reimbursement' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('FuelService — paying back one fill', () => {
  const owed = (over: Record<string, unknown> = {}) =>
    draftRow({ status: 'confirmed', outcome: 'unlisted', settlement: 'driver_reimbursement', totalSum: 74071.2, ...over });

  it('marks just that fill paid', async () => {
    const { svc, prisma } = makeService({ log: owed() });
    prisma.fuelLog.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const res = await svc.payLog('log1');
    expect(prisma.fuelLog.updateMany.mock.calls[0][0].where).toEqual({ id: 'log1', settlement: 'driver_reimbursement', settledAt: null });
    expect(res).toEqual({ paid: 1, total_sum: 74071.2 });
  });

  it("refuses a fill the station pays, which is not the driver's money", async () => {
    const { svc } = makeService({ log: owed({ settlement: 'station_invoice' }) });
    await expect(svc.payLog('log1')).rejects.toThrow('fuel_log_not_driver_paid');
  });

  it('a second tap pays nothing', async () => {
    const { svc, prisma } = makeService({ log: owed({ settledAt: new Date() }) });
    prisma.fuelLog.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    expect(await svc.payLog('log1')).toEqual({ paid: 0, total_sum: 0 });
  });
});

describe('FuelService — the month in numbers', () => {
  const logs = [
    { driverId: 'd1', resolvedStationId: 'A', fuelType: 'gaz', totalSum: 75527.2, quantity: 13.487, settlement: 'station_invoice', capturedAt: new Date('2026-09-21') },
    { driverId: 'd2', resolvedStationId: 'A', fuelType: 'gaz', totalSum: 122640, quantity: 21.9, settlement: 'station_invoice', capturedAt: new Date('2026-09-20') },
    { driverId: 'd3', resolvedStationId: null, fuelType: 'benzin', totalSum: 525000, quantity: 42, settlement: 'driver_reimbursement', capturedAt: new Date('2026-09-19') },
    { driverId: 'd1', resolvedStationId: 'A', fuelType: 'gaz', totalSum: 67256, quantity: 12.01, settlement: null, capturedAt: new Date('2026-09-18') },
  ];

  it('summary: totals, volume split by unit, distinct drivers and stations, pending count', async () => {
    const { svc } = makeService({ logs });
    expect(await svc.summary({})).toEqual({
      total_sum: 790423.2,
      volume_nm3: 47.397,
      volume_l: 42,
      count: 4,
      drivers: 3,
      stations: 1,
      pending_review: 1,
    });
  });

  it('station totals: only fills on the station invoice, grouped by resolved station', async () => {
    // The mock returns every row for any findMany; the grouping still has to
    // put A\'s fills under A and ignore the one with no station.
    const { svc } = makeService({ logs: logs.filter((l) => l.settlement === 'station_invoice') });
    const [a] = await svc.stationTotals({});
    expect(a.station.id).toBe('A');
    expect(a).toMatchObject({ count: 2, volume_nm3: 35.387, volume_l: 0, total_sum: 198167.2 });
  });

  it('driver debts: one row per driver, summed, oldest first inside', async () => {
    const owed = [
      { driverId: 'd3', totalSum: 525000, capturedAt: new Date('2026-09-19T10:00:00Z'), driver: { user: { name: 'Ali' } }, vehicle: { plateNumber: '01K778AA' } },
      { driverId: 'd3', totalSum: 300200, capturedAt: new Date('2026-09-18T10:00:00Z'), driver: { user: { name: 'Ali' } }, vehicle: { plateNumber: '01K778AA' } },
      { driverId: 'd2', totalSum: 98000, capturedAt: new Date('2026-09-17T10:00:00Z'), driver: { user: { name: 'Bekzod' } }, vehicle: null },
    ];
    const { svc } = makeService({ logs: owed });
    const debts = await svc.driverDebts();
    expect(debts).toEqual([
      expect.objectContaining({ driver_id: 'd3', driver_name: 'Ali', count: 2, total_sum: 825200, oldest_at: '2026-09-19T10:00:00.000Z' }),
      expect.objectContaining({ driver_id: 'd2', driver_name: 'Bekzod', vehicle_plate: null, count: 1, total_sum: 98000 }),
    ]);
  });

  it('paying a driver closes only what was due, and says how much', async () => {
    const due = [{ id: 'l1', totalSum: 525000 }, { id: 'l2', totalSum: 300200 }];
    const { svc, prisma } = makeService({ logs: due });
    const upTo = new Date('2026-09-21T23:59:59.999Z');
    const res = await svc.payDriver('d3', upTo);
    expect(res).toEqual({ paid: 2, total_sum: 825200 });
    expect(prisma.fuelLog.findMany.mock.calls[0][0].where).toMatchObject({
      driverId: 'd3', settlement: 'driver_reimbursement', settledAt: null, capturedAt: { lte: upTo },
    });
    // Still unsettled at the moment of the write: two taps on "To'landi" must
    // not hand the driver the same money twice.
    expect(prisma.fuelLog.updateMany.mock.calls[0][0].where).toEqual({
      id: { in: ['l1', 'l2'] },
      settledAt: null,
    });
  });

  it('paying a driver who is owed nothing writes nothing', async () => {
    const { svc, prisma } = makeService({ logs: [] });
    expect(await svc.payDriver('d9', new Date())).toEqual({ paid: 0, total_sum: 0 });
    expect(prisma.fuelLog.updateMany).not.toHaveBeenCalled();
  });
});

describe('arithmeticAgrees — a misread digit does not multiply out', () => {
  it('passes the real pump: 41.73 Nm³ × 5600 = 233 688, shown as 233 686', () => {
    expect(arithmeticAgrees({ total_sum: 233_686, quantity: 41.73, unit_price_sum: 5600 })).toBe(true);
  });
  it('fails the misread 233 586 for the same fill', () => {
    expect(arithmeticAgrees({ total_sum: 233_586, quantity: 41.73, unit_price_sum: 5600 })).toBe(false);
  });
  it('has nothing to say when a number is missing', () => {
    expect(arithmeticAgrees({ total_sum: null, quantity: 41.73, unit_price_sum: 5600 })).toBe(true);
  });
});

describe('FuelService — paid in the meantime (audit, 07.11.2026)', () => {
  const admin = { userId: 'u-admin', role: 'admin' as const };
  const confirmed = draftRow({ status: 'confirmed', outcome: 'mismatch', settlement: null, totalSum: 67256, quantity: 12.01, unitPriceSum: 5600 });

  it('paying a driver twice: the second call pays nothing', async () => {
    const due = [{ id: 'l1', totalSum: 525000 }, { id: 'l2', totalSum: 300200 }];
    const { svc, prisma } = makeService({ logs: due });
    prisma.fuelLog.updateMany = jest.fn().mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 0 });
    expect(await svc.payDriver('d3', new Date())).toEqual({ paid: 2, total_sum: 825200 });
    expect(await svc.payDriver('d3', new Date())).toEqual({ paid: 0, total_sum: 0 });
  });

  it('the sum is only of the rows this call stamped', async () => {
    const due = [{ id: 'l1', totalSum: 525000 }, { id: 'l2', totalSum: 300200 }];
    const { svc, prisma } = makeService({ logs: due });
    prisma.fuelLog.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.fuelLog.findMany = jest.fn().mockResolvedValueOnce(due).mockResolvedValueOnce([{ totalSum: 300200 }]);
    expect(await svc.payDriver('d3', new Date())).toEqual({ paid: 1, total_sum: 300200 });
    const stamp = prisma.fuelLog.updateMany.mock.calls[0][0].data.settledAt;
    expect(prisma.fuelLog.findMany.mock.calls[1][0].where).toEqual({ id: { in: ['l1', 'l2'] }, settledAt: stamp });
  });

  it('a correction or a settlement racing a payment is refused', async () => {
    const { svc, prisma } = makeService({ log: confirmed });
    prisma.fuelLog.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    await expect(svc.correctReading('log1', { total_sum: 1, quantity: 1, unit_price_sum: 1 }, admin)).rejects.toThrow('fuel_log_already_paid');
    await expect(svc.settle('log1', { settlement: 'driver_reimbursement' })).rejects.toThrow('fuel_log_already_paid');
    expect(prisma.fuelLog.updateMany.mock.calls[0][0].where).toEqual({ id: 'log1', settledAt: null });
    expect(prisma.fuelLog.updateMany.mock.calls[1][0].where).toEqual({ id: 'log1', settledAt: null });
  });
});
