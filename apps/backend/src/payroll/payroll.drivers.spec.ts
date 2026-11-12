import { PayrollService } from './payroll.service';

const RANGE = { from: '2026-10-16', to: '2026-11-15' };

function makeService(over: Record<string, unknown> = {}) {
  const prisma = {
    driver: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'd1', user: { name: 'Elbek', status: 'active' }, vehicle: { plateNumber: '01 S 001 SS', model: 'Isuzu' } },
        { id: 'd2', user: { name: 'Ketgan', status: 'inactive' }, vehicle: null },
        { id: 'd3', user: { name: 'Bekor', status: 'inactive' }, vehicle: null },
      ]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'd1',
        user: { name: 'Elbek' },
        vehicle: { plateNumber: '01 S 001 SS', model: 'Isuzu', category: 'orta' },
      }),
    },
    driverTariffEarning: {
      groupBy: jest.fn().mockResolvedValue([
        { driverId: 'd1', type: 'pickup_city', _sum: { amount: 40_000 }, _count: { _all: 2 } },
        { driverId: 'd1', type: 'pickup_outside', _sum: { amount: 40_000 }, _count: { _all: 1 } },
        { driverId: 'd1', type: 'delivery_city', _sum: { amount: 60_000 }, _count: { _all: 3 } },
        { driverId: 'd2', type: 'delivery_city', _sum: { amount: 20_000 }, _count: { _all: 1 } },
      ]),
      findMany: jest.fn().mockResolvedValue([
        { id: 'e1', type: 'pickup_city', amount: 20_000, earnedAt: new Date('2026-10-20T06:00:00Z'), order: { clientName: 'Aziz' }, pickupSource: { name: 'BIGANT sklad' } },
        { id: 'e2', type: 'delivery_city', amount: 20_000, earnedAt: new Date('2026-10-20T08:00:00Z'), order: { clientName: 'Aziz' }, pickupSource: null },
      ]),
    },
    morningStart: {
      groupBy: jest.fn().mockResolvedValue([{ driverId: 'd1', _sum: { amountSom: 35_000, earlyMinutes: 30 } }]),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'm1',
          day: new Date('2026-10-21T00:00:00Z'),
          pressedAt: new Date('2026-10-21T03:30:00Z'),
          startedAt: new Date('2026-10-21T03:30:00Z'),
          earlyMinutes: 30,
          rateHourSom: 70_000,
          amountSom: 35_000,
        },
      ]),
    },
    eveningOvertime: {
      groupBy: jest.fn().mockResolvedValue([{ driverId: 'd1', _sum: { amountSom: 70_000, minutes: 60 } }]),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'v1',
          dayEndAt: new Date('2026-10-20T13:00:00Z'),
          lastPhotoAt: new Date('2026-10-20T14:00:00Z'),
          minutes: 60,
          rateHourSom: 70_000,
          amountSom: 70_000,
        },
      ]),
    },
    vehicleTariff: {
      findUnique: jest.fn().mockResolvedValue({
        pickupCitySom: 20_000,
        pickupOutsideSom: 40_000,
        deliveryCitySom: 20_000,
        deliveryOutsideSom: 40_000,
      }),
    },
    ...over,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new PayrollService(prisma as any), prisma };
}

describe('Ish haqi — the drivers’ three bonuses', () => {
  it('adds up pickups, deliveries and extra minutes per driver, biggest first', async () => {
    const { service } = makeService();
    const { rows } = await service.listDrivers(RANGE);
    expect(rows[0]).toEqual({
      driver_id: 'd1',
      driver_name: 'Elbek',
      vehicle: '01 S 001 SS · Isuzu',
      plate_number: '01 S 001 SS',
      vehicle_model: 'Isuzu',
      pickup_total: 80_000,
      pickup_count: 3,
      delivery_total: 60_000,
      delivery_count: 3,
      overtime_total: 105_000,
      overtime_minutes: 90,
      total: 245_000,
    });
  });

  it('a driver let go shows only for a period he earned in', async () => {
    const { service } = makeService();
    const ids = (await service.listDrivers(RANGE)).rows.map((r) => r.driver_id);
    expect(ids).toContain('d2');
    expect(ids).not.toContain('d3');
  });

  it('counts the period from the 16th to the end of the 15th, Tashkent days', async () => {
    const { service, prisma } = makeService();
    await service.listDrivers(RANGE);
    expect(prisma.driverTariffEarning.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { earnedAt: { gte: new Date('2026-10-15T19:00:00Z'), lt: new Date('2026-11-15T19:00:00Z') } },
      }),
    );
  });

  it('one driver: each bonus with its day, place, tariff and price; extra hours from–to', async () => {
    const { service } = makeService();
    const d = await service.driverDetail('d1', RANGE);
    expect(d.pickups).toEqual([
      expect.objectContaining({ kind: 'pickup_city', place: 'BIGANT sklad', tariff_som: 20_000, amount_som: 20_000 }),
    ]);
    expect(d.deliveries).toEqual([expect.objectContaining({ kind: 'delivery_city', place: 'Aziz', amount_som: 20_000 })]);
    expect(d.overtime.map((o) => [o.kind, o.started_at, o.ended_at, o.minutes, o.amount_som])).toEqual([
      ['evening', '2026-10-20T13:00:00.000Z', '2026-10-20T14:00:00.000Z', 60, 70_000],
      ['early', '2026-10-21T03:30:00.000Z', '2026-10-21T04:00:00.000Z', 30, 35_000],
    ]);
  });
});
