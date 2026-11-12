import { PolniyReminderService } from './polniy-reminder.service';

const NOW = new Date('2026-11-02T06:00:00Z');

type Row = Record<string, unknown> & { id: string };

function order(over: Partial<Row> = {}): Row {
  return {
    id: 'o1',
    status: 'on_the_way',
    returnDeferredAt: null,
    createdBySellerId: 'seller1',
    clientName: 'Barakat',
    reservation: { id: 'r1', groupId: 'g1' },
    assignedDriver: { vehicle: { plateNumber: '01 S 002 SS' } },
    ...over,
  };
}

function make(opts: { orders: Row[]; others?: number; etaSeconds?: number | null; etaThrows?: boolean }) {
  const prisma = {
    order: {
      findMany: jest.fn().mockResolvedValue(opts.orders),
      update: jest.fn().mockResolvedValue({}),
    },
    reservation: { count: jest.fn().mockResolvedValue(opts.others ?? 0) },
  };
  const eta = {
    forOrder: jest.fn().mockImplementation(() =>
      opts.etaThrows
        ? Promise.reject(new Error('valhalla down'))
        : Promise.resolve({
            state: opts.etaSeconds === null ? 'unavailable' : 'ok',
            trip_total: opts.etaSeconds === null ? null : { distance_km: 3, eta_seconds: opts.etaSeconds ?? 600 },
          }),
    ),
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new PolniyReminderService(prisma as any, eta as any, notifications as any);
  return { svc, prisma, notifications };
}

describe('the Polniy "put the next order on" reminder', () => {
  it('twenty minutes out: nothing yet', async () => {
    const t = make({ orders: [order()], etaSeconds: 20 * 60 });
    expect(await t.svc.sweep(NOW)).toEqual({ o1: 'not_yet' });
    expect(t.notifications.notify).not.toHaveBeenCalled();
  });

  it('five minutes before the end the seller is told once, with the plate and the minutes', async () => {
    const t = make({ orders: [order()], etaSeconds: 4 * 60 + 50 });
    expect(await t.svc.sweep(NOW)).toEqual({ o1: 'reminded' });
    expect(t.notifications.notify).toHaveBeenCalledWith(
      'seller1',
      expect.objectContaining({ type: 'order.polniy_next', body: expect.stringContaining('01 S 002 SS ~5 daqiqada') }),
    );
    expect(t.prisma.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { polniyRemindedAt: NOW } });
  });

  it('a second order or slot already on the Polniy: no reminder', async () => {
    const t = make({ orders: [order()], others: 1, etaSeconds: 60 });
    expect(await t.svc.sweep(NOW)).toEqual({ o1: 'has_next' });
    expect(t.notifications.notify).not.toHaveBeenCalled();
  });

  it('a return carried to its place is an order like any other: reminded before it is there', async () => {
    const t = make({ orders: [order({ status: 'returning' })], etaSeconds: 120 });
    expect(await t.svc.sweep(NOW)).toEqual({ o1: 'reminded' });
  });

  it("a return set aside with Ojidaniya has let the lorry go: told the lorry is Bo'sh, not to hurry", async () => {
    const t = make({ orders: [order({ status: 'returning', returnDeferredAt: NOW })], etaSeconds: 60 });
    expect(await t.svc.sweep(NOW)).toEqual({ o1: 'ended' });
    expect(t.notifications.notify).toHaveBeenCalledWith('seller1', expect.objectContaining({ type: 'order.polniy_ended' }));
  });

  it("the owner's test: a one-minute trip ends before any reminder was due — told the lorry is Bo'sh", async () => {
    const t = make({ orders: [order({ status: 'delivered' })], etaSeconds: 20 * 60 });
    expect(await t.svc.sweep(NOW)).toEqual({ o1: 'ended' });
    expect(t.notifications.notify).toHaveBeenCalledWith(
      'seller1',
      expect.objectContaining({ type: 'order.polniy_ended', body: expect.stringContaining("Polniy bron tugadi, mashina bo'sh") }),
    );
    expect(t.prisma.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { polniyRemindedAt: NOW } });
  });

  it('ended with a second order on the Polniy: nothing to say', async () => {
    const t = make({ orders: [order({ status: 'delivered' })], others: 1 });
    expect(await t.svc.sweep(NOW)).toEqual({ o1: 'has_next' });
    expect(t.notifications.notify).not.toHaveBeenCalled();
  });

  it('no position to judge by: told now rather than never', async () => {
    const t = make({ orders: [order()], etaSeconds: null });
    expect(await t.svc.sweep(NOW)).toEqual({ o1: 'reminded' });
    expect(t.notifications.notify).toHaveBeenCalledWith('seller1', expect.objectContaining({ body: expect.stringContaining('tez orada') }));
  });

  it('the router down is the same as no position', async () => {
    const t = make({ orders: [order()], etaThrows: true });
    expect(await t.svc.sweep(NOW)).toEqual({ o1: 'reminded' });
  });
});
