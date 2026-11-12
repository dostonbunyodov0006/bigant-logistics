import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ServiceService } from './service.service';

/**
 * The visit lifecycle around the pure rules: who may do what in which
 * status, what completing writes, and what the reminder pass sends.
 */

const driverActor = { userId: 'u-driver', role: 'driver' as const };
const admin = { userId: 'u-admin', role: 'admin' as const };

const OIL = { id: 'r-oil', name: 'Moy almashtirish', intervalKm: 10_000, active: true, approved: true, createdByDriverId: null, createdAt: new Date(), updatedAt: new Date(), createdByDriver: null };
const TYRE = { ...OIL, id: 'r-tyre', name: 'Shina almashtirish', intervalKm: null };
const MINE = { ...OIL, id: 'r-mine', name: 'Nasos', intervalKm: null, approved: false, createdByDriverId: 'drv1' };
const OTHERS = { ...MINE, id: 'r-others', createdByDriverId: 'drv2' };
const CENTER = { id: 'c1', name: 'Avto Servis — Sergeli', brand: 'Avto Servis', address: null, lat: 41.2245, lng: 69.219, contracted: true, active: true, createdAt: new Date(), updatedAt: new Date() };
const north = (m: number) => ({ lat: CENTER.lat + m / 111_000, lng: CENTER.lng });

function visitRow(over: Record<string, unknown> = {}) {
  return {
    id: 'v1', status: 'requested', origin: 'request', vehicleId: 'veh1', driverId: 'drv1',
    scheduledAt: new Date('2026-09-23T05:00:00Z'), note: null, orderId: null, requestedAt: new Date(),
    decidedById: null, decidedAt: null, declineReason: null, assignedById: null, startedAt: null, completedAt: null,
    selectedCenterId: null, resolvedCenterId: null, capturedAt: null, captureLat: null, captureLng: null, captureAccuracyM: null,
    trackedLat: null, trackedLng: null, trackedAt: null, distanceM: null, trackingGapM: null, outcome: null, flags: [] as string[],
    odometerKm: null, totalSum: null, originalTotalSum: null, receiptPhotoUrl: null, noReceipt: false, reviewedById: null, reviewedAt: null,
    settlement: null, settledAt: null, createdAt: new Date(), updatedAt: new Date(),
    items: [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy almashtirish', photoUrl: null, costSum: null, position: 0 }],
    vehicle: { plateNumber: '40A400AA', model: 'Isuzu' }, driver: { id: 'drv1', user: { name: 'Hamza' } },
    selectedCenter: null, resolvedCenter: null, decidedBy: null, assignedBy: null, reviewedBy: null, order: null,
    ...over,
  };
}

function makeService(over: {
  driver?: Record<string, unknown> | null;
  visit?: Record<string, unknown> | null;
  reasons?: unknown[];
  vehicles?: unknown[];
  states?: unknown[];
  reminders?: unknown[];
  openVisits?: unknown[];
  prevState?: Record<string, unknown> | null;
} = {}) {
  const driver = over.driver === null ? null : { id: 'drv1', userId: 'u-driver', vehicleId: 'veh1', locationLat: null, locationLng: null, locationUpdatedAt: null, ...over.driver };
  const reasons = over.reasons ?? [OIL, TYRE, MINE, OTHERS];
  const visit = over.visit === undefined ? visitRow() : over.visit;
  const tx = {
    serviceVisitItem: { update: jest.fn().mockResolvedValue({}) },
    vehicleServiceState: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(over.prevState ?? null) },
    serviceReason: { findUnique: jest.fn().mockResolvedValue({ intervalKm: 10_000 }) },
    kmRecord: { create: jest.fn().mockResolvedValue({}) },
    vehicle: { findUnique: jest.fn().mockResolvedValue({ currentKm: 30_200 }), update: jest.fn().mockResolvedValue({}) },
    serviceVisit: {
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...visitRow(), ...(visit as object), ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    driver: { findUnique: jest.fn().mockImplementation(({ where }: { where: { userId?: string; id?: string } }) => Promise.resolve(where.userId === 'u-driver' || where.id === 'drv1' ? driver : null)) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u-admin' }]) },
    vehicle: {
      findUnique: jest.fn().mockResolvedValue({ id: 'veh1', plateNumber: '40A400AA', model: 'Isuzu', currentKm: 30_200, driver }),
      findMany: jest.fn().mockResolvedValue(over.vehicles ?? [{ id: 'veh1', plateNumber: '40A400AA', model: 'Isuzu', currentKm: 30_200, status: 'active', driver: { id: 'drv1', user: { name: 'Hamza' } } }]),
      update: jest.fn().mockResolvedValue({}),
    },
    serviceReason: {
      findMany: jest.fn().mockImplementation(({ where }: { where?: { id?: { in: string[] }; intervalKm?: unknown } }) =>
        Promise.resolve(where?.id?.in ? reasons.filter((r) => where.id!.in.includes((r as { id: string }).id)) : where?.intervalKm ? reasons.filter((r) => (r as { intervalKm: number | null }).intervalKm != null && (r as { approved: boolean }).approved) : reasons)),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(reasons.find((r) => (r as { id: string }).id === where.id) ?? null)),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...MINE, id: 'r-new', ...data, createdByDriver: null })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...OIL, ...data, createdByDriver: null })),
    },
    serviceCenter: {
      findMany: jest.fn().mockResolvedValue([CENTER]),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === 'c1' ? CENTER : null)),
    },
    serviceVisit: {
      findUnique: jest.fn().mockResolvedValue(visit),
      findMany: jest.fn().mockResolvedValue(over.openVisits ?? []),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...visitRow(), ...data, items: (data.items?.create ?? []).map((it: { name: string; reasonId: string | null }, i: number) => ({ id: `i${i + 1}`, visitId: 'v1', photoUrl: null, costSum: null, position: i, ...it })) })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...visitRow(), ...(visit as object), ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    serviceVisitItem: { update: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}) },
    vehicleServiceState: { findMany: jest.fn().mockResolvedValue(over.states ?? []), upsert: jest.fn().mockResolvedValue({}) },
    serviceReminder: { findMany: jest.fn().mockResolvedValue(over.reminders ?? []), create: jest.fn().mockResolvedValue({}) },
  };
  const upload = { uploadBase64: jest.fn().mockResolvedValue('https://cdn/service/1.jpg') };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined), notifyMany: jest.fn().mockResolvedValue(undefined) };
  const telegram = { createForServiceVisit: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receiptReader = { read: jest.fn().mockResolvedValue({ is_receipt: true, total_sum: 700_000, confidence: 'high' }) };
  const svc = new ServiceService(prisma as any, upload as any, notifications as any, telegram as any, receiptReader as any);
  return { svc, prisma, tx, upload, notifications, telegram };
}

describe('ServiceService — opening a visit', () => {
  it('a request waits for admin, with its date, and staff are told', async () => {
    const { svc, prisma, notifications } = makeService();
    const v = await svc.createVisit({ origin: 'request', works: [{ reason_id: 'r-oil' }], scheduled_at: '2026-09-23T05:00:00.000Z' }, driverActor);
    expect(prisma.serviceVisit.create.mock.calls[0][0].data).toMatchObject({ origin: 'request', status: 'requested', vehicleId: 'veh1', driverId: 'drv1' });
    expect(v.items.map((i) => i.name)).toEqual(['Moy almashtirish']);
    expect(notifications.notifyMany).toHaveBeenCalledWith(['u-admin'], expect.objectContaining({ type: 'service_request' }));
  });

  it('an emergency is already happening: in progress from the first second, order noted', async () => {
    const { svc, prisma, notifications } = makeService();
    await svc.createVisit({ origin: 'emergency', works: [{ reason_id: 'r-tyre' }], order_id: 'o38' }, driverActor);
    const data = prisma.serviceVisit.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ origin: 'emergency', status: 'in_progress', orderId: 'o38' });
    expect(data.startedAt).toBeInstanceOf(Date);
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('a work typed on the spot becomes a pending reason the driver owns', async () => {
    const { svc, prisma } = makeService();
    const v = await svc.createVisit({ origin: 'emergency', works: [{ custom_name: 'Old oyna nasosi' }] }, driverActor);
    expect(prisma.serviceReason.create).toHaveBeenCalledWith({ data: { name: 'Old oyna nasosi', approved: false, createdByDriverId: 'drv1' } });
    expect(v.items[0].name).toBe('Old oyna nasosi');
  });

  it('a work typed in small letters is kept with a capital first (owner, 11.11.2026)', async () => {
    const { svc, prisma } = makeService();
    await svc.createVisit({ origin: 'emergency', works: [{ custom_name: '  old oynani almashtirish' }] }, driverActor);
    expect(prisma.serviceReason.create).toHaveBeenCalledWith({ data: { name: 'Old oynani almashtirish', approved: false, createdByDriverId: 'drv1' } });
  });

  it("a driver may use their own suggestions, never another driver's", async () => {
    const { svc } = makeService();
    await expect(svc.createVisit({ origin: 'emergency', works: [{ reason_id: 'r-mine' }] }, driverActor)).resolves.toBeTruthy();
    await expect(svc.createVisit({ origin: 'emergency', works: [{ reason_id: 'r-others' }] }, driverActor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('admin assigns: approved from the start, the driver is told', async () => {
    const { svc, prisma, notifications } = makeService();
    await svc.assignVisit({ vehicle_id: 'veh1', works: [{ reason_id: 'r-oil' }], scheduled_at: '2026-09-23T04:00:00.000Z' }, admin);
    expect(prisma.serviceVisit.create.mock.calls[0][0].data).toMatchObject({ origin: 'assigned', status: 'approved', assignedById: 'u-admin', decidedById: 'u-admin', driverId: 'drv1' });
    expect(notifications.notify).toHaveBeenCalledWith('u-driver', expect.objectContaining({ type: 'service_assigned' }));
  });
});

describe('ServiceService — yes or no', () => {
  it('approve: requested → approved, driver notified', async () => {
    const { svc, prisma, notifications } = makeService();
    await svc.approve('v1', admin);
    expect(prisma.serviceVisit.update.mock.calls[0][0].data).toMatchObject({ status: 'approved', decidedById: 'u-admin' });
    expect(notifications.notify).toHaveBeenCalledWith('u-driver', expect.objectContaining({ type: 'service_approved' }));
  });

  it('decline carries the reason to the driver', async () => {
    const { svc, notifications } = makeService();
    await svc.decline('v1', { reason: 'Ertaga emas, juma' }, admin);
    expect(notifications.notify).toHaveBeenCalledWith('u-driver', expect.objectContaining({ type: 'service_declined', body: expect.stringContaining('juma') }));
  });

  it('only a requested visit can be decided', async () => {
    const { svc } = makeService({ visit: visitRow({ status: 'approved' }) });
    await expect(svc.approve('v1', admin)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.decline('v1', {}, admin)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ServiceService — arriving, photographing, completing', () => {
  const approved = () => visitRow({ status: 'approved' });

  it('start runs the fence check against the centres and moves to in_progress', async () => {
    const { svc, prisma } = makeService({ visit: approved() });
    const v = await svc.start('v1', { center_id: 'c1', captured_at: new Date().toISOString(), position: { ...north(40), accuracy_m: 8 } }, driverActor);
    const data = prisma.serviceVisit.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'in_progress', selectedCenterId: 'c1', resolvedCenterId: 'c1', outcome: 'matched' });
    expect(v.outcome).toBe('matched');
  });

  it("Ko'cha path: no centre, fence finds none → unlisted", async () => {
    const { svc, prisma } = makeService({ visit: approved() });
    await svc.start('v1', { center_id: null, captured_at: new Date().toISOString(), position: { lat: 41.30, lng: 69.28 } }, driverActor);
    expect(prisma.serviceVisit.update.mock.calls[0][0].data.outcome).toBe('unlisted');
  });

  it('a requested visit cannot be started — admin has not said yes', async () => {
    const { svc } = makeService();
    await expect(svc.start('v1', { captured_at: new Date().toISOString(), position: null }, driverActor)).rejects.toBeInstanceOf(ConflictException);
  });

  it("another driver's visit is not yours to start", async () => {
    const { svc } = makeService({ visit: visitRow({ status: 'approved', driverId: 'drv9' }) });
    await expect(svc.start('v1', { captured_at: new Date().toISOString(), position: null }, driverActor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a photo attaches to its item', async () => {
    const { svc, prisma, upload } = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date() }) });
    await svc.itemPhoto('v1', 'i1', 'aGVsbG8=', driverActor);
    expect(upload.uploadBase64).toHaveBeenCalledWith('aGVsbG8=', 'service-visits');
    expect(prisma.serviceVisitItem.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { photoUrl: 'https://cdn/service/1.jpg', photoUrls: ['https://cdn/service/1.jpg'] },
    });
  });

  it('two photos per work: the second goes in its own slot, a retake replaces only its slot (owner, 11.11.2026)', async () => {
    const items = [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'https://cdn/a.jpg', photoUrls: ['https://cdn/a.jpg'], costSum: null, position: 0 }];
    const { svc, prisma } = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date(), items }) });
    await svc.itemPhoto('v1', 'i1', 'aGVsbG8=', driverActor, 1);
    expect(prisma.serviceVisitItem.update).toHaveBeenLastCalledWith({
      where: { id: 'i1' },
      data: { photoUrl: 'https://cdn/a.jpg', photoUrls: ['https://cdn/a.jpg', 'https://cdn/service/1.jpg'] },
    });
    // Slot 0 again: only the first is replaced.
    await svc.itemPhoto('v1', 'i1', 'aGVsbG8=', driverActor, 0);
    expect(prisma.serviceVisitItem.update.mock.calls[1][0].data.photoUrls[0]).toBe('https://cdn/service/1.jpg');
  });

  it('completing refuses while a work has no photo, and says which', async () => {
    const { svc } = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date() }) });
    await expect(svc.complete('v1', { odometer_km: 30_240, total_sum: 640_000, no_receipt: true }, driverActor)).rejects.toMatchObject({ response: { message: 'service_items_missing_photo', items: ['i1'] } });
  });

  it('completing writes the km, moves every work forward, files the settlement', async () => {
    const inProgress = visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'matched', resolvedCenterId: 'c1',
      items: [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 }, { id: 'i2', visitId: 'v1', reasonId: null, name: 'Nasos', photoUrl: 'u', costSum: null, position: 1 }] });
    const { svc, tx, upload } = makeService({ visit: inProgress });
    const v = await svc.complete('v1', { odometer_km: 30_240, total_sum: 640_000, receipt_photo_base64: 'cmVj', no_receipt: false, item_costs: [{ item_id: 'i1', cost_sum: 350_000 }] }, driverActor);
    expect(upload.uploadBase64).toHaveBeenCalledWith('cmVj', 'service-receipts');
    // Only the catalogue work moves a schedule; the typed-in one has none.
    expect(tx.vehicleServiceState.upsert).toHaveBeenCalledTimes(1);
    expect(tx.vehicleServiceState.upsert.mock.calls[0][0].create).toMatchObject({ vehicleId: 'veh1', reasonId: 'r-oil', lastDoneKm: 30_240, lastVisitId: 'v1' });
    expect(tx.kmRecord.create).toHaveBeenCalledWith({ data: { vehicleId: 'veh1', km: 30_240, recordedById: 'u-driver', needsReview: false } });
    expect(tx.vehicle.update).toHaveBeenCalledWith({ where: { id: 'veh1' }, data: { currentKm: 30_240 } });
    expect(tx.serviceVisitItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { costSum: 350_000 } });
    expect(tx.serviceVisit.update.mock.calls[0][0].data).toMatchObject({ status: 'completed', odometerKm: 30_240, totalSum: 640_000, noReceipt: false, settlement: 'station_invoice' });
    // No earlier record of this work: nothing to measure against.
    expect(tx.serviceVisitItem.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ remainingKmAtVisit: expect.anything() }) }));
    expect(v.status).toBe('completed');
  });

  it('no odometer typed (owner, 11.11.2026): the work is done at the lorry km, no km record is written', async () => {
    const items = [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 }];
    const { svc, tx } = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'matched', resolvedCenterId: 'c1', items }) });
    await svc.complete('v1', { total_sum: 100_000, no_receipt: true }, driverActor);
    expect(tx.kmRecord.create).not.toHaveBeenCalled();
    expect(tx.vehicleServiceState.upsert.mock.calls[0][0].create).toMatchObject({ lastDoneKm: 30_200 });
    expect(tx.serviceVisit.update.mock.calls[0][0].data).toMatchObject({ odometerKm: 30_200, receiptReadSum: null });
  });

  it('the receipt is read by the AI and its total kept beside the typed one (owner, 11.11.2026)', async () => {
    const items = [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 }];
    const { svc, tx } = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'matched', resolvedCenterId: 'c1', items }) });
    const v = await svc.complete('v1', { total_sum: 640_000, receipt_photo_base64: 'cmVj', no_receipt: false }, driverActor);
    expect(tx.serviceVisit.update.mock.calls[0][0].data).toMatchObject({ totalSum: 640_000, receiptReadSum: 700_000 });
    expect(v.receipt_read_sum).toBe(700_000);
  });

  it('completing records how many km were left (early) or overdue (late)', async () => {
    const items = [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 }];
    const early = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'matched', resolvedCenterId: 'c1', items }), prevState: { lastDoneKm: 20_000 } });
    await early.svc.complete('v1', { odometer_km: 29_200, total_sum: 100_000, no_receipt: true }, driverActor);
    expect(early.tx.serviceVisitItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { remainingKmAtVisit: 800 } });
    const late = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'matched', resolvedCenterId: 'c1', items }), prevState: { lastDoneKm: 20_000 } });
    await late.svc.complete('v1', { odometer_km: 31_500, total_sum: 100_000, no_receipt: true }, driverActor);
    expect(late.tx.serviceVisitItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { remainingKmAtVisit: -1_500 } });
  });

  it("the driver's word travels with the visit, and the photos go to the service group", async () => {
    const inProgress = visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'matched', items: [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 }] });
    const { svc, tx, telegram } = makeService({ visit: inProgress });
    await svc.complete('v1', { odometer_km: 30_240, total_sum: 1, no_receipt: true, comment: '  Eski qism ustada qoldi ' }, driverActor);
    expect(tx.serviceVisit.update.mock.calls[0][0].data).toMatchObject({ driverComment: 'Eski qism ustada qoldi' });
    expect(telegram.createForServiceVisit).toHaveBeenCalledTimes(1);
  });

  it('"no receipt" is a recorded fact, not a missing photo', async () => {
    const { svc, tx } = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'unlisted', items: [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 }] }) });
    await svc.complete('v1', { odometer_km: 30_240, total_sum: 200_000, no_receipt: true }, driverActor);
    expect(tx.serviceVisit.update.mock.calls[0][0].data).toMatchObject({ noReceipt: true, receiptPhotoUrl: null, settlement: 'driver_reimbursement' });
  });

  it('an odometer lower than the vehicle already has does not roll the vehicle back', async () => {
    const { svc, tx } = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'matched', items: [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 }] }) });
    await svc.complete('v1', { odometer_km: 29_000, total_sum: 1, no_receipt: true }, driverActor);
    expect(tx.vehicle.update).not.toHaveBeenCalled();
    expect(tx.kmRecord.create).toHaveBeenCalled();
  });
});

describe('ServiceService — what is due and who gets told', () => {
  const NOON = new Date('2026-11-06T09:00:00Z'); // 14:00 Tashkent
  it('lists each scheduled work per vehicle with its remaining km, most urgent first', async () => {
    const { svc } = makeService({ states: [{ vehicleId: 'veh1', reasonId: 'r-oil', lastDoneKm: 25_000 }] });
    const due = await svc.due();
    expect(due).toHaveLength(1); // TYRE has no interval, MINE/OTHERS unapproved
    expect(due[0]).toMatchObject({ vehicle_plate: '40A400AA', reason_name: 'Moy almashtirish', current_km: 30_200, due_km: 35_000, remaining_km: 4_800, reminders_sent: 0, open_visit_id: null });
  });

  it('sends the due-soon push once and records it', async () => {
    const { svc, prisma, notifications } = makeService({ states: [{ vehicleId: 'veh1', reasonId: 'r-oil', lastDoneKm: 20_600 }] }); // 400 km left
    expect(await svc.sendDueReminders(NOON)).toBe(1);
    expect(notifications.notify).toHaveBeenCalledWith('u-driver', expect.objectContaining({ type: 'service_due_soon', body: expect.stringContaining('400') }));
    // The dispatcher is told too, with the lorry and the km (owner, 06.11.2026).
    expect(notifications.notifyMany).toHaveBeenCalledWith(['u-admin'], expect.objectContaining({ type: 'service_due_soon', body: expect.stringContaining('40A400AA (Hamza): Moy almashtirish') }));
    expect(prisma.serviceReminder.create.mock.calls[0][0].data).toMatchObject({ vehicleId: 'veh1', reasonId: 'r-oil', kind: 'due_soon', kmAtSend: 30_200 });
  });

  it('sends nothing when the driver already has a visit for that work', async () => {
    const { svc, notifications } = makeService({
      states: [{ vehicleId: 'veh1', reasonId: 'r-oil', lastDoneKm: 20_600 }],
      openVisits: [{ id: 'v1', status: 'requested', vehicleId: 'veh1', items: [{ reasonId: 'r-oil' }] }],
    });
    expect(await svc.sendDueReminders(NOON)).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('sends nothing twice', async () => {
    const { svc, notifications } = makeService({
      states: [{ vehicleId: 'veh1', reasonId: 'r-oil', lastDoneKm: 20_600 }],
      reminders: [{ vehicleId: 'veh1', reasonId: 'r-oil', kind: 'due_soon', sentAt: NOON, cycleKm: 20_600 }],
    });
    expect(await svc.sendDueReminders(NOON)).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('after the service is done, the next cycle gets its own due-soon reminder', async () => {
    // The oil was last changed at 20 900 and the vehicle is at 30 200, so the
    // next change is 700 km away. Both reminders on file belong to the cycle
    // before that one (10 900) and must not silence this cycle's.
    const { svc, notifications, prisma } = makeService({
      states: [{ vehicleId: 'veh1', reasonId: 'r-oil', lastDoneKm: 20_600 }],
      reminders: [
        { vehicleId: 'veh1', reasonId: 'r-oil', kind: 'due_soon', sentAt: new Date(), cycleKm: 10_900 },
        { vehicleId: 'veh1', reasonId: 'r-oil', kind: 'overdue', sentAt: new Date(), cycleKm: 10_900 },
      ],
    });
    expect(await svc.sendDueReminders(NOON)).toBe(1);
    expect(notifications.notify).toHaveBeenCalledWith('u-driver', expect.objectContaining({ type: 'service_due_soon' }));
    expect(prisma.serviceReminder.create.mock.calls[0][0].data).toMatchObject({ kind: 'due_soon', cycleKm: 20_600 });
  });

  it("sends the day's reminder from 09:00 Tashkent, not at night", async () => {
    const { svc, notifications } = makeService({ states: [{ vehicleId: 'veh1', reasonId: 'r-oil', lastDoneKm: 20_600 }] });
    expect(await svc.sendDueReminders(new Date('2026-11-06T02:00:00Z'))).toBe(0); // 07:00
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('ServiceService — the money', () => {
  it('admin corrects a total, keeping the driver\'s as the original', async () => {
    const { svc, prisma } = makeService({ visit: visitRow({ status: 'completed', totalSum: 640_000 }) });
    await svc.correctTotal('v1', { total_sum: 600_000 }, admin);
    expect(prisma.serviceVisit.updateMany.mock.calls[0][0].data).toMatchObject({ totalSum: 600_000, originalTotalSum: 640_000, reviewedById: 'u-admin' });
  });

  it('a paid visit is closed to corrections and re-settlement', async () => {
    const { svc } = makeService({ visit: visitRow({ status: 'completed', settlement: 'station_invoice', settledAt: new Date() }) });
    await expect(svc.correctTotal('v1', { total_sum: 1 }, admin)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.settle('v1', { settlement: 'driver_reimbursement' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('filing under a centre makes it the resolved one', async () => {
    const { svc, prisma } = makeService({ visit: visitRow({ status: 'completed', outcome: 'mismatch' }) });
    await svc.settle('v1', { settlement: 'station_invoice', center_id: 'c1' });
    expect(prisma.serviceVisit.updateMany.mock.calls[0][0].data).toEqual({ settlement: 'station_invoice', resolvedCenterId: 'c1' });
  });

  it('filing as invoice without naming a centre uses the one the fence found — or refuses', async () => {
    const found = makeService({ visit: visitRow({ status: 'completed', outcome: 'matched', resolvedCenterId: 'c1' }) });
    await found.svc.settle('v1', { settlement: 'station_invoice' });
    expect(found.prisma.serviceVisit.updateMany.mock.calls[0][0].data).toEqual({ settlement: 'station_invoice', resolvedCenterId: 'c1' });
    const none = makeService({ visit: visitRow({ status: 'completed', outcome: 'unlisted' }) });
    await expect(none.svc.settle('v1', { settlement: 'station_invoice' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ServiceService — cancelling', () => {
  const item = (photoUrl: string | null) => [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl, costSum: null, position: 0 }];

  it('a driver drops their own request, even once approved, and staff hear about the approved one', async () => {
    const waiting = makeService({ visit: visitRow({ status: 'requested' }) });
    await waiting.svc.cancel('v1', driverActor);
    expect(waiting.notifications.notifyMany).not.toHaveBeenCalled();
    const approved = makeService({ visit: visitRow({ status: 'approved' }) });
    await approved.svc.cancel('v1', driverActor);
    expect(approved.notifications.notifyMany).toHaveBeenCalledWith(['u-admin'], expect.objectContaining({ type: 'service_cancelled' }));
  });

  it('an emergency opened by mistake can be undone until the first photo', async () => {
    const clean = makeService({ visit: visitRow({ origin: 'emergency', status: 'in_progress', items: item(null) }) });
    await expect(clean.svc.cancel('v1', driverActor)).resolves.toMatchObject({ status: 'cancelled' });
    const started = makeService({ visit: visitRow({ origin: 'emergency', status: 'in_progress', items: item('u') }) });
    await expect(started.svc.cancel('v1', driverActor)).rejects.toBeInstanceOf(ConflictException);
  });

  it("what admin assigned is not the driver's to cancel — but admin may", async () => {
    const asDriver = makeService({ visit: visitRow({ origin: 'assigned', status: 'approved' }) });
    await expect(asDriver.svc.cancel('v1', driverActor)).rejects.toBeInstanceOf(ConflictException);
    const asAdmin = makeService({ visit: visitRow({ origin: 'assigned', status: 'approved' }) });
    await expect(asAdmin.svc.cancel('v1', admin)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('a completed visit is history, not cancellable by anyone', async () => {
    const { svc } = makeService({ visit: visitRow({ status: 'completed' }) });
    await expect(svc.cancel('v1', admin)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ServiceService — changing the works on an open visit', () => {
  const two = () => [
    { id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 },
    { id: 'i2', visitId: 'v1', reasonId: null, name: 'Nasos', photoUrl: null, costSum: null, position: 1 },
  ];

  it('the mechanic finds one more thing: a catalogue work or a typed one joins the list', async () => {
    const { svc, prisma } = makeService({ visit: visitRow({ status: 'in_progress', items: two() }) });
    await svc.addItem('v1', { reason_id: 'r-tyre' }, driverActor);
    expect(prisma.serviceVisitItem.create.mock.calls[0][0].data).toMatchObject({ visitId: 'v1', reasonId: 'r-tyre', name: 'Shina almashtirish', position: 2 });
    await svc.addItem('v1', { custom_name: 'Chiroq' }, driverActor);
    expect(prisma.serviceReason.create).toHaveBeenCalledWith({ data: { name: 'Chiroq', approved: false, createdByDriverId: 'drv1' } });
  });

  it('the same work is not added twice', async () => {
    const { svc } = makeService({ visit: visitRow({ status: 'in_progress', items: two() }) });
    await expect(svc.addItem('v1', { reason_id: 'r-oil' }, driverActor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a work that turns out unnecessary is removed — but never the last one', async () => {
    const { svc, prisma } = makeService({ visit: visitRow({ status: 'in_progress', items: two() }) });
    await svc.removeItem('v1', 'i2', driverActor);
    expect(prisma.serviceVisitItem.delete).toHaveBeenCalledWith({ where: { id: 'i2' } });
    const one = makeService({ visit: visitRow({ status: 'in_progress' }) });
    await expect(one.svc.removeItem('v1', 'i1', driverActor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a completed visit is history: nothing added or removed', async () => {
    const { svc } = makeService({ visit: visitRow({ status: 'completed', items: two() }) });
    await expect(svc.addItem('v1', { reason_id: 'r-tyre' }, driverActor)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.removeItem('v1', 'i2', driverActor)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ServiceService — reading a visit', () => {
  it("a driver reads their own visit, not another driver's; staff read any", async () => {
    const own = makeService();
    await expect(own.svc.getVisit('v1', driverActor)).resolves.toMatchObject({ id: 'v1' });
    const other = makeService({ visit: visitRow({ driverId: 'drv9' }) });
    await expect(other.svc.getVisit('v1', driverActor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(other.svc.getVisit('v1', admin)).resolves.toMatchObject({ id: 'v1' });
  });
});

describe('ServiceService — twice at once (audit, 07.11.2026)', () => {
  const done = [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 }];

  it('a second complete loses the claim: refused, no second km record', async () => {
    const { svc, tx } = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'matched', items: done }) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tx.serviceVisit as any).updateMany = jest.fn().mockResolvedValue({ count: 0 });
    await expect(svc.complete('v1', { odometer_km: 30_240, total_sum: 1, no_receipt: true }, driverActor)).rejects.toThrow('service_visit_not_in_progress');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tx.serviceVisit as any).updateMany).toHaveBeenCalledWith({ where: { id: 'v1', status: 'in_progress' }, data: { status: 'completed' } });
    expect(tx.kmRecord.create).not.toHaveBeenCalled();
    expect(tx.vehicleServiceState.upsert).not.toHaveBeenCalled();
  });

  it('paying a driver twice: the second call pays nothing', async () => {
    const { svc, prisma } = makeService({ openVisits: [{ id: 'v1', totalSum: 200_000 }, { id: 'v2', totalSum: 50_000 }] });
    prisma.serviceVisit.updateMany = jest.fn().mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 0 });
    expect(await svc.payDriver('drv1', new Date())).toEqual({ paid: 2, total_sum: 250_000 });
    expect(await svc.payDriver('drv1', new Date())).toEqual({ paid: 0, total_sum: 0 });
    expect(prisma.serviceVisit.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ['v1', 'v2'] }, settledAt: null });
  });

  it('a correction or a settlement racing a payment is refused', async () => {
    const { svc, prisma } = makeService({ visit: visitRow({ status: 'completed', totalSum: 640_000, outcome: 'matched', resolvedCenterId: 'c1' }) });
    prisma.serviceVisit.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    await expect(svc.correctTotal('v1', { total_sum: 1 }, admin)).rejects.toThrow('service_visit_already_paid');
    await expect(svc.settle('v1', { settlement: 'driver_reimbursement' })).rejects.toThrow('service_visit_already_paid');
    expect(prisma.serviceVisit.updateMany.mock.calls[0][0].where).toEqual({ id: 'v1', settledAt: null });
  });
});

describe('ServiceService — an odometer far ahead (owner, 07.11.2026)', () => {
  it('more than 10 000 km above the vehicle: visit saved, reading flagged, km and schedule unchanged, staff told', async () => {
    const items = [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 }];
    const { svc, tx, prisma, notifications } = makeService({
      visit: visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'matched', items }),
      prevState: { lastDoneKm: 25_000 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user as any).findUnique = jest.fn().mockResolvedValue({ name: 'Bobur' });
    const v = await svc.complete('v1', { odometer_km: 302_400, total_sum: 1, no_receipt: true }, driverActor);
    expect(v.odometer_km).toBe(302_400);
    expect(tx.kmRecord.create.mock.calls[0][0].data).toMatchObject({ km: 302_400, needsReview: true });
    expect(tx.vehicle.update).not.toHaveBeenCalled();
    // The schedule stays on the lorry's own km.
    expect(tx.vehicleServiceState.upsert.mock.calls[0][0].update.lastDoneKm).toBe(30_200);
    expect(tx.serviceVisitItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { remainingKmAtVisit: 25_000 + 10_000 - 30_200 } }));
    expect(notifications.notifyMany).toHaveBeenCalledWith(['u-admin'], {
      type: 'km_needs_review',
      title: 'Spidometrni tekshiring',
      body: "40A400AA (Bobur): spidometrda 302 400 km kiritildi, oldingisi 30 200 km — farq 272 200 km. Rasmni tekshirib, to'g'ri km'ni Transport → mashina sahifasida kiriting.",
    });
  });

  it('within 10 000 km: taken as the lorry km, nobody told', async () => {
    const items = [{ id: 'i1', visitId: 'v1', reasonId: 'r-oil', name: 'Moy', photoUrl: 'u', costSum: null, position: 0 }];
    const { svc, tx, notifications } = makeService({ visit: visitRow({ status: 'in_progress', capturedAt: new Date(), outcome: 'matched', items }) });
    await svc.complete('v1', { odometer_km: 30_240, total_sum: 1, no_receipt: true }, driverActor);
    expect(tx.kmRecord.create.mock.calls[0][0].data).toMatchObject({ needsReview: false });
    expect(tx.vehicle.update).toHaveBeenCalledWith({ where: { id: 'veh1' }, data: { currentKm: 30_240 } });
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });
});
