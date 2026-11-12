import { VozvratReportService } from './vozvrat-report.service';

const NOW = new Date('2026-09-29T06:00:00Z');

function setup(report: Record<string, unknown> | null = { id: 'r1', orderId: 'o1', status: 'pending', attempts: 0, payload: { id: '1042' } }) {
  const prisma = {
    vozvratReport: {
      findUnique: jest.fn().mockResolvedValue(report),
      findMany: jest.fn().mockResolvedValue([{ orderId: 'o1' }, { orderId: 'o2' }]),
      update: jest.fn().mockResolvedValue({}),
      // The claim an attempt takes before handing over.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const ombor = { receive: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new VozvratReportService(prisma as any, ombor as any);
  return { prisma, ombor, service };
}

describe('VozvratReportService (owner, 05.11.2026: to the warehouse page here)', () => {
  it('hands the saved payload to the warehouse and marks it sent', async () => {
    const { prisma, ombor, service } = setup();
    expect(await service.deliver('o1', NOW)).toBe('sent');
    expect(ombor.receive).toHaveBeenCalledWith('o1', { id: '1042' });
    expect(prisma.vozvratReport.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'sent', attempts: 1, lastError: null, sentAt: NOW },
    });
  });

  it('marks a supplier-only return sent though no one takes it in, so it is not retried (owner, 07.11.2026)', async () => {
    const { prisma, ombor, service } = setup();
    ombor.receive.mockResolvedValue([]);
    expect(await service.deliver('o1', NOW)).toBe('sent');
    expect(prisma.vozvratReport.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'sent', attempts: 1, lastError: null, sentAt: NOW },
    });
  });

  it('does not hand over a report another attempt has claimed', async () => {
    const { prisma, ombor, service } = setup();
    prisma.vozvratReport.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.deliver('o1', NOW)).toBe('skipped');
    expect(ombor.receive).not.toHaveBeenCalled();
  });

  it('leaves a held report (seller not yet confirmed) alone', async () => {
    const { ombor, service } = setup({ id: 'r1', orderId: 'o1', status: 'held', attempts: 0, payload: {} });
    expect(await service.deliver('o1', NOW)).toBe('skipped');
    expect(ombor.receive).not.toHaveBeenCalled();
  });

  it('keeps a report that failed and tries again later', async () => {
    const { prisma, ombor, service } = setup();
    ombor.receive.mockRejectedValue(new Error('db down'));
    expect(await service.deliver('o1', NOW)).toBe('retry');
    const call = prisma.vozvratReport.update.mock.calls[0][0];
    expect(call.data.attempts).toBe(1);
    expect(call.data.lastError).toBe('db down');
    expect(call.data.nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('runs every due report', async () => {
    const { service } = setup();
    expect(await service.runDue(NOW)).toBe(2);
  });
});
