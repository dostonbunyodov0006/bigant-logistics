import { ClientsService } from './clients.service';

const admin = { userId: 'u1', role: 'admin' as const };

const row = {
  id: 'c1', name: 'Barakat', phoneNumber: '+998901234567', address: null, location: null,
  regionCode: '1726', districtCode: '1726-01', lat: 41.2995, lng: 69.2401,
  region: { name: 'Toshkent sh.', isCity: true }, district: { name: 'Chilonzor' },
  createdById: 'u1', sellerId: null, seller: null, createdAt: new Date(), updatedAt: new Date(),
};

function makeService() {
  const prisma = {
    client: {
      create: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
      findUnique: jest.fn().mockResolvedValue(row),
    },
    // Editing the client's own place keeps its default address in step; the
    // address rules have their own spec.
    clientAddress: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new ClientsService(prisma as any), prisma };
}

describe('ClientsService — coordinates', () => {
  it('persists the pin on create and exposes it on the public shape', async () => {
    const { service, prisma } = makeService();
    const out = await service.create(
      { name: 'Barakat', phone_number: '+998901234567', region_code: '1726', district_code: '1726-01', lat: 41.2995, lng: 69.2401 },
      admin,
    );
    expect(prisma.client.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ lat: 41.2995, lng: 69.2401 }),
    );
    expect(out).toEqual(expect.objectContaining({ lat: 41.2995, lng: 69.2401 }));
  });

  it('stores null, not undefined or 0, when a legacy create sends no pin', async () => {
    const { service, prisma } = makeService();
    await service.create({ name: 'B', phone_number: '+998901234567', region_code: '1726', district_code: '1726-01' }, admin);
    const data = prisma.client.create.mock.calls[0][0].data;
    expect(data.lat).toBeNull();
    expect(data.lng).toBeNull();
  });

  it('moves the pin on update only when a pair is sent, and never touches it otherwise', async () => {
    const { service, prisma } = makeService();
    await service.update('c1', { lat: 41.31, lng: 69.28 }, admin);
    expect(prisma.client.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ lat: 41.31, lng: 69.28 }),
    );
    await service.update('c1', { name: 'Renamed' }, admin);
    const data = prisma.client.update.mock.calls[1][0].data;
    // A rename must not clear or overwrite an existing pin.
    expect('lat' in data).toBe(false);
    expect('lng' in data).toBe(false);
  });
});
