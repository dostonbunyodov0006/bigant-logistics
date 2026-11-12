import { minutesLate, PoputiLateWatchService, stopsUntilHostClient } from './poputi-late-watch.service';

const P = (lat: number, pos: number | null, leg = 'pending') => ({ lat, lng: 69.2, tripPosition: pos, legStatus: leg });

describe('po puti late watch (owner, 11.11.2026)', () => {
  it('times the stops ahead up to the first seller’s client, in trip order, skipping what is done', () => {
    const stops = stopsUntilHostClient('host', [
      { id: 'host', deliveryLat: 41.3, deliveryLng: 69.2, deliveryTripPosition: 4, pickupSources: [P(41.1, 1, 'arrived'), P(41.2, 3)] },
      { id: 'co', deliveryLat: 41.4, deliveryLng: 69.2, deliveryTripPosition: 5, pickupSources: [P(41.15, 2)] },
    ]);
    expect(stops?.map((s) => s.position)).toEqual([2, 3, 4]);
    expect(stops?.at(-1)?.hostClient).toBe(true);
  });

  it('a few minutes over is noise; more than five is late', () => {
    const deadline = new Date('2026-11-11T10:00:00Z');
    expect(minutesLate(new Date('2026-11-11T10:05:00Z'), deadline)).toBeNull();
    expect(minutesLate(new Date('2026-11-11T10:12:00Z'), deadline)).toBe(12);
  });

  function make(driverAt: Date, routeSeconds: number) {
    const host = { id: 'host', orderNumber: 77, clientName: 'Aziz', createdBySellerId: 'seller1', assignedDriverId: 'd1', poputiClientDeadlineAt: new Date('2026-11-11T10:30:00Z') };
    const prisma = {
      order: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([host])
          .mockResolvedValueOnce([{ id: 'host', deliveryLat: 41.3, deliveryLng: 69.2, deliveryTripPosition: 2, pickupSources: [P(41.2, 1)] }]),
        update: jest.fn().mockResolvedValue({}),
      },
      driver: { findUnique: jest.fn().mockResolvedValue({ locationLat: 41.1, locationLng: 69.2, locationUpdatedAt: driverAt }) },
    };
    const valhalla = { route: jest.fn().mockResolvedValue({ summary: { time_seconds: routeSeconds, length_km: 5 } }) };
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { svc: new PoputiLateWatchService(prisma as any, valhalla as any, notifications as any), prisma, notifications };
  }

  it('running late: the first seller is told once, with the new time', async () => {
    const now = new Date('2026-11-11T10:00:00Z');
    // 20 map minutes ×1.5 = 30, + 22 loading at the one pickup before him = 52 → 10:52, 22 past 10:30.
    const { svc, prisma, notifications } = make(now, 1200);
    const r = await svc.sweep(now);
    expect(r.told).toEqual(['host']);
    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'host' }, data: { poputiLateToldAt: now } });
    expect(notifications.notify).toHaveBeenCalledWith('seller1', expect.objectContaining({ type: 'poputi.host_late', relatedOrderId: 'host' }));
    expect(notifications.notify.mock.calls[0][1].body).toContain('~22 daqiqa');
  });

  it('on time: nobody is told', async () => {
    const now = new Date('2026-11-11T10:00:00Z');
    const { svc, notifications } = make(now, 320); // 8 + 22 = 30 → 10:30
    expect((await svc.sweep(now)).told).toEqual([]);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('an old driver position: waits for a fresh one rather than time from the wrong place', async () => {
    const now = new Date('2026-11-11T10:00:00Z');
    const { svc, notifications } = make(new Date(now.getTime() - 20 * 60_000), 3000);
    expect((await svc.sweep(now)).told).toEqual([]);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
