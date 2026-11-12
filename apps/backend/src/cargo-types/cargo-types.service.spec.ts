import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CargoTypesService } from './cargo-types.service';

function type(over: Record<string, unknown> = {}) {
  return { id: 'ct1', name: 'Sement', active: true, ...over };
}

function makeService(opts: { byName?: unknown; byId?: unknown; inUse?: number } = {}) {
  const prisma = {
    cargoType: {
      findMany: jest.fn().mockResolvedValue([type()]),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string; name?: string } }) =>
        Promise.resolve(where.name !== undefined ? ('byName' in opts ? opts.byName : null) : 'byId' in opts ? opts.byId : type()),
      ),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(type(data))),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(type(data))),
      delete: jest.fn().mockResolvedValue(type()),
    },
    order: { count: jest.fn().mockResolvedValue(opts.inUse ?? 0) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new CargoTypesService(prisma as any), prisma };
}

describe('CargoTypesService', () => {
  it('creates a cargo type', async () => {
    const { service } = makeService();
    const res = await service.create({ name: 'Metall' });
    expect(res.name).toBe('Metall');
  });

  it('rejects a duplicate name', async () => {
    const { service } = makeService({ byName: type({ name: 'Sement' }) });
    await expect(service.create({ name: 'Sement' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks deleting a cargo type that is in use', async () => {
    const { service } = makeService({ inUse: 4 });
    await expect(service.remove('ct1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes an unused cargo type', async () => {
    const { service, prisma } = makeService({ inUse: 0 });
    expect(await service.remove('ct1')).toEqual({ deleted: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.cargoType as any).delete).toHaveBeenCalledWith({ where: { id: 'ct1' } });
  });

  it('throws when updating a missing cargo type', async () => {
    const { service } = makeService({ byId: null });
    await expect(service.update('nope', { active: false })).rejects.toBeInstanceOf(NotFoundException);
  });
});
