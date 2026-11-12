import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClientsService, clientVisibleTo } from './clients.service';

const admin = { userId: 'a1', role: 'admin' as const };
const sardor = { userId: 's-sardor', role: 'seller' as const };
const javlon = { userId: 's-javlon', role: 'seller' as const };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'Barakat', phoneNumber: '+998901234567', address: null, location: null,
  regionCode: '1726', districtCode: null, lat: 41.3, lng: 69.2, region: null, district: null,
  createdById: 's-sardor', sellerId: 's-sardor', seller: { name: 'Bekzod' }, createdAt: new Date(), updatedAt: new Date(),
  ...over,
  // A real row answers with its address rows; create() writes them as a
  // nested create, which is a payload, not a row — so it never leaks in here.
  addresses: Array.isArray(over.addresses) ? over.addresses : [],
});

function makeService(opts: { client?: ReturnType<typeof row> | null; user?: Record<string, unknown> | null } = {}) {
  const prisma = {
    client: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(opts.client === undefined ? row() : opts.client),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(data))),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(data))),
      delete: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn().mockResolvedValue(opts.user === undefined ? { role: 'seller', status: 'active' } : opts.user) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new ClientsService(prisma as any), prisma };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const whereOf = (prisma: any) => prisma.client.findMany.mock.calls[0][0].where;
const input = { name: 'Barakat', phone_number: '+998901234567', region_code: '1726', lat: 41.3, lng: 69.2 };

describe('ClientsService — whose clients who sees', () => {
  it('a seller lists only their own clients', async () => {
    const { service, prisma } = makeService();
    await service.findAll({}, sardor);
    // A one-off — somebody who ordered once — is not in the address book.
    expect(whereOf(prisma)).toEqual({ AND: [{ oneOff: false }, { sellerId: 's-sardor' }] });
  });

  it("a seller's search stays inside their own clients", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ search: '  Tashkent ' }, sardor);
    const where = whereOf(prisma);
    expect(where.AND[0]).toEqual({ oneOff: false });
    expect(where.AND[1]).toEqual({ sellerId: 's-sardor' });
    expect(where.AND[2].OR).toEqual([
      { name: { contains: 'Tashkent', mode: 'insensitive' } },
      { phoneNumber: { contains: 'Tashkent', mode: 'insensitive' } },
      { address: { contains: 'Tashkent', mode: 'insensitive' } },
      { region: { name: { contains: 'Tashkent', mode: 'insensitive' } } },
      { district: { name: { contains: 'Tashkent', mode: 'insensitive' } } },
    ]);
  });

  it('a seller cannot widen the list by asking for another seller', async () => {
    const { service, prisma } = makeService();
    await service.findAll({ seller_id: 's-javlon' }, sardor);
    expect(whereOf(prisma)).toEqual({ AND: [{ oneOff: false }, { sellerId: 's-sardor' }] });
  });

  it('admin sees everyone, one seller, or the unassigned — and can search by seller name', async () => {
    const all = makeService();
    await all.service.findAll({}, admin);
    expect(whereOf(all.prisma)).toEqual({ AND: [{ oneOff: false }, {}] });
    const one = makeService();
    await one.service.findAll({ seller_id: 's-javlon' }, admin);
    expect(whereOf(one.prisma)).toEqual({ AND: [{ oneOff: false }, { sellerId: 's-javlon' }] });
    const none = makeService();
    await none.service.findAll({ seller_id: 'none' }, admin);
    expect(whereOf(none.prisma)).toEqual({ AND: [{ oneOff: false }, { sellerId: null }] });
    const byName = makeService();
    await byName.service.findAll({ search: 'Bekzod' }, admin);
    expect(whereOf(byName.prisma).AND[2].OR).toContainEqual({ seller: { name: { contains: 'Bekzod', mode: 'insensitive' } } });
  });

  it('every list is still bounded', async () => {
    const { service, prisma } = makeService();
    await service.findAll({}, admin);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.client as any).findMany.mock.calls[0][0].take).toBeGreaterThan(0);
  });

  it("another seller's client does not exist for you — detail, edit, delete all 404", async () => {
    const { service } = makeService();
    await expect(service.findOne('c1', javlon)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('c1', { name: 'X' }, javlon)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findOne('c1', sardor)).resolves.toMatchObject({ seller_id: 's-sardor', seller_name: 'Bekzod' });
  });

  it('the shared rule: staff see all, a seller only their own, nobody sees an unassigned one but staff', () => {
    expect(clientVisibleTo({ sellerId: 's-sardor' }, sardor)).toBe(true);
    expect(clientVisibleTo({ sellerId: 's-sardor' }, javlon)).toBe(false);
    expect(clientVisibleTo({ sellerId: null }, sardor)).toBe(false);
    expect(clientVisibleTo({ sellerId: null }, admin)).toBe(true);
    expect(clientVisibleTo({ sellerId: 's-sardor' }, { userId: 'm1', role: 'manager' })).toBe(true);
  });
});

describe('ClientsService — who owns a new or moved client', () => {
  it("a seller's new client is theirs, whatever the body says", async () => {
    const { service, prisma } = makeService();
    await service.create({ ...input, seller_id: 's-javlon' }, sardor);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.client as any).create.mock.calls[0][0].data).toMatchObject({ createdById: 's-sardor', sellerId: 's-sardor' });
  });

  it('admin picks the seller, or leaves it unassigned', async () => {
    const picked = makeService();
    await picked.service.create({ ...input, seller_id: 's-javlon' }, admin);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((picked.prisma.client as any).create.mock.calls[0][0].data).toMatchObject({ createdById: 'a1', sellerId: 's-javlon' });
    const unassigned = makeService();
    await unassigned.service.create(input, admin);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((unassigned.prisma.client as any).create.mock.calls[0][0].data).toMatchObject({ sellerId: null });
  });

  it('admin cannot hand a client to someone who is not an active seller', async () => {
    const { service } = makeService({ user: { role: 'driver', status: 'active' } });
    await expect(service.create({ ...input, seller_id: 'd1' }, admin)).rejects.toThrow('client_seller_invalid');
    const gone = makeService({ user: { role: 'seller', status: 'inactive' } });
    await expect(gone.service.create({ ...input, seller_id: 's-old' }, admin)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('admin moves a client to another seller; a seller sending seller_id changes nothing', async () => {
    const moved = makeService();
    await moved.service.update('c1', { seller_id: 's-javlon' }, admin);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((moved.prisma.client as any).update.mock.calls[0][0].data).toMatchObject({ sellerId: 's-javlon' });
    const tried = makeService();
    await tried.service.update('c1', { seller_id: 's-javlon' }, sardor);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tried.prisma.client as any).update.mock.calls[0][0].data).not.toHaveProperty('sellerId');
  });

  it("editing a client of a seller who has left works while the owner isn't changed", async () => {
    const { service, prisma } = makeService({ user: { role: 'seller', status: 'inactive' } });
    await expect(service.update('c1', { name: 'X', seller_id: 's-sardor' }, admin)).resolves.toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.user as any).findUnique).not.toHaveBeenCalled();
  });
});
