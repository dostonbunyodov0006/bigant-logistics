import {
  OUTBOX_RETENTION_DAYS,
  QueueRetentionService,
  TELEGRAM_SENT_RETENTION_DAYS,
} from './queue-retention.service';

function make() {
  const prisma = {
    outboxEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    telegramReport: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new QueueRetentionService(prisma as any), prisma };
}

const NOW = new Date('2026-07-27T12:00:00.000Z');
const DAY = 86_400_000;

describe('QueueRetentionService', () => {
  it('only prunes outbox events that were already processed', async () => {
    const { svc, prisma } = make();
    await svc.sweep(NOW);
    const where = prisma.outboxEvent.deleteMany.mock.calls[0][0].where;
    expect(where.status).toBe('processed');
    expect(where.createdAt.lt).toEqual(new Date(NOW.getTime() - OUTBOX_RETENTION_DAYS * DAY));
  });

  it('keeps a long outbox window, since it is the durable event record', async () => {
    // Notifications are pruned aggressively precisely because this is kept.
    expect(OUTBOX_RETENTION_DAYS).toBeGreaterThanOrEqual(180);
  });

  it('prunes sent Telegram reports but never failed ones, which stay retryable', async () => {
    const { svc, prisma } = make();
    await svc.sweep(NOW);
    const where = prisma.telegramReport.deleteMany.mock.calls[0][0].where;
    expect(where.status).toBe('sent');
    expect(where.createdAt.lt).toEqual(
      new Date(NOW.getTime() - TELEGRAM_SENT_RETENTION_DAYS * DAY),
    );
  });

  it('reports what it removed', async () => {
    const { svc, prisma } = make();
    prisma.outboxEvent.deleteMany.mockResolvedValue({ count: 7 });
    prisma.telegramReport.deleteMany.mockResolvedValue({ count: 2 });
    expect(await svc.sweep(NOW)).toEqual({ outboxDeleted: 7, telegramDeleted: 2 });
  });
});
