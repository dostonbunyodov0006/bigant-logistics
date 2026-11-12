import { longStops } from './track-math';
import { NotFoundException } from '@nestjs/common';
import { ReturnsReportService, summarize } from './returns-report.service';
import { DriverAnalyticsService, totalsOf } from './driver-analytics.service';
import { DriverTrackService } from './driver-track.service';

const user = (name: string, status = 'active') => ({ user: { name, status } });

describe('ReturnsReportService', () => {
  it('lists returns with their products and totals over the whole filter', async () => {
    const order = {
      id: 'o1',
      orderNumber: 11,
      status: 'returning',
      clientName: 'Abdulla Qurilish',
      returnDestination: 'warehouse',
      returnReason: 'mijoz olmadi',
      updatedAt: new Date('2026-10-15T07:00:00Z'),
      assignedDriverId: 'd1',
      assignedDriver: user('Hamza'),
      createdBySeller: { name: 'Bekzod' },
      vozvratReport: { status: 'pending' },
      // Taken in at the shop, released by the office (owner, 07.11.2026).
      warehouseReturns: [
        { id: 'w1', destination: 'store', acceptedAt: new Date('2026-10-15T08:00:00Z'), acceptedByName: 'Admin (ofis)', answerComment: null, overallPhotoUrl: null, answer: null },
      ],
      returnItems: [
        {
          id: 'i1', productId: '417', name: 'Sement', unit: 'qop', quantity: '2.500', condition: 'yaroqsiz',
          reasonCode: 'o1', otherReason: null, culprit: 'omborchi', photoUrl: 'https://x/p.jpg',
          createdAt: new Date('2026-10-15T06:30:00Z'),
        },
      ],
    };
    const prisma = {
      order: { findMany: jest.fn().mockResolvedValue([order]), count: jest.fn().mockResolvedValue(1) },
      orderReturnItem: {
        findMany: jest.fn().mockResolvedValue([
          { orderId: 'o1', culprit: 'omborchi', order: { assignedDriverId: 'd1', assignedDriver: user('Hamza') } },
          { orderId: 'o2', culprit: 'mijoz', order: { assignedDriverId: 'd1', assignedDriver: user('Hamza') } },
          { orderId: 'o2', culprit: 'mijoz', order: { assignedDriverId: 'd1', assignedDriver: user('Hamza') } },
        ]),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await new ReturnsReportService(prisma as any).list({ from: '2026-10-01', driver_id: 'd1', culprit: undefined });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      order_number: 11,
      driver_name: 'Hamza',
      seller_name: 'Bekzod',
      returned_at: '2026-10-15T06:30:00.000Z',
      report_status: 'pending',
      items: [{ name: 'Sement', quantity: 2.5, unit: 'qop', culprit: 'omborchi' }],
      warehouses: [{ id: 'w1', destination: 'store', accepted_by: 'Admin (ofis)', accepted_at: '2026-10-15T08:00:00.000Z', items: [] }],
    });
    expect(page.summary).toEqual({
      returns: 2,
      items: 3,
      by_culprit: [{ culprit: 'mijoz', items: 2 }, { culprit: 'omborchi', items: 1 }],
      by_driver: [{ driver_id: 'd1', driver_name: 'Hamza', returns: 2, items: 3 }],
    });
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.assignedDriverId).toBe('d1');
    expect(where.returnItems.some.createdAt.gte).toEqual(new Date('2026-09-30T19:00:00Z'));
  });

  it('summarizes nothing as zeros', () => {
    expect(summarize([])).toEqual({ returns: 0, items: 0, by_culprit: [], by_driver: [] });
  });
});

describe('DriverAnalyticsService', () => {
  it('puts a month of each active driver side by side, busiest first', async () => {
    const prisma = {
      driver: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'd1', ...user('Hamza'), vehicle: { plateNumber: '01 A 777 AA' } },
          { id: 'd2', ...user('Bobur'), vehicle: null },
        ]),
      },
      order: { groupBy: jest.fn().mockResolvedValue([{ assignedDriverId: 'd2', _count: { _all: 7 } }]) },
      orderReturnItem: {
        findMany: jest.fn().mockResolvedValue([
          { orderId: 'o1', order: { assignedDriverId: 'd1' } },
          { orderId: 'o1', order: { assignedDriverId: 'd1' } },
          { orderId: 'o9', order: { assignedDriverId: 'gone' } },
        ]),
      },
      workLog: {
        findMany: jest.fn().mockResolvedValue([
          { driverId: 'd1', clockInAt: new Date('2026-10-01T04:00:00Z'), clockOutAt: new Date('2026-10-01T13:00:00Z'), breakMinutes: 60, isLate: true, lateMinutes: 25, isEarlyLeave: false },
          { driverId: 'd1', clockInAt: new Date('2026-10-02T04:00:00Z'), clockOutAt: null, breakMinutes: 0, isLate: false, lateMinutes: 0, isEarlyLeave: true },
        ]),
      },
      fine: { groupBy: jest.fn().mockResolvedValue([{ driverId: 'd1', _count: { _all: 2 }, _sum: { amount: 150_000 } }]) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await new DriverAnalyticsService(prisma as any).month('2026-10');
    expect(report.rows.map((r) => r.driver_name)).toEqual(['Bobur', 'Hamza']);
    expect(report.rows[1]).toEqual({
      driver_id: 'd1',
      driver_name: 'Hamza',
      driver_active: true,
      vehicle_plate: '01 A 777 AA',
      delivered: 0,
      returns: 1,
      return_items: 2,
      shifts: 2,
      worked_minutes: 480,
      late: 1,
      late_minutes: 25,
      early_leave: 1,
      fines: 2,
      fines_amount: 150_000,
    });
    expect(report.totals).toMatchObject({ delivered: 7, returns: 1, return_items: 2, shifts: 2, fines_amount: 150_000 });
    expect(prisma.order.groupBy.mock.calls[0][0].where.deliveredAt).toEqual({
      gte: new Date('2026-09-30T19:00:00Z'),
      lt: new Date('2026-10-31T19:00:00Z'),
    });
  });

  it('totals an empty month as zeros', () => {
    expect(totalsOf([]).delivered).toBe(0);
  });
});

describe('DriverTrackService', () => {
  const config = { get: (k: string) => ({ TRACK_RETENTION_DAYS: 31, WORKER_ENABLED: false, NODE_ENV: 'test' })[k] };

  it('returns the day as a trail with its length', async () => {
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', ...user('Hamza') }) },
      driverLocationPing: {
        findMany: jest.fn().mockResolvedValue([
          { lat: 41.2995, lng: 69.2401, recordedAt: new Date('2026-10-15T03:00:00Z') },
          { lat: 41.3095, lng: 69.2401, recordedAt: new Date('2026-10-15T03:10:00Z') },
        ]),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const track = await new DriverTrackService(prisma as any, config as any).track('d1', '2026-10-15');
    expect(track).toMatchObject({ driver_name: 'Hamza', date: '2026-10-15', first_at: '2026-10-15T03:00:00.000Z', last_at: '2026-10-15T03:10:00.000Z' });
    expect(track.points).toHaveLength(2);
    expect(track.distance_km).toBeCloseTo(1.1, 1);
    expect(prisma.driverLocationPing.findMany.mock.calls[0][0].where.recordedAt).toEqual({
      gte: new Date('2026-10-14T19:00:00Z'),
      lt: new Date('2026-10-15T19:00:00Z'),
    });
  });

  it('404s an unknown driver and prunes by the retention window', async () => {
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue(null) },
      driverLocationPing: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new DriverTrackService(prisma as any, config as any);
    await expect(service.track('nope', '2026-10-15')).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.prune(new Date('2026-10-15T00:00:00Z'))).toBe(4);
    expect(prisma.driverLocationPing.deleteMany.mock.calls[0][0].where.recordedAt.lt).toEqual(new Date('2026-09-14T00:00:00Z'));
  });
});

describe('longStops', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 2, 5, min)).toISOString();
  const here = { lat: 41.3, lng: 69.2 };
  const there = { lat: 41.31, lng: 69.2 };

  it('finds where he stood 10 minutes or more, and passes over short waits', () => {
    const stops = longStops([
      { ...here, at: at(0) },
      { ...here, at: at(5) },
      { ...there, at: at(8) },
      { ...there, at: at(12) },
      { ...there, at: at(20) },
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ minutes: 12, lat: 41.31 });
  });

  it('does not take a phone switched off for standing', () => {
    expect(longStops([{ ...here, at: at(0) }, { ...here, at: at(40) }])).toEqual([]);
  });
});
