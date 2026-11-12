import { ForbiddenException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

function make() {
  const prisma = {
    notification: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  const push = {
    send: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new NotificationsService(prisma as any, push as any), prisma, push };
}

describe('NotificationsService', () => {
  it('persists the in-app notification in English but pushes in Uzbek', async () => {
    const { svc, prisma, push } = make();
    await svc.notify('u1', { type: 'order.assigned', title: 'New order', body: 'Order for Bekzod', clientName: 'Bekzod' });
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          recipientUserId: 'u1',
          title: 'New order',
          channel: 'in_app',
        }),
      ],
    });
    // Driver app is Uzbek-only: tray push is rendered in Uzbek and names the client.
    expect(push.sendToMany).toHaveBeenCalledWith(
      ['u1'],
      'Yangi buyurtma tayinlandi',
      'Bekzod buyurtmasi sizga tayinlandi',
      undefined, // no data payload
    );
  });

  it('falls back to the provided text for an unknown notification type', async () => {
    const { svc, push } = make();
    await svc.notify('u1', { type: 'unknown.type', title: 'T', body: 'B' });
    expect(push.sendToMany).toHaveBeenCalledWith(['u1'], 'T', 'B', undefined);
  });

  it('fans out to many recipients in one insert and one push, deduped', async () => {
    const { svc, prisma, push } = make();
    await svc.notifyMany(['u1', 'u1', 'u2'], { type: 't', title: 'T', body: 'B' });
    // One round-trip regardless of recipient count — not one per person.
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.notification.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(push.sendToMany).toHaveBeenCalledTimes(1);
    expect(push.sendToMany).toHaveBeenCalledWith(['u1', 'u2'], 'T', 'B', undefined);
  });

  it('ignores empty and null recipients instead of writing bad rows', async () => {
    const { svc, prisma, push } = make();
    await svc.notifyMany([], { type: 't', title: 'T', body: 'B' });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(push.sendToMany).not.toHaveBeenCalled();

    // notifyStaff passes the seller id, which is nullable on an order.
    await svc.notifyMany([null as unknown as string, 'u2'], { type: 't', title: 'T', body: 'B' });
    expect(prisma.notification.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it("forbids marking another user's notification as read", async () => {
    const { svc, prisma } = make();
    prisma.notification.findUnique.mockResolvedValue({ id: 'n1', recipientUserId: 'other' });
    await expect(
      svc.markRead('n1', { userId: 'u1', role: 'seller' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes a data payload through to the push, for the app to route a tap', async () => {
    const { svc, push } = make();
    await svc.notify('u1', { type: 'shift_end_check', title: 'T', body: 'B', data: { kind: 'shift_end_check', work_log_id: 'wl1' } });
    expect(push.sendToMany).toHaveBeenCalledWith(['u1'], 'T', 'B', { kind: 'shift_end_check', work_log_id: 'wl1' });
  });
});
