import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, fineFilterSchema } from '@bigant/shared';
import { FinesService } from './fines.service';

function makeService(total = 1234, sumAmount = 9_000_000) {
  const prisma = {
    fine: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(total),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: sumAmount } }),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new FinesService(prisma as any), prisma };
}

describe('Fines pagination', () => {
  it('bounds the list by default instead of silently truncating at 500', async () => {
    const { service, prisma } = makeService();
    await service.list({});
    const arg = prisma.fine.findMany.mock.calls[0][0];
    expect(arg.take).toBe(DEFAULT_PAGE_SIZE);
    expect(arg.skip).toBe(0);
  });

  it('reports the full match count so the caller can see more exists', async () => {
    const { service } = makeService(1234);
    const page = await service.listPage({ skip: 100, take: 50 });
    // The page is short but the total tells the UI there are 25 pages.
    expect(page.total).toBe(1234);
    expect(page.items).toEqual([]);
  });

  it('sums the amount across every match, not just the visible page', async () => {
    const { service, prisma } = makeService(1234, 9_000_000);
    const page = await service.listPage({ take: 25 });
    // Printing a page-only sum next to the word "Total" would be a lie.
    expect(page.total_amount).toBe(9_000_000);
    expect(prisma.fine.aggregate.mock.calls[0][0].where).toEqual(
      prisma.fine.findMany.mock.calls[0][0].where,
    );
  });

  it('passes skip/take straight through to the query', async () => {
    const { service, prisma } = makeService();
    await service.listPage({ skip: 40, take: 20 });
    const arg = prisma.fine.findMany.mock.calls[0][0];
    expect(arg).toMatchObject({ skip: 40, take: 20 });
  });

  it('counts with the same filter as the page, so total matches the rows', async () => {
    const { service, prisma } = makeService();
    await service.listPage({ driver_id: 'd1' });
    expect(prisma.fine.count.mock.calls[0][0].where).toEqual(
      prisma.fine.findMany.mock.calls[0][0].where,
    );
  });

  it('rejects a page size above the cap rather than honouring it', () => {
    expect(fineFilterSchema.safeParse({ take: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
    expect(fineFilterSchema.safeParse({ take: String(MAX_PAGE_SIZE) }).success).toBe(true);
    // Query strings arrive as text, so the schema has to coerce.
    expect(fineFilterSchema.parse({ skip: '20', take: '10' })).toMatchObject({ skip: 20, take: 10 });
  });
});
