import { OutboxDispatcher } from './outbox.dispatcher';
import { OrderEventType } from './events';

const ORDER = { id: 'o1', orderNumber: 7, assignedDriverId: 'd1', createdBySellerId: 's1', deliveryDatetime: new Date() };

function make(eventType: string, payload: Record<string, unknown> = {}, lastShift: unknown = null) {
  const prisma = {
    outboxEvent: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'e1', eventType, attempts: 0, payload: { orderId: 'o1', ...payload } }]),
      update: jest.fn().mockResolvedValue({}),
    },
    order: { findUnique: jest.fn().mockResolvedValue(ORDER) },
    driver: { findUnique: jest.fn().mockResolvedValue({ userId: 'du1' }) },
    workLog: { findFirst: jest.fn().mockResolvedValue(lastShift) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]) },
  };
  const notifications = { notify: jest.fn(), notifyMany: jest.fn() };
  const telegram = {
    createForDelivery: jest.fn(),
    createForVozrat: jest.fn(),
    createForPickup: jest.fn(),
  };
  const config = { get: jest.fn().mockReturnValue(false) };
  const dispatcher = new OutboxDispatcher(
    prisma as never,
    notifications as never,
    telegram as never,
    config as never,
  );
  return { dispatcher, prisma, notifications, telegram };
}

describe('OutboxDispatcher', () => {
  it('does NOT notify anyone about a routine status change', async () => {
    // Routine transitions were 66% of all notifications and half went unread.
    // Sellers get live status over SSE instead; the outbox row is still the record.
    const { dispatcher, notifications, prisma } = make(OrderEventType.StatusChanged, {
      status: 'on_the_way',
    });
    await dispatcher.processPending();
    expect(notifications.notifyMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    // The event is still consumed, not left pending forever.
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'processed' }) }),
    );
  });

  it('still notifies staff about events that need a human', async () => {
    for (const type of [
      OrderEventType.Problem,
      OrderEventType.Rejected,
      OrderEventType.AssignmentExpired,
      OrderEventType.Delivered,
    ]) {
      const { dispatcher, notifications } = make(type);
      await dispatcher.processPending();
      expect(notifications.notifyMany).toHaveBeenCalledTimes(1);
    }
  });

  it('fans staff notifications out in a single batched call', async () => {
    const { dispatcher, notifications } = make(OrderEventType.Problem);
    await dispatcher.processPending();
    // One call carrying every recipient — not one call per admin.
    expect(notifications.notifyMany).toHaveBeenCalledTimes(1);
    expect(notifications.notifyMany.mock.calls[0][0]).toEqual(['s1', 'a1', 'a2']);
  });

  it('staff fan-out reaches managers as well as admins', async () => {
    const { dispatcher, prisma } = make(OrderEventType.Rejected);
    await dispatcher.processPending();
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: { in: ['admin', 'manager'] }, status: 'active' } }),
    );
  });

  it('a dispatch that throws waits for a retry instead of failing for good', async () => {
    const { dispatcher, notifications, prisma } = make(OrderEventType.Problem);
    notifications.notifyMany.mockRejectedValueOnce(new Error('db blip'));
    await dispatcher.processPending();
    const data = prisma.outboxEvent.update.mock.calls[0][0].data;
    expect(data.status).toBe('pending');
    expect(data.attempts).toBe(1);
    expect(data.lastError).toBe('db blip');
    expect(data.nextAttemptAt.getTime() - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it('gives up after the sixth attempt', async () => {
    const { dispatcher, notifications, prisma } = make(OrderEventType.Problem);
    prisma.outboxEvent.findMany.mockResolvedValue([
      { id: 'e1', eventType: OrderEventType.Problem, attempts: 5, payload: { orderId: 'o1' } },
    ]);
    notifications.notifyMany.mockRejectedValueOnce(new Error('still down'));
    await dispatcher.processPending();
    expect(prisma.outboxEvent.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'failed', attempts: 6, nextAttemptAt: null }),
    );
  });

  it('tells the driver when the seller moves an order before 09:00', async () => {
    const { dispatcher, notifications } = make(OrderEventType.StartMovedEarlier);
    await dispatcher.processPending();
    expect(notifications.notify).toHaveBeenCalledWith('du1', expect.objectContaining({ type: 'order.start_moved_earlier' }));
  });

  it('still notifies the driver when an order is assigned', async () => {
    const { dispatcher, notifications } = make(OrderEventType.Assigned);
    await dispatcher.processPending();
    expect(notifications.notify).toHaveBeenCalledWith('du1', expect.objectContaining({ type: 'order.assigned' }));
  });

  it('his shift today already closed: told to press «Ishni boshlash» (owner, 04.11.2026)', async () => {
    const closed = { clockInAt: new Date(Date.now() - 60_000), clockOutAt: new Date() };
    const { dispatcher, notifications } = make(OrderEventType.Assigned, {}, closed);
    await dispatcher.processPending();
    expect(notifications.notify).toHaveBeenCalledWith('du1', expect.objectContaining({ type: 'order.assigned_start_shift' }));
  });

  it('on shift, or his last shift was another day: the usual push', async () => {
    const open = make(OrderEventType.Assigned, {}, { clockInAt: new Date(), clockOutAt: null });
    await open.dispatcher.processPending();
    expect(open.notifications.notify).toHaveBeenCalledWith('du1', expect.objectContaining({ type: 'order.assigned' }));
    const old = new Date(Date.now() - 3 * 86_400_000);
    const yesterday = make(OrderEventType.Assigned, {}, { clockInAt: old, clockOutAt: old });
    await yesterday.dispatcher.processPending();
    expect(yesterday.notifications.notify).toHaveBeenCalledWith('du1', expect.objectContaining({ type: 'order.assigned' }));
  });

  it.each([
    [
      OrderEventType.Delivered,
      'createForDelivery',
      [ORDER, 'https://cdn.test/delivery.jpg', 'Yetkazildi'],
    ],
    [
      OrderEventType.ReturnDelivered,
      'createForVozrat',
      [ORDER, 'https://cdn.test/return.jpg', 'Omborga topshirildi'],
    ],
  ])('forwards the photo comment for %s', async (eventType, method, expectedArgs) => {
    const { dispatcher, telegram } = make(eventType, {
      photoUrl: expectedArgs[1],
      comment: expectedArgs[2],
    });
    await dispatcher.processPending();
    expect(telegram[method as 'createForDelivery' | 'createForVozrat']).toHaveBeenCalledWith(
      ...expectedArgs,
    );
  });

  it('forwards the pickup place, photo, and comment to Telegram', async () => {
    const { dispatcher, telegram } = make(OrderEventType.PickupLoaded, {
      placeName: 'Chilonzor ombori',
      photoUrl: 'https://cdn.test/pickup.jpg',
      comment: '10 ta quti olindi',
    });
    await dispatcher.processPending();
    expect(telegram.createForPickup).toHaveBeenCalledWith(
      ORDER,
      'Chilonzor ombori',
      'https://cdn.test/pickup.jpg',
      '10 ta quti olindi',
      // The stop names the report, so one order loaded at two places keeps
      // two reports and neither is posted twice.
      null,
    );
  });
});
