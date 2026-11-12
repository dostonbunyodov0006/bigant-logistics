import { BreakReminderService } from './break-reminder.service';

describe('break ending reminder (owner, 12.11.2026)', () => {
  it('five minutes before the end: told once for that end', async () => {
    const until = new Date('2026-11-12T08:20:00Z');
    const prisma = {
      driverBreak: {
        findMany: jest.fn().mockResolvedValue([{ id: 'b1', until, remindedFor: null, driver: { userId: 'u1' } }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new BreakReminderService(prisma as any, notifications as any);
    expect((await svc.sweep(new Date('2026-11-12T08:16:00Z'))).told).toBe(1);
    expect(notifications.notify).toHaveBeenCalledWith('u1', expect.objectContaining({ type: 'break_ending' }));
    expect(prisma.driverBreak.updateMany.mock.calls[0][0].data).toEqual({ remindedFor: until });
  });

  it('already told for this end: not again', async () => {
    const until = new Date('2026-11-12T08:20:00Z');
    const prisma = {
      driverBreak: {
        findMany: jest.fn().mockResolvedValue([{ id: 'b1', until, remindedFor: until, driver: { userId: 'u1' } }]),
        updateMany: jest.fn(),
      },
    };
    const notifications = { notify: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new BreakReminderService(prisma as any, notifications as any);
    expect((await svc.sweep(new Date('2026-11-12T08:16:00Z'))).told).toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
