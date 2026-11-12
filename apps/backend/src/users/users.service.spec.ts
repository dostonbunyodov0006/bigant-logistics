import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'Dilnoza',
    phoneNumber: '+998901112233',
    passwordHash: 'x',
    role: 'seller',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(target: Record<string, unknown> | null = user()) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(target),
      findMany: jest.fn().mockResolvedValue([user()]),
      create: jest.fn().mockResolvedValue(user()),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(user(data)),
      ),
      delete: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(1),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new UsersService(prisma as any), prisma };
}

describe('UsersService management', () => {
  it("the Ishdan bo'shatilganlar list asks for the ones switched off only", async () => {
    const { service, prisma } = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user as any).count = jest.fn().mockResolvedValue(1);
    await service.listPage('seller', { status: 'inactive' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.user as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'seller', status: 'inactive' } }),
    );
  });

  it('lists users filtered by role', async () => {
    const { service, prisma } = makeService();
    await service.list('seller');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.user as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'seller' } }),
    );
  });

  it('filters users by search across name and phone', async () => {
    const { service, prisma } = makeService();
    await service.list('seller', { search: 'dil' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.user as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: 'seller',
          OR: [
            { name: { contains: 'dil', mode: 'insensitive' } },
            { phoneNumber: { contains: 'dil', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('deactivates a seller (soft delete) by setting status inactive', async () => {
    const { service, prisma } = makeService(user({ role: 'seller' }));
    const res = await service.deactivate('u1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.user as any).update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'inactive' },
    });
    expect(res.status).toBe('inactive');
  });

  it('edits an admin like any other account, but keeps the last active admin', async () => {
    const { service, prisma } = makeService(user({ role: 'admin', status: 'active' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user as any).count = jest.fn().mockResolvedValue(0);
    await expect(service.update('u1', { name: 'x' })).resolves.toBeDefined();
    await expect(service.deactivate('u1')).rejects.toBeInstanceOf(ForbiddenException);
    // With a second admin in the office, this one may go.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user as any).count = jest.fn().mockResolvedValue(1);
    await expect(service.deactivate('u1')).resolves.toBeDefined();
  });

  it('refuses to manage a driver via the users endpoint', async () => {
    const { service } = makeService(user({ role: 'driver' }));
    await expect(service.deactivate('u1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an update that collides with another user phone', async () => {
    const { service, prisma } = makeService(user({ id: 'u1', phoneNumber: '+998900000000' }));
    // findByPhone (second findUnique call) returns a different user with that phone.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user as any).findUnique
      .mockResolvedValueOnce(user({ id: 'u1', phoneNumber: '+998900000000' })) // getManageableOrThrow
      .mockResolvedValueOnce(user({ id: 'u2', phoneNumber: '+998905556677' })); // findByPhone collision
    await expect(
      service.update('u1', { phone_number: '+998905556677' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a dispatcher cannot switch an admin off or on; an admin can', async () => {
    const { service, prisma } = makeService(user({ role: 'admin', status: 'active' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.user as any).count = jest.fn().mockResolvedValue(1);
    await expect(service.deactivate('u1', 'manager')).rejects.toMatchObject({ message: 'admins_only' });
    await expect(service.update('u1', { status: 'active' }, 'manager')).rejects.toMatchObject({ message: 'admins_only' });
    await expect(service.deactivate('u1', 'admin')).resolves.toBeDefined();
  });

  it('only an admin can switch on/off, edit or remove a dispatcher (owner, 07.11.2026)', async () => {
    const { service, prisma } = makeService(user({ role: 'manager', status: 'active' }));
    await expect(service.deactivate('u1', 'manager')).rejects.toMatchObject({ message: 'admin_only' });
    await expect(service.update('u1', { status: 'active' }, 'manager')).rejects.toMatchObject({ message: 'admin_only' });
    await expect(service.update('u1', { name: 'Bekzod' }, 'manager')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    await expect(service.update('u1', { name: 'Bekzod' }, 'admin')).resolves.toBeDefined();
    await expect(service.deactivate('u1', 'admin')).resolves.toBeDefined();
  });

  it('a dispatcher can still edit a seller (owner, 07.11.2026)', async () => {
    const { service } = makeService(user({ role: 'seller' }));
    await expect(service.update('u1', { name: 'Dilnoza 2' }, 'manager')).resolves.toBeDefined();
  });

  it('a dispatcher can still switch a seller off', async () => {
    const { service } = makeService(user({ role: 'seller' }));
    await expect(service.deactivate('u1', 'manager')).resolves.toBeDefined();
  });
});

describe('UsersService.create — who may make whom (audit, 07.11.2026)', () => {
  const input = (role: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ name: 'Yangi', phone_number: '+998901234567', password: 'secret1', role }) as any;

  it.each(['admin', 'manager'])('a dispatcher cannot create a %s', async (role) => {
    const { service, prisma } = makeService(null);
    await expect(service.create(input(role), 'manager')).rejects.toThrow('admin_only');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('a dispatcher can still create a seller', async () => {
    const { service, prisma } = makeService(null);
    await service.create(input('seller'), 'manager');
    expect(prisma.user.create).toHaveBeenCalled();
  });

  it.each(['admin', 'manager'])('an admin can create a %s', async (role) => {
    const { service, prisma } = makeService(null);
    await service.create(input(role), 'admin');
    expect(prisma.user.create).toHaveBeenCalled();
  });
});
