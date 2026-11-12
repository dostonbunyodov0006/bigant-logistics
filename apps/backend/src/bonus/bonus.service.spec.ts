import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BonusService } from './bonus.service';

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    name: 'Base trip bonus',
    active: true,
    amount: 5000,
    appliesTo: 'all',
    regionCode: null,
    geoDistrictCode: null,
    region: null,
    geoDistrict: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(opts: { rules?: unknown[]; geoExists?: boolean; ruleById?: unknown } = {}) {
  const geoHit = opts.geoExists === false ? null : { code: '1726', name: 'Toshkent shahri' };
  const prisma = {
    bonusRule: {
      findMany: jest.fn().mockResolvedValue(opts.rules ?? [rule()]),
      findUnique: jest.fn().mockResolvedValue('ruleById' in opts ? opts.ruleById : rule()),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(rule(data)),
      ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(rule(data)),
      ),
      delete: jest.fn().mockResolvedValue(rule()),
    },
    bonusLog: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    region: { findUnique: jest.fn().mockResolvedValue(geoHit) },
    geoDistrict: { findUnique: jest.fn().mockResolvedValue(geoHit) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new BonusService(prisma as any), prisma };
}

describe('BonusService rules', () => {
  it('creates a rule', async () => {
    const { service, prisma } = makeService();
    const res = await service.createRule({ name: 'Urgent', amount: 8000, applies_to: 'urgent' });
    expect(res.name).toBe('Urgent');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.bonusRule as any).create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 8000, appliesTo: 'urgent' }) }),
    );
  });

  it('rejects a rule pointing at a non-existent district', async () => {
    const { service } = makeService({ geoExists: false });
    await expect(
      service.createRule({ name: 'X', amount: 1000, applies_to: 'all', district_code: 'missing' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when updating a missing rule', async () => {
    const { service } = makeService({ ruleById: null });
    await expect(service.updateRule('nope', { amount: 100 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('BonusService.accrueForDelivery', () => {
  it('accrues matching rules to the driver on delivery', async () => {
    const { service, prisma } = makeService({ rules: [rule({ id: 'r1', amount: 5000 })] });
    await service.accrueForDelivery({
      id: 'o1',
      regionCode: '1726',
      geoDistrictCode: '1726294',
      priority: 'urgent',
      assignedDriverId: 'drv1',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.bonusLog as any).createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ driverId: 'drv1', orderId: 'o1', ruleId: 'r1', amount: 5000 }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('skips accrual when the order has no assigned driver', async () => {
    const { service, prisma } = makeService();
    await service.accrueForDelivery({
      id: 'o1',
      regionCode: null,
      geoDistrictCode: null,
      priority: 'normal',
      assignedDriverId: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.bonusLog as any).createMany).not.toHaveBeenCalled();
  });

  it('does nothing when no active rule matches', async () => {
    const { service, prisma } = makeService({ rules: [] });
    await service.accrueForDelivery({
      id: 'o1',
      regionCode: '1726',
      geoDistrictCode: '1726294',
      priority: 'normal',
      assignedDriverId: 'drv1',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.bonusLog as any).createMany).not.toHaveBeenCalled();
  });
});
