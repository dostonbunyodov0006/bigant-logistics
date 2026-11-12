import { hourlySpeeds, SpeedStatsService } from './speed-stats.service';

// Monday 18:30 in Tashkent.
const now = new Date('2026-11-02T13:30:00Z');
const CITY = [
  { lat: 41.2756, lng: 69.2034 },
  { lat: 41.364, lng: 69.287 },
];

async function make(rows: unknown[]) {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new SpeedStatsService(prisma as any);
  await svc.refresh(now);
  return svc;
}
const row = (over = {}) => ({ sunday: false, h: 18, kmh: 25, n: 500, drivers: 5, ...over });

describe('the real speed of our lorries', () => {
  it('stretches a city route by how much slower they really go at this hour', async () => {
    const svc = await make([row()]);
    // 50 km in an hour on the map (50 km/h), 25 km/h in life: twice as long.
    expect(svc.factor(CITY, 50, 3600, now)).toBeCloseTo(2);
  });

  it('changes nothing without enough driving, or by too few lorries', async () => {
    expect((await make([row({ n: 50 })])).factor(CITY, 50, 3600, now)).toBe(1);
    expect((await make([row({ drivers: 1 })])).factor(CITY, 50, 3600, now)).toBe(1);
    expect((await make([])).factor(CITY, 50, 3600, now)).toBe(1);
  });

  it('uses the figure of this hour and day kind only', async () => {
    expect((await make([row({ h: 9 })])).factor(CITY, 50, 3600, now)).toBe(1);
    expect((await make([row({ sunday: true })])).factor(CITY, 50, 3600, now)).toBe(1);
  });

  it('leaves a route out of the city alone', async () => {
    const svc = await make([row()]);
    expect(svc.factor([CITY[0]!, { lat: 39.65, lng: 66.96 }], 280, 12000, now)).toBe(1);
  });

  it('keeps a bad figure within bounds', async () => {
    expect((await make([row({ kmh: 3 })])).factor(CITY, 50, 3600, now)).toBe(3);
    expect((await make([row({ kmh: 200 })])).factor(CITY, 50, 3600, now)).toBe(0.7);
  });

  it('reads counts as the database returns them', () => {
    expect(hourlySpeeds([row({ n: 300n, drivers: 3n })]).get('day:18')).toBe(25);
  });

  it('survives the query failing', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('db')) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new SpeedStatsService(prisma as any);
    await expect(svc.refresh(now)).resolves.toBeUndefined();
    expect(svc.factor(CITY, 50, 3600, now)).toBe(1);
  });
});
