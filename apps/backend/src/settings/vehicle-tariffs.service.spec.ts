import { VehicleTariffsService } from './vehicle-tariffs.service';

function makeService(rows: Record<string, unknown>[] = []) {
  const prisma = {
    vehicleTariff: {
      findMany: jest.fn().mockResolvedValue(rows),
      upsert: jest.fn().mockResolvedValue({}),
    },
    // saveAll passes an array of upsert promises into $transaction.
    $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new VehicleTariffsService(prisma as any), prisma };
}

describe('VehicleTariffsService', () => {
  it('returns all three classes, defaulting missing ones to zero', async () => {
    const { service } = makeService([
      {
        category: 'katta',
        dailyWageSom: 160000,
        pickupCitySom: 20000,
        pickupOutsideSom: 40000,
        deliveryCitySom: 20000,
        deliveryOutsideSom: 40000,
      },
    ]);
    const { tariffs } = await service.getAll();
    expect(tariffs.map((t) => t.category)).toEqual(['katta', 'orta', 'kichik']);
    expect(tariffs[0]).toMatchObject({ category: 'katta', daily_wage_som: 160000, pickup_outside_som: 40000 });
    // Unsaved classes come back as all-zero, never persisted.
    expect(tariffs[1]).toMatchObject({ category: 'orta', daily_wage_som: 0, delivery_city_som: 0 });
  });

  it('upserts every submitted class within one transaction', async () => {
    const { service, prisma } = makeService();
    await service.saveAll({
      tariffs: [
        {
          category: 'kichik',
          daily_wage_som: 160000,
          pickup_city_som: 10000,
          pickup_outside_som: 20000,
          delivery_city_som: 50000,
          delivery_outside_som: 100000,
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.vehicleTariff as any).upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category: 'kichik' },
        update: expect.objectContaining({ deliveryOutsideSom: 100000, pickupCitySom: 10000 }),
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma as any).$transaction).toHaveBeenCalled();
  });
});
