import { AppSilenceService } from './app-silence.service';
import { AppSeenInterceptor, AppSeenTracker } from './app-seen.tracker';

const T0 = new Date('2026-11-09T05:00:00Z'); // Monday 10:00 Tashkent
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

interface Log {
  id: string;
  driverId: string;
  name: string;
  plate?: string;
  clockInAt: Date;
  lastAppSeenAt: Date | null;
  locationUpdatedAt?: Date | null;
  breakUntil?: Date | null;
  appSilentSince: Date | null;
  appSilentAlertAt: Date | null;
}

function shift(n: number, over: Partial<Log> = {}): Log {
  return {
    id: `w${n}`,
    driverId: `d${n}`,
    name: `Haydovchi${n}`,
    plate: `01 V ${n}00 WC`,
    clockInAt: at(-120),
    lastAppSeenAt: at(0),
    appSilentSince: null,
    appSilentAlertAt: null,
    ...over,
  };
}

/** Work logs keep what the service writes, so sweeps can follow one another. */
function make(logs: Log[], opts: { pingDrivers?: string[]; leave?: string[]; sendFails?: boolean } = {}) {
  const prisma = {
    workLog: {
      findMany: jest.fn().mockImplementation(() =>
        Promise.resolve(
          logs.map((l) => ({
            id: l.id,
            driverId: l.driverId,
            clockInAt: l.clockInAt,
            appSilentSince: l.appSilentSince,
            appSilentAlertAt: l.appSilentAlertAt,
            driver: {
              lastAppSeenAt: l.lastAppSeenAt,
              locationUpdatedAt: l.locationUpdatedAt ?? null,
              breakUntil: l.breakUntil ?? null,
              user: { name: l.name },
              vehicle: l.plate ? { plateNumber: l.plate } : null,
            },
          })),
        ),
      ),
      updateMany: jest.fn().mockImplementation(({ where, data }: { where: { id: string; appSilentAlertAt: Date | null }; data: Partial<Log> }) => {
        const l = logs.find((x) => x.id === where.id && x.appSilentAlertAt === where.appSilentAlertAt);
        if (l) Object.assign(l, data);
        return Promise.resolve({ count: l ? 1 : 0 });
      }),
    },
    leaveRequest: { findMany: jest.fn().mockResolvedValue((opts.leave ?? []).map((driverId) => ({ driverId }))) },
    driverLocationPing: {
      groupBy: jest.fn().mockImplementation(({ where }: { where: { driverId: { in: string[] } } }) =>
        Promise.resolve(
          where.driverId.in.filter((d) => (opts.pingDrivers ?? []).includes(d)).map((driverId) => ({ driverId, _max: { recordedAt: T0 } })),
        ),
      ),
    },
  };
  const telegram = {
    send: jest.fn().mockImplementation(() => (opts.sendFails ? Promise.reject(new Error('down')) : Promise.resolve({ delivered: true }))),
  };
  const config = { get: jest.fn((k: string) => (k === 'TELEGRAM_OPS_CHAT_ID' ? '-100ops' : k === 'TELEGRAM_GROUP_CHAT_ID' ? '-100group' : undefined)) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new AppSilenceService(prisma as any, telegram as any, config as any);
  svc.startedAt = at(-600);
  const texts = () => telegram.send.mock.calls.map((c) => (c[0] as { text: string }).text);
  return { svc, prisma, telegram, texts };
}

describe('AppSilenceService', () => {
  it('stays quiet while the app was seen within 15 minutes', async () => {
    const { svc, telegram } = make([shift(1, { lastAppSeenAt: at(0) })]);
    await svc.sweep(at(14));
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('screen off, app asleep, but the phone still sends its location: no alert (owner, 09.11.2026)', async () => {
    const { svc, texts } = make([shift(1, { lastAppSeenAt: at(0), locationUpdatedAt: at(14) })]);
    const r = await svc.sweep(at(20));
    expect(r.alerted).toEqual([]);
    expect(texts()).toEqual([]);
  });

  it('a silent driver on shift: one message to the ops chat, once per silence', async () => {
    const logs = [shift(1, { name: 'Bobur', plate: '01 X 111 XX' })];
    const { svc, telegram, texts } = make(logs, { pingDrivers: ['d1'] });
    const r = await svc.sweep(at(16));
    expect(r.alerted).toEqual(['d1']);
    expect(texts()).toEqual([
      "⚠️ Bobur (01 X 111 XX): 16 daqiqadan beri telefondan aloqa yo'q (smenada) — telefon o'chgan, internet yo'q yoki ilova yopilgan bo'lishi mumkin.",
    ]);
    expect(telegram.send.mock.calls[0][1]).toBe('-100ops');
    expect(logs[0].appSilentAlertAt).toEqual(at(16));
    expect(logs[0].appSilentSince).toEqual(at(0));

    await svc.sweep(at(21));
    await svc.sweep(at(60));
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it('says when no position comes either (phone off / no internet)', async () => {
    const { svc, texts } = make([shift(1, { name: 'Bobur', plate: undefined })]);
    await svc.sweep(at(20));
    expect(texts()[0]).toBe("⚠️ Bobur: 20 daqiqadan beri telefondan aloqa yo'q (smenada) — telefon o'chgan, internet yo'q yoki ilova yopilgan bo'lishi mumkin.");
  });

  it('the app seen again: a short recovery message and the flag cleared', async () => {
    const logs = [shift(1, { name: 'Bobur' })];
    const { svc, texts } = make(logs);
    await svc.sweep(at(16));
    logs[0].lastAppSeenAt = at(40);
    const r = await svc.sweep(at(41));
    expect(r.recovered).toEqual(['d1']);
    expect(texts()[1]).toBe('✅ Bobur: ilova qayta ulandi (40 daqiqa jim edi)');
    expect(logs[0].appSilentAlertAt).toBeNull();
    expect(logs[0].appSilentSince).toBeNull();
    // A new silence later is a new alert.
    await svc.sweep(at(56));
    expect(texts()).toHaveLength(3);
    expect(texts()[2]).toContain('⚠️ Bobur');
  });

  it('3 drivers silent in the same window: one combined message instead of three', async () => {
    const logs = [shift(1), shift(2, { lastAppSeenAt: at(2) }), shift(3, { lastAppSeenAt: at(3) })];
    const { svc, telegram, texts } = make(logs, { pingDrivers: ['d1', 'd2', 'd3'] });
    const r = await svc.sweep(at(20));
    expect(r.combined).toBe(true);
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(texts()[0]).toMatch(/^🚨 3 ta haydovchida ilova bir vaqtda jim — yangilanish yoki server muammosi bo'lishi mumkin\./);
    expect(texts()[0]).toContain('• Haydovchi2 (01 V 200 WC) — 18 daq, joylashuv: telefon xizmati yuboryapti');
    expect(logs.every((l) => l.appSilentAlertAt)).toBe(true);
    await svc.sweep(at(25));
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it('a third one joining two already reported in the window turns into the combined message', async () => {
    const logs = [shift(1), shift(2), shift(3, { lastAppSeenAt: at(5) })];
    const { svc, texts } = make(logs);
    await svc.sweep(at(16));
    expect(texts()).toHaveLength(2);
    await svc.sweep(at(21));
    expect(texts()).toHaveLength(3);
    expect(texts()[2]).toMatch(/^🚨 3 ta haydovchida/);
  });

  it('no message for a break, an approved leave, or no open shift', async () => {
    const { svc, telegram } = make([shift(1, { breakUntil: at(30) }), shift(2)], { leave: ['d2'] });
    await svc.sweep(at(20));
    const empty = make([]);
    await empty.svc.sweep(at(20));
    expect(telegram.send).not.toHaveBeenCalled();
    expect(empty.telegram.send).not.toHaveBeenCalled();
  });

  it('never seen: counts from the shift start, and from the watch start right after the deploy', async () => {
    const { svc, texts } = make([shift(1, { lastAppSeenAt: null, clockInAt: at(0) })]);
    await svc.sweep(at(10));
    expect(texts()).toHaveLength(0);
    await svc.sweep(at(15));
    expect(texts()).toHaveLength(1);

    const fresh = make([shift(1, { lastAppSeenAt: null })]);
    fresh.svc.startedAt = at(0);
    await fresh.svc.sweep(at(10));
    expect(fresh.texts()).toHaveLength(0);
  });

  it('a failed send is tried again next sweep, not marked', async () => {
    const logs = [shift(1)];
    const { svc, telegram } = make(logs, { sendFails: true });
    await svc.sweep(at(16));
    expect(logs[0].appSilentAlertAt).toBeNull();
    telegram.send.mockResolvedValue({ delivered: true });
    await svc.sweep(at(21));
    expect(logs[0].appSilentAlertAt).toEqual(at(21));
  });
});

describe('AppSeenTracker', () => {
  function tracker() {
    const prisma = { $executeRaw: jest.fn().mockResolvedValue(1) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { t: new AppSeenTracker(prisma as any), prisma };
  }

  it('writes at most once a minute per driver', () => {
    const { t, prisma } = tracker();
    const ms = T0.getTime();
    t.seen('u1', ms);
    t.seen('u1', ms + 5_000);
    t.seen('u1', ms + 59_999);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    t.seen('u2', ms + 1_000);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    t.seen('u1', ms + 60_000);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('a failed write never throws into the request', async () => {
    const prisma = { $executeRaw: jest.fn().mockRejectedValue(new Error('db down')) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = new AppSeenTracker(prisma as any);
    expect(() => t.seen('u1')).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });

  it('the interceptor counts only signed-in drivers on HTTP', () => {
    const seen = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const i = new AppSeenInterceptor({ seen } as any);
    const ctx = (user: unknown, type = 'http') =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ getType: () => type, switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;
    const next = { handle: jest.fn() };
    i.intercept(ctx({ userId: 'u1', role: 'driver' }), next);
    i.intercept(ctx({ userId: 'u2', role: 'admin' }), next);
    i.intercept(ctx(undefined), next);
    i.intercept(ctx({ userId: 'u3', role: 'driver' }, 'ws'), next);
    expect(seen.mock.calls).toEqual([['u1']]);
    expect(next.handle).toHaveBeenCalledTimes(4);
  });
});
