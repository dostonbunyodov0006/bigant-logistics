import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientAddressesService } from './client-addresses.service';

/**
 * The rule that matters here: a client always has somewhere to deliver to, and
 * an order can only be sent to a place that belongs to that client.
 */

const STAFF = { userId: 'admin1', role: 'admin' as const };
const SELLER = { userId: 'seller1', role: 'seller' as const };

const address = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  clientId: 'c1',
  label: 'Chilonzor filiali',
  address: 'Bunyodkor 12',
  lat: 41.3,
  lng: 69.2,
  regionCode: 'tashkent-city',
  districtCode: 'chilonzor',
  isDefault: true,
  active: true,
  region: { name: 'Toshkent shahri' },
  district: { name: 'Chilonzor' },
  ...over,
});

function make(opts: {
  client?: Record<string, unknown> | null;
  addresses?: Record<string, unknown>[];
  one?: Record<string, unknown> | null;
  count?: number;
  activeCount?: number;
} = {}) {
  const tx = {
    clientAddress: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(address({ ...data, region: null, district: null }))),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(address({ ...data }))),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    client: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    client: {
      findUnique: jest
        .fn()
        .mockResolvedValue('client' in opts ? opts.client : { id: 'c1', sellerId: 'seller1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    clientAddress: {
      findMany: jest.fn().mockResolvedValue(opts.addresses ?? [address()]),
      findFirst: jest.fn().mockResolvedValue('one' in opts ? opts.one : address()),
      findUnique: jest.fn().mockResolvedValue('one' in opts ? opts.one : address()),
      count: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(where?.active ? (opts.activeCount ?? 2) : (opts.count ?? 1)),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new ClientAddressesService(prisma as any), prisma, tx };
}

describe('ClientAddressesService', () => {
  it("lists a client's places with the region spelled out", async () => {
    const { svc } = make();
    const [first] = await svc.list('c1', STAFF);
    expect(first).toMatchObject({
      label: 'Chilonzor filiali',
      region_name: 'Toshkent shahri',
      district_name: 'Chilonzor',
      is_default: true,
    });
  });

  it("another seller's client does not exist, rather than being refused", async () => {
    const { svc } = make({ client: { id: 'c1', sellerId: 'someone-else' } });
    await expect(svc.list('c1', SELLER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the first address of a client is its default, whatever the form said', async () => {
    const { svc, tx } = make({ count: 0 });
    await svc.create('c1', { label: 'Ombor', region_code: 'tashkent-city', lat: 41.3, lng: 69.2 }, STAFF);
    expect(tx.clientAddress.create.mock.calls[0][0].data.isDefault).toBe(true);
  });

  it('a new default stands the old one down, and the client row follows it', async () => {
    const { svc, tx } = make({ count: 2 });
    await svc.create(
      'c1',
      { label: 'Yunusobod', address: 'Amir Temur 1', region_code: 'tashkent-city', lat: 41.36, lng: 69.28, is_default: true },
      STAFF,
    );
    expect(tx.clientAddress.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: 'c1', isDefault: true }, data: { isDefault: false } }),
    );
    // The client's own address fields mirror the default, because older
    // screens and the reports read them there.
    expect(tx.client.update).toHaveBeenCalled();
  });

  it('a second address is not made default on its own', async () => {
    const { svc, tx } = make({ count: 1 });
    await svc.create('c1', { label: 'Sergeli', region_code: 'tashkent-city', lat: 41.2, lng: 69.2 }, STAFF);
    expect(tx.clientAddress.create.mock.calls[0][0].data.isDefault).toBe(false);
    expect(tx.clientAddress.updateMany).not.toHaveBeenCalled();
  });

  it('the default cannot be closed, and neither can the last one standing', async () => {
    const d = make({ one: address({ isDefault: true }) });
    await expect(d.svc.update('a1', { active: false }, STAFF)).rejects.toBeInstanceOf(ConflictException);

    const last = make({ one: address({ isDefault: false }), activeCount: 1 });
    await expect(last.svc.update('a1', { active: false }, STAFF)).rejects.toBeInstanceOf(ConflictException);

    const spare = make({ one: address({ isDefault: false }), activeCount: 3 });
    await expect(spare.svc.update('a1', { active: false }, STAFF)).resolves.toMatchObject({ active: false });
  });

  it('an order with no place named goes to the default', async () => {
    const { svc, prisma } = make();
    const chosen = await svc.forOrder('c1', null);
    expect(chosen?.label).toBe('Chilonzor filiali');
    expect(prisma.clientAddress.findFirst.mock.calls[0][0].orderBy).toEqual([
      { isDefault: 'desc' },
      { createdAt: 'asc' },
    ]);
  });

  it("refuses a place that belongs to another client — the mistyped id case", async () => {
    const { svc } = make({ one: address({ clientId: 'c2' }) });
    await expect(svc.forOrder('c1', 'a1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a closed place for a new order', async () => {
    const { svc } = make({ one: address({ active: false }) });
    await expect(svc.forOrder('c1', 'a1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('a client with no addresses at all yields nothing, not an error', async () => {
    const { svc } = make({ one: null });
    expect(await svc.forOrder('c1', null)).toBeNull();
  });
});

/**
 * The invariant the rest of the feature rests on: a client always has at least
 * one place. It is created with the client, so the list is never empty and the
 * order form always has something to offer.
 */
describe('a client is born with its first address', () => {
  it('create writes the address as a nested create, marked default', async () => {
    const prisma = {
      client: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'c1',
            name: data.name,
            phoneNumber: data.phoneNumber,
            address: data.address,
            location: null,
            regionCode: data.regionCode,
            districtCode: data.districtCode,
            lat: data.lat,
            lng: data.lng,
            region: null,
            district: null,
            createdById: 'u1',
            sellerId: 'u1',
            seller: null,
            addresses: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'seller', status: 'active' }) },
    };
     
    const { ClientsService } = await import('./clients.service');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ClientsService(prisma as any);
    await svc.create(
      {
        name: 'Barakat',
        phone_number: '+998901234567',
        region_code: '1726',
        address: 'Chilonzor 5',
        lat: 41.3,
        lng: 69.2,
      },
      { userId: 'u1', role: 'seller' },
    );
    const data = prisma.client.create.mock.calls[0][0].data;
    expect(data.addresses.create).toMatchObject({
      label: 'Asosiy manzil',
      address: 'Chilonzor 5',
      lat: 41.3,
      lng: 69.2,
      regionCode: '1726',
      isDefault: true,
    });
  });
});
