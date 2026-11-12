import { SettingsService } from './settings.service';

function makeService(row?: Record<string, unknown>) {
  const base = {
    id: 'default',
    expectedHoursPerDay: 8,
    workdays: [1, 2, 3, 4, 5, 6],
    shiftStart: '09:00',
    shiftEnd: '18:00',
    updatedAt: new Date('2026-07-03T00:00:00.000Z'),
    ...row,
  };
  const prisma = {
    workSettings: {
      upsert: jest.fn().mockImplementation(({ update }: { update: Record<string, unknown> }) =>
        Promise.resolve({ ...base, ...update }),
      ),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new SettingsService(prisma as any), prisma };
}

describe('SettingsService', () => {
  it('returns the singleton work settings (creating defaults)', async () => {
    const { service, prisma } = makeService();
    const res = await service.getWorkSettings();
    expect(res).toMatchObject({
      expected_hours_per_day: 8,
      workdays: [1, 2, 3, 4, 5, 6],
      shift_start: '09:00',
      shift_end: '18:00',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workSettings as any).upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'default' } }),
    );
  });

  it('updates fields and de-duplicates/sorts workdays', async () => {
    const { service, prisma } = makeService();
    await service.updateWorkSettings({ expected_hours_per_day: 10, workdays: [5, 1, 1, 3] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.workSettings as any).upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { expectedHoursPerDay: 10, workdays: [1, 3, 5] },
      }),
    );
  });
});
