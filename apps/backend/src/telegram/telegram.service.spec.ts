import { TelegramService, retryDelayMs } from './telegram.service';

type SendImpl = () => Promise<{ delivered: boolean; skipped?: boolean }>;

function make(report: Record<string, unknown>, sendImpl: SendImpl) {
  const prisma = {
    telegramReport: {
      findUnique: jest.fn().mockResolvedValue(report),
      findUniqueOrThrow: jest.fn().mockResolvedValue(report),
      // The claim an attempt takes before it posts anything.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'r1',
          orderId: 'o1',
          photoUrl: '',
          messageText: 'm',
          status: data.status,
          retryCount: data.retryCount ?? report.retryCount,
          nextAttemptAt: data.nextAttemptAt ?? null,
          lastError: data.lastError ?? null,
          sentAt: data.sentAt ?? null,
          createdAt: new Date(),
        }),
      ),
    },
  };
  const sender = { send: jest.fn().mockImplementation(sendImpl) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new TelegramService(prisma as any, sender as any) };
}

const base = {
  id: 'r1',
  orderId: 'o1',
  photoUrl: '',
  messageText: 'm',
  retryCount: 0,
  status: 'pending',
};

describe('TelegramService send handling', () => {
  it('marks the report sent when delivered', async () => {
    const { svc } = make(base, async () => ({ delivered: true }));
    expect((await svc.retry('r1')).status).toBe('sent');
  });

  it('keeps the report pending, with a next try, when Telegram is not configured', async () => {
    const { svc } = make(base, async () => ({ delivered: false, skipped: true }));
    const res = await svc.retry('r1');
    expect(res.status).toBe('pending');
    expect(res.next_attempt_at).not.toBeNull();
    expect(res.last_error).toBe('telegram_not_configured');
  });

  it('a failed send waits with a growing backoff rather than giving up', async () => {
    const { svc } = make(base, async () => {
      throw new Error('boom');
    });
    // The first failure waits a minute instead of counting towards a quick give-up.
    const res = await svc.retry('r1');
    expect(res.status).toBe('pending');
    expect(res.retry_count).toBe(1);
    expect(res.last_error).toBe('boom');
    const wait = new Date(res.next_attempt_at!).getTime() - Date.now();
    expect(wait).toBeGreaterThan(50_000);
    expect(wait).toBeLessThanOrEqual(60_000);
  });

  it('gives up only after the last of twelve tries', async () => {
    const { svc } = make({ ...base, retryCount: 11 }, async () => {
      throw new Error('boom');
    });
    // Called from the poll (no reset), the twelfth failure is final.
    type Sender = { trySend(id: string): Promise<{ status: string; retry_count: number; next_attempt_at: string | null }> };
    const res = await (svc as unknown as Sender).trySend('r1');
    expect(res.status).toBe('failed');
    expect(res.retry_count).toBe(12);
    expect(res.next_attempt_at).toBeNull();
  });

  it('backoff doubles per attempt and caps at an hour', () => {
    expect([1, 2, 3, 6, 7, 12].map(retryDelayMs)).toEqual([60_000, 120_000, 240_000, 1_920_000, 3_600_000, 3_600_000]);
  });
});

describe('TelegramService.createForDelivery', () => {
  it('includes names and the full first-pickup-to-client duration in the message', async () => {
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue({ user: { name: 'Hamza' } }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Dilnoza' }) },
      telegramReport: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(base),
        update: jest.fn().mockResolvedValue({
          ...base,
          status: 'sent',
          sentAt: new Date(),
          createdAt: new Date(),
        }),
      },
    };
    const sender = { send: jest.fn().mockResolvedValue({ delivered: true }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new TelegramService(prisma as any, sender as any);
    const order = {
      id: 'o1',
      orderNumber: 8,
      clientName: 'Akrom',
      assignedDriverId: 'd1',
      createdBySellerId: 's1',
      journeyStartedAt: new Date('2026-06-28T05:39:00.000Z'),
      deliveredAt: new Date('2026-06-28T07:10:43.709Z'),
      updatedAt: new Date('2026-06-28T07:10:43.709Z'),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await svc.createForDelivery(order as any, null, 'Mijoz mahsulotni tekshirdi');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = (prisma.telegramReport.create.mock.calls[0][0] as any).data.messageText as string;
    expect(msg).toContain('Mijoz: Akrom');
    expect(msg).toContain('Sotuvchi: Dilnoza');
    expect(msg).toContain('Haydovchi: Hamza');
    expect(msg).toContain('Haydovchi izohi: Mijoz mahsulotni tekshirdi');
    expect(msg).toContain('Vaqt: 1 soat 31 daqiqa');
    expect(msg).not.toContain('28.06.2026');
  });

  it('does not add an empty driver comment to the message', async () => {
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue({ user: { name: 'Hamza' } }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Dilnoza' }) },
      telegramReport: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(base),
        update: jest.fn().mockResolvedValue({
          ...base,
          status: 'sent',
          sentAt: new Date(),
          createdAt: new Date(),
        }),
      },
    };
    const sender = { send: jest.fn().mockResolvedValue({ delivered: true }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new TelegramService(prisma as any, sender as any);
    const order = {
      id: 'o1',
      orderNumber: 8,
      clientName: 'Akrom',
      assignedDriverId: 'd1',
      createdBySellerId: 's1',
      updatedAt: new Date('2026-06-28T07:10:43.709Z'),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await svc.createForDelivery(order as any, null, '   ');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = (prisma.telegramReport.create.mock.calls[0][0] as any).data.messageText as string;
    expect(msg).not.toContain('Haydovchi izohi:');
  });
});

describe('TelegramService — fuel and service reports', () => {
  const ORDER = {
    id: 'o1',
    orderNumber: 12,
    clientName: 'Akrom',
    assignedDriverId: 'd1',
    createdBySellerId: 's1',
    returnReason: null,
  };

  function make() {
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue({ user: { name: 'Hamza' } }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Dilnoza' }) },
      vehicle: { findUnique: jest.fn().mockResolvedValue({ plateNumber: '40A400AA', model: 'Isuzu' }) },
      telegramReport: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // createOnce looks for the report first; null means "not written yet".
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'r1', ...data, retryCount: 0 })),
        findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve(prisma.telegramReport.create.mock.results[0]!.value)),
        update: jest.fn().mockResolvedValue({ ...base, status: 'sent', sentAt: new Date(), createdAt: new Date() }),
      },
    };
    const sender = { send: jest.fn().mockResolvedValue({ delivered: true }), fuelChatId: 'fuel-chat', serviceChatId: 'service-chat' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { prisma, sender, svc: new TelegramService(prisma as any, sender as any) };
  }

  it('a confirmed fill-up: the dispenser photo, the numbers, the station — to the fuel group', async () => {
    const { prisma, sender, svc } = make();
    await svc.createForFuel({
      id: 'f1', driverId: 'd1', vehicleId: 'v1', fuelType: 'gaz', photoUrl: 'https://cdn/p.jpg', quantity: 48.81, unitPriceSum: 5000, totalSum: 244_050,
      outcome: 'matched', settlement: 'station_invoice', capturedAt: new Date('2026-09-22T05:00:00Z'),
      resolvedStation: { name: 'UzGaz — Sergeli' }, selectedStation: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const data = prisma.telegramReport.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ fuelLogId: 'f1', target: 'fuel', photoUrl: 'https://cdn/p.jpg' });
    expect(data.messageText).toContain('Shoxobcha: UzGaz — Sergeli');
    expect(data.messageText).toContain("48.81 Nm³ × 5 000 = 244 050 so'm");
    expect(data.messageText).toContain('Mashina: Isuzu · 40A400AA');
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ photoUrl: 'https://cdn/p.jpg' }), 'fuel-chat');
  });

it('the returned items go to the Vozrat group as one album, with the reason in words', async () => {
    const { svc, prisma, sender } = make();
    await svc.createForReturnItems(ORDER as never, [
      { name: 'Sement', unit: 'qop', quantity: 3, condition: 'yaroqsiz', reasonCode: 'm1', otherReason: null, culprit: 'mijoz', photoUrl: 'https://x/1.jpg' },
      { name: 'Qum', unit: 'kg', quantity: 2.5, condition: 'yaroqli', reasonCode: 'x', otherReason: 'Mijoz adashgan', culprit: 'mijoz', photoUrl: 'https://x/2.jpg' },
    ]);
    const data = prisma.telegramReport.create.mock.calls[0][0].data;
    expect(data.target).toBe('vozrat');
    // First photo on the message, the rest as the album behind it.
    expect(data.photoUrl).toContain('1.jpg');
    expect(data.photoUrls).toHaveLength(1);
    expect(data.messageText).toContain('VOZRAT tovarlari (2 ta)');
    expect(data.messageText).toContain('Sement — 3 qop · yaroqsiz · mijoz');
    // The code m1 is never shown; the sentence behind it is.
    expect(data.messageText).toContain('Qabul qilayotganda yaroqsiz holatga keltirgan Mijoz');
    expect(data.messageText).not.toContain('m1');
    // "x" means the driver typed the reason himself.
    expect(data.messageText).toContain('Mijoz adashgan');
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when there are no items', async () => {
    const { svc, prisma } = make();
    await svc.createForReturnItems(ORDER as never, []);
    expect(prisma.telegramReport.create).not.toHaveBeenCalled();
  });

  it('an item whose photo failed to upload still appears in the list', async () => {
    const { svc, prisma } = make();
    await svc.createForReturnItems(ORDER as never, [
      { name: 'Gips', unit: null, quantity: 1, condition: 'yaroqli', reasonCode: 's1', otherReason: null, culprit: 'sotuvchi', photoUrl: null },
    ]);
    const data = prisma.telegramReport.create.mock.calls[0][0].data;
    expect(data.messageText).toContain('Gips — 1 · yaroqli · sotuvchi');
    expect(data.photoUrl).toBe('');
  });

  it('a completed visit: every work photo and the receipt as one album, with the comment — to the service group', async () => {
    const { prisma, sender, svc } = make();
    await svc.createForServiceVisit({
      id: 's1', driverId: 'd1', vehicleId: 'v1', odometerKm: 62_540, totalSum: 640_000, noReceipt: false, outcome: 'matched',
      receiptPhotoUrl: 'https://cdn/receipt.jpg', driverComment: 'Eski qism ustada qoldi', completedAt: new Date('2026-09-22T05:00:00Z'),
      items: [{ name: 'Moy almashtirish', photoUrl: 'https://cdn/1.jpg' }, { name: 'Havo filtri', photoUrl: 'https://cdn/2.jpg' }],
      resolvedCenter: { name: 'Avto Servis — Sergeli' }, selectedCenter: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const data = prisma.telegramReport.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ serviceVisitId: 's1', target: 'service', photoUrl: 'https://cdn/1.jpg', photoUrls: ['https://cdn/2.jpg', 'https://cdn/receipt.jpg'] });
    expect(data.messageText).toContain('SERVIS — Moy almashtirish · Havo filtri');
    expect(data.messageText).toContain('Haydovchi izohi: Eski qism ustada qoldi');
    expect(data.messageText).toContain('Km: 62 540 km');
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ morePhotoUrls: ['https://cdn/2.jpg', 'https://cdn/receipt.jpg'] }), 'service-chat');
  });
});

/**
 * The outbox retries an event whose handler threw part-way, so a report
 * creator can be called twice for one delivery. The group must not see the
 * photo twice.
 */
describe('TelegramService — one report per thing reported', () => {
  function make(existing: unknown) {
    const prisma = {
      driver: { findUnique: jest.fn().mockResolvedValue({ user: { name: 'Hamza' } }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Dilnoza' }) },
      telegramReport: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'r1', ...data, retryCount: 0 })),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r1', target: 'delivery', messageText: 'm', photoUrl: '', photoUrls: [], retryCount: 0 }),
        update: jest.fn().mockResolvedValue({ id: 'r1', status: 'sent', retryCount: 0, sentAt: new Date(), createdAt: new Date() }),
      },
    };
    const sender = { send: jest.fn().mockResolvedValue({ delivered: true }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { prisma, sender, svc: new TelegramService(prisma as any, sender as any) };
  }

  const order = {
    id: 'o1',
    orderNumber: 7,
    clientName: 'Akrom',
    assignedDriverId: 'd1',
    createdBySellerId: 's1',
    updatedAt: new Date(),
    deliveredAt: new Date(),
    journeyStartedAt: null,
  };

  it('names the report after what it reports, and sends it', async () => {
    const { svc, prisma, sender } = make(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await svc.createForDelivery(order as any, 'https://cdn/p.jpg', null);
    expect(prisma.telegramReport.create.mock.calls[0][0].data.dedupeKey).toBe('order:o1:delivery');
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it('a second run of the same event writes nothing and sends nothing', async () => {
    const { svc, prisma, sender } = make({ id: 'r1', dedupeKey: 'order:o1:delivery' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await svc.createForDelivery(order as any, 'https://cdn/p.jpg', null);
    expect(prisma.telegramReport.create).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('two stops of one order keep their own reports', async () => {
    const { svc, prisma } = make(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await svc.createForPickup(order as any, "Do'kon", 'https://cdn/a.jpg', null, 'stop-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await svc.createForPickup(order as any, 'Sklad', 'https://cdn/b.jpg', null, 'stop-2');
    const keys = prisma.telegramReport.create.mock.calls.map((c) => c[0].data.dedupeKey);
    expect(keys).toEqual(['order:o1:pickup:stop-1', 'order:o1:pickup:stop-2']);
  });

  it('two polls at once: the loser stops at the unique index rather than failing', async () => {
    const { svc, prisma, sender } = make(null);
    prisma.telegramReport.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(svc.createForDelivery(order as any, 'https://cdn/p.jpg', null)).resolves.toBeUndefined();
    expect(sender.send).not.toHaveBeenCalled();
  });
});
