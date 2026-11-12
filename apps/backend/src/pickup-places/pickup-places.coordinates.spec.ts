import { PickupPlacesService } from './pickup-places.service';

const row = {
  id: 'pp1', name: 'Sklad', address: null, type: 'warehouse', isTemporary: false,
  regionCode: '1726', geoDistrictCode: '1726-01', lat: 41.2856, lng: 69.2034,
  region: { name: 'Toshkent sh.' }, geoDistrict: { name: 'Chilonzor' },
  createdById: 'u1', createdAt: new Date(), updatedAt: new Date(),
};

function makeService() {
  const prisma = {
    pickupPlace: {
      create: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
      findUnique: jest.fn().mockResolvedValue(row),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new PickupPlacesService(prisma as any), prisma };
}

describe('PickupPlacesService — coordinates', () => {
  it('a seller may add a supplier yard but not our shop or warehouse (owner, 06.11.2026)', async () => {
    const { service, prisma } = makeService();
    const base = { name: 'S', region_code: '1726', district_code: '1726-01', lat: 41.2, lng: 69.2 };
    await expect(service.create({ ...base, type: 'warehouse' }, 'u1', 'seller')).rejects.toThrow('pickup_place_type_staff_only');
    await expect(service.create({ ...base, type: 'market' }, 'u1', 'seller')).rejects.toThrow('pickup_place_type_staff_only');
    expect(prisma.pickupPlace.create).not.toHaveBeenCalled();
    await service.create({ ...base, type: 'custom' }, 'u1', 'seller');
    await service.create({ ...base, type: 'market' }, 'u1', 'manager');
    expect(prisma.pickupPlace.create).toHaveBeenCalledTimes(2);
  });

  it('persists the pin on create and exposes it publicly', async () => {
    const { service, prisma } = makeService();
    const out = await service.create(
      { name: 'Sklad', type: 'warehouse', region_code: '1726', district_code: '1726-01', lat: 41.2856, lng: 69.2034 },
      'u1',
      'admin',
    );
    expect(prisma.pickupPlace.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ lat: 41.2856, lng: 69.2034 }),
    );
    expect(out).toEqual(expect.objectContaining({ lat: 41.2856, lng: 69.2034 }));
  });

  it('stores null for a create without a pin', async () => {
    const { service, prisma } = makeService();
    await service.create({ name: 'S', type: 'warehouse', region_code: '1726', district_code: '1726-01' }, 'u1', 'admin');
    expect(prisma.pickupPlace.create.mock.calls[0][0].data.lat).toBeNull();
  });

  it('a region-only patch does not disturb the pin', async () => {
    const { service, prisma } = makeService();
    await service.update('pp1', { region_code: '1727', district_code: '1727-02' });
    const data = prisma.pickupPlace.update.mock.calls[0][0].data;
    expect('lat' in data).toBe(false);
  });
});
