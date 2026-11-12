import {
  MAX_PER_RECIPIENT,
  NotificationRetentionService,
  READ_RETENTION_DAYS,
  UNREAD_RETENTION_DAYS,
} from './notification-retention.service';

function make() {
  const prisma = {
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    clientReport: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new NotificationRetentionService(prisma as any), prisma };
}

const NOW = new Date('2026-07-27T12:00:00.000Z');
const DAY = 86_400_000;

describe('NotificationRetentionService', () => {
  it('prunes read notifications on the shorter clock', async () => {
    const { svc, prisma } = make();
    await svc.sweep(NOW);
    const readCall = prisma.notification.deleteMany.mock.calls.find(
      (c) => c[0].where.readAt?.not === null,
    );
    expect(readCall).toBeDefined();
    expect(readCall![0].where.readAt.lt).toEqual(new Date(NOW.getTime() - READ_RETENTION_DAYS * DAY));
  });

  it('keeps unread notifications far longer, so nothing unseen is dropped early', async () => {
    const { svc, prisma } = make();
    await svc.sweep(NOW);
    const unreadCall = prisma.notification.deleteMany.mock.calls.find(
      (c) => c[0].where.readAt === null,
    );
    expect(unreadCall).toBeDefined();
    expect(unreadCall![0].where.createdAt.lt).toEqual(
      new Date(NOW.getTime() - UNREAD_RETENTION_DAYS * DAY),
    );
    // A driver away for a week must still find their tray intact.
    expect(UNREAD_RETENTION_DAYS).toBeGreaterThan(READ_RETENTION_DAYS);
    expect(READ_RETENTION_DAYS).toBeGreaterThanOrEqual(7);
  });

  it('caps each inbox with a single statement, not one query per user', async () => {
    const { svc, prisma } = make();
    await svc.sweep(NOW);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = prisma.$executeRaw.mock.calls[0][0];
    expect(sql.strings.join('?')).toContain('PARTITION BY "recipient_user_id"');
    expect(sql.values).toContain(MAX_PER_RECIPIENT);
  });

  it('reports what it removed', async () => {
    const { svc, prisma } = make();
    prisma.notification.deleteMany
      .mockResolvedValueOnce({ count: 5 })
      .mockResolvedValueOnce({ count: 2 });
    prisma.$executeRaw.mockResolvedValue(3);
    const res = await svc.sweep(NOW);
    expect(res).toEqual({ readExpired: 5, unreadExpired: 2, overCap: 3 });
  });
});

describe('the app reports are kept for 30 days (06.11.2026)', () => {
  it('drops older ones in the same sweep', async () => {
    const prisma = {
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      clientReport: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new NotificationRetentionService(prisma as any).sweep(new Date('2026-11-06T00:00:00Z'));
    expect(prisma.clientReport.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date('2026-10-07T00:00:00Z') } } });
  });
});
