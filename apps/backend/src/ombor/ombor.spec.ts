import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { initDataTekshir, initDataYasa, kalitOl, omborTekshir, sababTekshir, yakuniyAybdorlar, type Tovar } from './ombor-rules';
import { reminderHour } from './ombor-reminder.dispatcher';
import { OmborService } from './ombor.service';

const TOKEN = '123456:test-token';
const tovar = (over: Partial<Tovar> = {}): Tovar => ({ nom: 'Сетка', soni: 2, birlik: 'дона', holat: 'yaroqli', sabab: 's1', ...over });

describe('Omborchi rules (moved from the mini app, owner 05.11.2026)', () => {
  it('a reason decides the blame; "another reason" needs its text and the blame', () => {
    expect(sababTekshir({ sabab: 'm2' })).toEqual({ izoh_sabab: '', aybdor: 'mijoz' });
    expect(sababTekshir({ sabab: 'x', izoh_sabab: 'Ёмғирда қолган', aybdor: 'haydovchi' })).toEqual({ izoh_sabab: 'Ёмғирда қолган', aybdor: 'haydovchi' });
    expect(sababTekshir({ sabab: 'x', izoh_sabab: '' })).toEqual({ xato: 'izoh' });
    expect(sababTekshir({ sabab: 'zz' })).toEqual({ xato: 'sabab' });
  });

  it("checks the storekeeper's count item by item", () => {
    const items = [tovar(), tovar({ nom: 'Труба' })];
    const ok = omborTekshir({ izoh: ' 1 таси келмади ', tovarlar: [
      { nom: 'Сетка', soni: 2, holat: 'yaroqli', sabab: 'o1', mahsulot_id: 7 },
      { nom: '', soni: 0, holat: 'yaroqsiz', sabab: 'h1' },
    ] }, items);
    expect(ok).toEqual({
      izoh: '1 таси келмади',
      v: [
        { nom: 'Сетка', soni: 2, holat: 'yaroqli', sabab: 'o1', izoh_sabab: '', aybdor: 'omborchi', mahsulot_id: 7 },
        { nom: 'Труба', soni: 0, holat: 'yaroqsiz', sabab: 'h1', izoh_sabab: '', aybdor: 'haydovchi', mahsulot_id: null },
      ],
    });
    expect(omborTekshir({ tovarlar: [{ soni: 1, holat: 'yaroqli', sabab: 's1' }] }, items)).toEqual({ xato: 'Ҳар бир товарни тўлдиринг' });
    expect(omborTekshir({ tovarlar: [{ soni: 1, sabab: 's1' }, { soni: 1, holat: 'yaroqli', sabab: 's1' }] }, items)).toEqual({ xato: '1-товар: ҳолатини танланг' });
  });

  it("the final blame is the storekeeper's when he wrote one, else the driver's", () => {
    const items = [tovar({ sabab: 's2' }), tovar({ sabab: 'x', aybdor: 'mijoz' })];
    expect(yakuniyAybdorlar(items, null)).toEqual(['sotuvchi', 'mijoz']);
    const answer = [{ nom: 'a', soni: 1, holat: 'yaroqli', sabab: 'h1', izoh_sabab: '', aybdor: 'haydovchi', mahsulot_id: null }] as never;
    expect(yakuniyAybdorlar(items, answer)[0]).toBe('haydovchi');
  });

  it('folds a product name for comparing', () => {
    expect(kalitOl('Дорожная  сетка 10×10 «д-4мм»')).toBe('дорожнаясетка10x10д4мм');
    expect(kalitOl('Ёлка')).toBe('елка');
  });

  it("signs in only with Telegram's signature, and not with an old one", () => {
    const now = Date.now();
    const data = initDataYasa({ id: 100000001, first_name: 'Бекзод' }, TOKEN, Math.floor(now / 1000));
    expect(initDataTekshir(data, TOKEN, { hozir: now })).toEqual({ ok: true, uid: '100000001', ism: 'Бекзод' });
    expect(initDataTekshir(data, 'other:token', { hozir: now })).toEqual({ ok: false, xato: 'имзо нотўғри' });
    expect(initDataTekshir(data.replace('100000001', '100000002'), TOKEN, { hozir: now }).ok).toBe(false);
    expect(initDataTekshir(data, TOKEN, { hozir: now + 2 * 86_400_000 }).ok).toBe(false);
  });

  it('takes an initData for an hour only (audit, 07.11.2026)', () => {
    const now = Date.now();
    const data = initDataYasa({ id: 42 }, TOKEN, Math.floor(now / 1000));
    expect(initDataTekshir(data, TOKEN, { hozir: now + 59 * 60_000 }).ok).toBe(true);
    expect(initDataTekshir(data, TOKEN, { hozir: now + 61 * 60_000 })).toEqual({ ok: false, xato: 'муддати ўтган — иловани қайта очинг' });
  });

  it('a count of 0 needs no condition; it is kept as yaroqsiz (audit, 07.11.2026)', () => {
    expect(omborTekshir({ tovarlar: [{ soni: 0, sabab: 'h1' }] }, [tovar()])).toMatchObject({ v: [{ soni: 0, holat: 'yaroqsiz' }] });
    expect(omborTekshir({ tovarlar: [{ soni: 0, holat: 'yaroqli', sabab: 'h1' }] }, [tovar()])).toMatchObject({ v: [{ holat: 'yaroqli' }] });
    expect(omborTekshir({ tovarlar: [{ soni: 1, sabab: 'h1' }] }, [tovar()])).toEqual({ xato: '1-товар: ҳолатини танланг' });
  });

  it('reminds once an hour at a quarter past, 10:15 to 19:15 Tashkent', () => {
    expect(reminderHour(new Date('2026-11-05T05:16:00Z'))).toBe('2026-11-05T10');
    expect(reminderHour(new Date('2026-11-05T05:10:00Z'))).toBeNull();
    expect(reminderHour(new Date('2026-11-05T14:59:00Z'))).toBe('2026-11-05T19');
    expect(reminderHour(new Date('2026-11-05T15:15:00Z'))).toBeNull();
  });
});

describe('OmborService', () => {
  function setup(row: Record<string, unknown> | null) {
    const prisma = {
      vozvratStaff: {
        findUnique: jest.fn().mockResolvedValue({ telegramId: '42', name: 'Ali', roles: ['omborchi'] }),
        findMany: jest.fn().mockResolvedValue([{ telegramId: '42' }]),
      },
      warehouseReturn: {
        findUnique: jest.fn().mockResolvedValue(row),
        // accept() reads the rows of that number; a row is the warehouse's unless it says otherwise.
        findMany: jest.fn().mockResolvedValue(row ? [{ destination: 'warehouse', ...row }] : []),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vozvratProduct: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, name: 'Сетка', unit: null, hodovoy: true, status: 'tasdiq', addedBy: null, firstReturnNumber: null }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 8, name: 'Янги', unit: null, hodovoy: null, status: 'yangi', addedBy: null, firstReturnNumber: 151 }),
      },
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ returnDestination: 'warehouse', pickupSources: [{ returnDestination: 'warehouse' }] }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Admin' }) },
    };
    // (owner, 07.11.2026) The claim and the driver's flag run in one transaction.
    const $transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
    Object.assign(prisma, { $transaction });
    const upload = { uploadBase64: jest.fn().mockResolvedValue('https://x/media/ombor/1.jpg') };
    const bot = { token: TOKEN, send: jest.fn().mockResolvedValue(1) };
    const env: Record<string, string> = { JWT_ACCESS_SECRET: 'secret-for-tests', MEDIA_PUBLIC_URL: 'https://x/media/' };
    const config = { get: (k: string) => env[k] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new OmborService(prisma as any, upload as any, bot as any, config as any);
    return { prisma, bot, service, $transaction };
  }
  const user = { telegramId: '42', name: 'Ali', roles: ['omborchi'] };
  const malumot = { tovarlar: [{ nom: 'Сетка', soni: 2, holat: 'yaroqsiz', sabab: 'h1', mahsulot_id: 7 }] };

  it('gives a pass to someone on the list and reads it back', async () => {
    const { service } = setup(null);
    const now = Date.now();
    const s = await service.session(initDataYasa({ id: 42 }, TOKEN, Math.floor(now / 1000)), now);
    expect(s.user).toEqual(user);
    await expect(service.auth(s.token, now)).resolves.toEqual(user);
    await expect(service.auth(s.token + 'x', now)).rejects.toThrow();
    await expect(service.auth(s.token, now + 13 * 3_600_000)).rejects.toThrow();
  });

  it('refuses a broken item without its photos', async () => {
    const { service } = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, acceptedAt: null, items: [tovar()] });
    await expect(service.accept(user, 151, { malumot, rasmlar: { '0u': 'https://x/media/ombor/a.jpg' }, umumiy: 'https://x/media/ombor/u.jpg' })).rejects.toThrow(
      '1-товар: яроқсиз жойининг расмини олинг',
    );
    await expect(service.accept(user, 151, { malumot, rasmlar: { '0u': 'https://x/media/ombor/a.jpg', '0y': 'https://x/media/ombor/b.jpg' } })).rejects.toThrow(
      'Ҳаммасини битта умумий расмга олинг',
    );
  });

  it('takes a return in and opens the driver\'s "Topshirdim"', async () => {
    const { prisma, service } = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, acceptedAt: null, items: [tovar()] });
    await expect(
      service.accept(user, 151, { malumot, rasmlar: { '0u': 'https://x/media/ombor/a.jpg', '0y': 'https://x/media/ombor/b.jpg' }, umumiy: 'https://x/media/ombor/u.jpg' }),
    ).resolves.toEqual({ ok: true });
    const saved = prisma.warehouseReturn.updateMany.mock.calls[0][0];
    expect(saved.where).toEqual({ id: 'w1', acceptedAt: null });
    expect(saved.data.answer[0]).toMatchObject({ nom: 'Сетка', aybdor: 'haydovchi', rasm: { u: 'https://x/media/ombor/a.jpg', y: 'https://x/media/ombor/b.jpg' } });
    expect(saved.data.acceptedByName).toBe('Ali');
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', returnWarehouseAcceptedAt: null },
      data: { returnWarehouseAcceptedAt: expect.any(Date) },
    });
  });

  const P = 'https://x/media/ombor/';

  it('takes only photos this server stored for the warehouse, each once (audit, 07.11.2026)', async () => {
    const { prisma, service } = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, acceptedAt: null, items: [tovar()] });
    for (const u of ['https://evil.example/ombor/a.jpg', 'https://x/media/delivery-proofs/a.jpg']) {
      await expect(service.accept(user, 151, { malumot, rasmlar: { '0u': u, '0y': P + 'b.jpg' }, umumiy: P + 'u.jpg' })).rejects.toThrow('1-товар: умумий расмни олинг');
    }
    await expect(service.accept(user, 151, { malumot, rasmlar: { '0u': P + 'a.jpg', '0y': P + 'a.jpg' }, umumiy: P + 'u.jpg' })).rejects.toThrow(
      'Битта расм икки марта юборилган',
    );
    await expect(service.accept(user, 151, { malumot, rasmlar: { '0u': P + 'a.jpg', '0y': P + 'b.jpg' }, umumiy: P + 'a.jpg' })).rejects.toThrow(
      'Битта расм икки марта юборилган',
    );
    expect(prisma.warehouseReturn.updateMany).not.toHaveBeenCalled();
  });

  it('an item of which none came needs no photo; when none came at all, no overall photo either (audit, 07.11.2026)', async () => {
    const { prisma, service } = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, acceptedAt: null, items: [tovar(), tovar({ nom: 'Труба' })] });
    const ikki = (a: number, b: number) => ({
      tovarlar: [
        { nom: 'Сетка', soni: a, holat: a ? 'yaroqli' : undefined, sabab: 'h1', mahsulot_id: 7 },
        { nom: 'Труба', soni: b, sabab: 'h1', mahsulot_id: 7 },
      ],
    });
    // One came, one did not: the one that came still wants its photo, and the overall one is still asked for.
    await expect(service.accept(user, 151, { malumot: ikki(2, 0), rasmlar: { '0u': P + 'a.jpg' } })).rejects.toThrow('Ҳаммасини битта умумий расмга олинг');
    await expect(service.accept(user, 151, { malumot: ikki(2, 0), rasmlar: {}, umumiy: P + 'u.jpg' })).rejects.toThrow('1-товар: умумий расмни олинг');
    await expect(service.accept(user, 151, { malumot: ikki(2, 0), rasmlar: { '0u': P + 'a.jpg' }, umumiy: P + 'u.jpg' })).resolves.toEqual({ ok: true });
    let saved = prisma.warehouseReturn.updateMany.mock.calls[0][0].data;
    expect(saved.answer[1]).toMatchObject({ soni: 0, holat: 'yaroqsiz' });
    expect(saved.answer[1].rasm).toBeUndefined();
    // Nothing came at all.
    prisma.warehouseReturn.updateMany.mockClear();
    await expect(service.accept(user, 151, { malumot: ikki(0, 0), rasmlar: {} })).resolves.toEqual({ ok: true });
    saved = prisma.warehouseReturn.updateMany.mock.calls[0][0].data;
    expect(saved.overallPhotoUrl).toBeNull();
  });

  it('a storekeeper who lost the race adds no product to the list (audit, 07.11.2026)', async () => {
    const { prisma, service } = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, acceptedAt: null, items: [tovar()] });
    prisma.vozvratProduct.findUnique.mockResolvedValue(null);
    prisma.warehouseReturn.updateMany.mockResolvedValue({ count: 0 });
    const yangi = { tovarlar: [{ nom: 'Мутлақо янги товар', soni: 2, holat: 'yaroqli', sabab: 'h1' }] };
    const body = { malumot: yangi, rasmlar: { '0u': P + 'a.jpg' }, umumiy: P + 'u.jpg' };
    await expect(service.accept(user, 151, body)).rejects.toThrow('Бу возврат қабул қилинган');
    expect(prisma.vozvratProduct.create).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    // The winner does add it, and the saved count carries its id.
    prisma.warehouseReturn.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.accept(user, 151, body)).resolves.toEqual({ ok: true });
    expect(prisma.vozvratProduct.create).toHaveBeenCalledTimes(1);
    expect(prisma.warehouseReturn.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { answer: [expect.objectContaining({ mahsulot_id: 8 })] } });
  });

  it('lists every return still waiting, and the newest 50 taken in (audit, 07.11.2026)', async () => {
    const { prisma, service } = setup(null);
    const row = (n: number, accepted: boolean) => ({
      id: `w${n}`, orderId: `o${n}`, orderNumber: n, at: new Date(), driverName: 'd', clientName: 'c', sellerName: 's', comment: null, items: [],
      answer: accepted ? [] : null, answerComment: null, acceptedAt: accepted ? new Date() : null, overallPhotoUrl: null, acceptedByName: null,
    });
    prisma.warehouseReturn.findMany.mockResolvedValueOnce([row(5, false), row(1, false)]).mockResolvedValueOnce([row(9, true), row(3, true)]);
    const list = await service.list(user);
    expect(list.map((r) => r.id)).toEqual([9, 5, 3, 1]);
    const destination = { in: ['warehouse'] };
    expect(prisma.warehouseReturn.findMany).toHaveBeenCalledWith({ where: { destination, OR: [{ acceptedAt: null }, { releasedByOffice: true, acceptedByTelegramId: null }] }, orderBy: { orderNumber: 'desc' } });
    expect(prisma.warehouseReturn.findMany).toHaveBeenCalledWith({ where: { destination, acceptedAt: { not: null }, NOT: { releasedByOffice: true, acceptedByTelegramId: null } }, orderBy: { orderNumber: 'desc' }, take: 50 });
  });

  it('names at most 20 returns in a reminder, and marks them only once it went out (audit, 07.11.2026)', async () => {
    const { prisma, bot, service } = setup(null);
    prisma.warehouseReturn.findMany.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: `w${i}`, orderNumber: 100 + i })));
    bot.send.mockResolvedValueOnce(0);
    await expect(service.remind(new Date())).resolves.toBe(0);
    expect(prisma.warehouseReturn.updateMany).not.toHaveBeenCalled();
    const text: string = bot.send.mock.calls[0][1];
    expect(text).toContain('25 та возврат');
    expect(text).toContain('№119 … яна 5 та)');
    expect(text).not.toContain('№120');
    await expect(service.remind(new Date())).resolves.toBe(25);
    expect(prisma.warehouseReturn.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not take the same return in twice', async () => {
    const { service } = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, acceptedAt: new Date(), items: [tovar()] });
    await expect(service.accept(user, 151, { malumot })).rejects.toThrow('Бу возврат қабул қилинган');
  });

  it('keeps a confirmed return once and tells the storekeepers', async () => {
    const { prisma, bot, service } = setup(null);
    prisma.warehouseReturn.findUnique.mockResolvedValue(null);
    await service.receive('o1', {
      id: '151', sana: '2026-11-05T10:00:00+05:00', haydovchi: 'Ravshan', mijoz: 'Aziz', sotuvchi: 'Nodir', sotuvchi_id: null, izoh: '',
      tovarlar: [{ nom: 'Сетка', soni: 2, holat: 'yaroqli', sabab: 's1', mahsulot_id: 7 }],
    });
    const created = prisma.warehouseReturn.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ orderId: 'o1', orderNumber: 151, driverName: 'Ravshan', clientName: 'Aziz', sellerName: 'Nodir' });
    expect(bot.send).toHaveBeenCalledWith(['42'], expect.stringContaining('Возврат №151 омборга келяпти'));
    prisma.warehouseReturn.findUnique.mockResolvedValue({ id: 'w1' });
    prisma.warehouseReturn.create.mockClear();
    await service.receive('o1', { id: '151' } as never);
    expect(prisma.warehouseReturn.create).not.toHaveBeenCalled();
  });

  it('a catalogue id that cannot be a row does not fail the receive (owner, 07.11.2026)', async () => {
    const { prisma, service } = setup(null);
    prisma.warehouseReturn.findUnique.mockResolvedValue(null);
    // Postgres would refuse 9999999999 for an INTEGER column: it is never looked up.
    prisma.vozvratProduct.findUnique.mockImplementation(async (q: { where: { id?: number; key?: string } }) => {
      if (q.where.id != null) throw new Error('value out of range for type integer');
      return null;
    });
    await expect(
      service.receive('o1', {
        id: '151', sana: '2026-11-05T10:00:00+05:00', haydovchi: 'Ravshan', mijoz: 'Aziz', sotuvchi: 'Nodir', sotuvchi_id: null, izoh: '',
        tovarlar: [{ nom: 'Сетка', soni: 2, holat: 'yaroqli', sabab: 's1', mahsulot_id: '9999999999' as unknown as number }],
      }),
    ).resolves.toEqual(['warehouse']);
    expect(prisma.vozvratProduct.findUnique).not.toHaveBeenCalledWith({ where: { id: expect.anything() } });
    expect(prisma.warehouseReturn.create).toHaveBeenCalledTimes(1);
    expect(prisma.warehouseReturn.create.mock.calls[0][0].data).toMatchObject({ orderId: 'o1', orderNumber: 151 });
  });

  it('a number past 2147483647 is not looked up either (owner, 07.11.2026)', async () => {
    const { prisma, service } = setup(null);
    prisma.warehouseReturn.findUnique.mockResolvedValue(null);
    prisma.vozvratProduct.findUnique.mockResolvedValue(null);
    await expect(
      service.receive('o1', {
        id: '151', sana: '2026-11-05T10:00:00+05:00', haydovchi: 'Ravshan', mijoz: 'Aziz', sotuvchi: 'Nodir', sotuvchi_id: null, izoh: '',
        tovarlar: [{ nom: 'Сетка', soni: 2, holat: 'yaroqli', sabab: 's1', mahsulot_id: 9999999999 }],
      }),
    ).resolves.toEqual(['warehouse']);
    expect(prisma.vozvratProduct.findUnique).not.toHaveBeenCalledWith({ where: { id: expect.anything() } });
  });

  it('any catalogue lookup error falls back to no binding, and the receive goes on (owner, 07.11.2026)', async () => {
    const { prisma, service } = setup(null);
    prisma.warehouseReturn.findUnique.mockResolvedValue(null);
    prisma.vozvratProduct.findUnique.mockRejectedValue(new Error('db down'));
    await expect(service.receive('o1', payload)).resolves.toEqual(['warehouse']);
    const items = prisma.warehouseReturn.create.mock.calls[0][0].data.items;
    expect(items[0]).toMatchObject({ nom: 'Сетка', mahsulot_id: null });
  });

  // ---- by destination (owner, 07.11.2026) ----------------------------------------

  const payload = {
    id: '151', sana: '2026-11-05T10:00:00+05:00', haydovchi: 'Ravshan', mijoz: 'Aziz', sotuvchi: 'Nodir', sotuvchi_id: null, izoh: '',
    tovarlar: [{ nom: 'Сетка', soni: 2, holat: 'yaroqli' as const, sabab: 's1', mahsulot_id: 7 }],
  };
  /** Staff by role: 42 keeps the warehouse, 77 the shop. */
  function byRole(prisma: ReturnType<typeof setup>['prisma']) {
    prisma.vozvratStaff.findMany.mockImplementation(async (q: { where: { roles: { has: string } } }) =>
      q.where.roles.has === 'dokonchi' ? [{ telegramId: '77' }] : q.where.roles.has === 'omborchi' ? [{ telegramId: '42' }] : [],
    );
  }
  const stops = (...d: (string | null)[]) => ({ returnDestination: null, pickupSources: d.map((returnDestination) => ({ returnDestination })) });
  const dokonchi = { telegramId: '77', name: 'Vali', roles: ['dokonchi'] };

  it("a store return goes to the shop person only, marked as the store's", async () => {
    const { prisma, bot, service } = setup(null);
    byRole(prisma);
    prisma.order.findUnique.mockResolvedValue(stops('store'));
    await expect(service.receive('o1', payload)).resolves.toEqual(['store']);
    expect(prisma.warehouseReturn.create).toHaveBeenCalledTimes(1);
    expect(prisma.warehouseReturn.create.mock.calls[0][0].data).toMatchObject({ orderId: 'o1', orderNumber: 151, destination: 'store' });
    expect(bot.send).toHaveBeenCalledTimes(1);
    expect(bot.send).toHaveBeenCalledWith(['77'], expect.stringContaining('Возврат №151 дўконга келяпти'));
    expect(prisma.warehouseReturn.findUnique).toHaveBeenCalledWith({ where: { orderId_destination: { orderId: 'o1', destination: 'store' } }, select: { id: true } });
  });

  it('a muted storekeeper gets no message; the others do (owner, 11.11.2026)', async () => {
    const { prisma, bot, service } = setup(null);
    prisma.vozvratStaff.findMany.mockImplementation(async (q: { where: { roles: { has: string }; muted?: boolean } }) =>
      // 42 is muted: asked for the unmuted only, the list leaves him out.
      q.where.roles.has === 'omborchi' ? (q.where.muted === false ? [{ telegramId: '43' }] : [{ telegramId: '42' }, { telegramId: '43' }]) : [],
    );
    prisma.order.findUnique.mockResolvedValue(stops('warehouse'));
    await service.receive('o1', payload);
    expect(bot.send).toHaveBeenCalledWith(['43'], expect.any(String));
  });

  it('a warehouse return goes to the storekeepers only', async () => {
    const { prisma, bot, service } = setup(null);
    byRole(prisma);
    await expect(service.receive('o1', payload)).resolves.toEqual(['warehouse']);
    expect(prisma.warehouseReturn.create.mock.calls[0][0].data.destination).toBe('warehouse');
    expect(bot.send).toHaveBeenCalledWith(['42'], expect.stringContaining('Возврат №151 омборга келяпти'));
    expect(bot.send).toHaveBeenCalledTimes(1);
  });

  it('a supplier return creates nothing and tells no one', async () => {
    const { prisma, bot, service } = setup(null);
    byRole(prisma);
    prisma.order.findUnique.mockResolvedValue(stops('supplier'));
    await expect(service.receive('o1', payload)).resolves.toEqual([]);
    expect(prisma.warehouseReturn.create).not.toHaveBeenCalled();
    expect(bot.send).not.toHaveBeenCalled();
  });

  it('an order with stops to the warehouse, the shop and a supplier gets one row for each of the first two', async () => {
    const { prisma, bot, service } = setup(null);
    byRole(prisma);
    prisma.order.findUnique.mockResolvedValue(stops('store', 'supplier', 'warehouse'));
    await expect(service.receive('o1', payload)).resolves.toEqual(['warehouse', 'store']);
    expect(prisma.warehouseReturn.create.mock.calls.map((c) => c[0].data.destination)).toEqual(['warehouse', 'store']);
    expect(bot.send).toHaveBeenCalledWith(['42'], expect.stringContaining('келмаган товарга 0 ёзинг'));
    expect(bot.send).toHaveBeenCalledWith(['77'], expect.stringContaining('дўконга келяпти'));
  });

  it("a storekeeper cannot take a shop's return in, nor a shop person the warehouse's", async () => {
    const body = { malumot, rasmlar: { '0u': P + 'a.jpg', '0y': P + 'b.jpg' }, umumiy: P + 'u.jpg' };
    const store = setup({ id: 'w2', orderId: 'o1', orderNumber: 151, destination: 'store', acceptedAt: null, items: [tovar()] });
    await expect(store.service.accept(user, 151, body)).rejects.toBeInstanceOf(ForbiddenException);
    expect(store.prisma.warehouseReturn.updateMany).not.toHaveBeenCalled();
    const wh = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, destination: 'warehouse', acceptedAt: null, items: [tovar()] });
    await expect(wh.service.accept(dokonchi, 151, body)).rejects.toBeInstanceOf(ForbiddenException);
    expect(wh.prisma.order.updateMany).not.toHaveBeenCalled();
    // The shop person takes the shop's in: that opens the store stop, not the warehouse one.
    await expect(store.service.accept(dokonchi, 151, body)).resolves.toEqual({ ok: true });
    expect(store.prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', returnStoreAcceptedAt: null },
      data: { returnStoreAcceptedAt: expect.any(Date) },
    });
  });

  it("lists a shop person only the shop's returns", async () => {
    const { prisma, service } = setup(null);
    prisma.warehouseReturn.findMany.mockResolvedValue([]);
    await service.list(dokonchi);
    expect(prisma.warehouseReturn.findMany).toHaveBeenCalledWith({ where: { destination: { in: ['store'] }, OR: [{ acceptedAt: null }, { releasedByOffice: true, acceptedByTelegramId: null }] }, orderBy: { orderNumber: 'desc' } });
    await expect(service.list({ ...dokonchi, roles: ['rahbar'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps the shop person on the staff list, and nothing else', async () => {
    const { prisma, service } = setup(null);
    const upsert = jest.fn().mockImplementation(async (q: { create: object }) => ({ id: 's1', ...q.create }));
    (prisma.vozvratStaff as Record<string, unknown>).upsert = upsert;
    prisma.vozvratStaff.findUnique.mockResolvedValue(null);
    await expect(service.staffSave({ telegram_id: '777777', name: 'Vali', roles: ['dokonchi', 'admin'] })).resolves.toMatchObject({ roles: ['dokonchi'] });
    await expect(service.staffSave({ telegram_id: '777777', name: 'Vali', roles: ['admin'] })).rejects.toThrow('roles');
  });

  it('re-adding a person with another role merges it into the old one (owner, 09.11.2026)', async () => {
    const { prisma, service } = setup(null);
    const upsert = jest.fn().mockImplementation(async (q: { update: { name: string; roles: string[] } }) => ({ id: 's1', telegramId: '424242', ...q.update }));
    (prisma.vozvratStaff as Record<string, unknown>).upsert = upsert;
    // 424242 is already an omborchi; the owner re-adds himself as dokonchi.
    prisma.vozvratStaff.findUnique.mockResolvedValue({ telegramId: '424242', name: 'Ali', roles: ['omborchi'] });
    await expect(service.staffSave({ telegram_id: '424242', name: 'Ali', roles: ['dokonchi'] })).resolves.toEqual({ id: 's1', telegram_id: '424242', name: 'Ali', roles: ['omborchi', 'dokonchi'] });
    expect(upsert).toHaveBeenCalledWith({
      where: { telegramId: '424242' },
      create: { telegramId: '424242', name: 'Ali', roles: ['dokonchi'] },
      update: { name: 'Ali', roles: ['omborchi', 'dokonchi'] },
    });
    await expect(service.staffSave({ telegram_id: '424242', name: 'Ali', roles: [] })).rejects.toThrow('roles');
  });

  it('the checkboxes save the exact set; an empty set is refused (owner, 09.11.2026)', async () => {
    const { prisma, service } = setup(null);
    prisma.vozvratStaff.findUnique.mockResolvedValue({ id: 's1', telegramId: '42', name: 'Ali', roles: ['omborchi', 'dokonchi'] });
    const update = jest.fn().mockImplementation(async (q: { data: { roles: string[] } }) => ({ id: 's1', telegramId: '42', name: 'Ali', ...q.data }));
    (prisma.vozvratStaff as Record<string, unknown>).update = update;
    await expect(service.staffSetRoles('s1', ['dokonchi'])).resolves.toMatchObject({ roles: ['dokonchi'] });
    expect(update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { roles: ['dokonchi'] } });
    await expect(service.staffSetRoles('s1', ['dokonchi', 'omborchi', 'dokonchi'])).resolves.toMatchObject({ roles: ['omborchi', 'dokonchi'] });
    update.mockClear();
    await expect(service.staffSetRoles('s1', [])).rejects.toThrow('roles');
    await expect(service.staffSetRoles('s1', ['admin'])).rejects.toThrow('roles');
    await expect(service.staffSetRoles('s1', undefined)).rejects.toThrow('roles');
    expect(update).not.toHaveBeenCalled();
    prisma.vozvratStaff.findUnique.mockResolvedValue(null);
    await expect(service.staffSetRoles('nope', ['omborchi'])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the office marks a waiting return taken in: the driver may hand it over; only once', async () => {
    const { prisma, service } = setup({ id: 'w2', orderId: 'o1', orderNumber: 151, destination: 'store', acceptedAt: null, items: [tovar()] });
    await expect(service.release('w2', 'u1')).resolves.toEqual({ ok: true });
    expect(prisma.warehouseReturn.updateMany).toHaveBeenCalledWith({
      where: { id: 'w2', acceptedAt: null },
      data: { acceptedAt: expect.any(Date), acceptedByName: 'Admin (ofis)', acceptedByTelegramId: null, releasedByOffice: true },
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', returnStoreAcceptedAt: null },
      data: { returnStoreAcceptedAt: expect.any(Date) },
    });
    // No count, no photos: nothing else is written.
    expect(prisma.warehouseReturn.update).not.toHaveBeenCalled();
    // Taken in meanwhile (lost the race): 409 and the driver's flag is left alone.
    prisma.order.updateMany.mockClear();
    prisma.warehouseReturn.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.release('w2', 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    // Already taken in when read, and the driver already freed: 409 too.
    prisma.warehouseReturn.findUnique.mockResolvedValue({ id: 'w2', orderId: 'o1', destination: 'store', acceptedAt: new Date() });
    prisma.order.findUnique.mockResolvedValue({ returnWarehouseAcceptedAt: null, returnStoreAcceptedAt: new Date() });
    await expect(service.release('w2', 'u1')).rejects.toThrow('return_already_accepted');
    prisma.warehouseReturn.findUnique.mockResolvedValue(null);
    await expect(service.release('nope', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('a late count after the office released it (owner, 07.11.2026)', () => {
    const body = { malumot, rasmlar: { '0u': P + 'a.jpg', '0y': P + 'b.jpg' }, umumiy: P + 'u.jpg' };
    const released = (extra: Record<string, unknown> = {}) => ({
      id: 'w2', orderId: 'o1', orderNumber: 151, destination: 'store', items: [tovar()],
      acceptedAt: new Date('2026-11-07T08:00:00Z'), acceptedByName: 'Admin (ofis)', acceptedByTelegramId: null, answer: null,
      releasedByOffice: true, ...extra,
    });

    it('release, then the shop person counts it once; a second late count is refused', async () => {
      const { prisma, service } = setup({ id: 'w2', orderId: 'o1', orderNumber: 151, destination: 'store', acceptedAt: null, items: [tovar()] });
      await service.release('w2', 'u1');
      prisma.order.updateMany.mockClear();
      prisma.warehouseReturn.updateMany.mockClear();
      prisma.warehouseReturn.findMany.mockResolvedValue([released()]);
      await expect(service.accept(dokonchi, 151, body)).resolves.toEqual({ ok: true });
      const saved = prisma.warehouseReturn.updateMany.mock.calls[0][0];
      // Conditional on no count yet, so it happens once; the release time stays.
      expect(saved.where).toEqual({ id: 'w2', releasedByOffice: true, acceptedByTelegramId: null });
      expect(saved.data).toMatchObject({ acceptedByTelegramId: '77', acceptedByName: 'Vali', overallPhotoUrl: P + 'u.jpg' });
      expect(saved.data.answer[0]).toMatchObject({ nom: 'Сетка', rasm: { u: P + 'a.jpg', y: P + 'b.jpg' } });
      expect(saved.data).not.toHaveProperty('acceptedAt');
      // The driver was freed by the office already: his gate is left alone.
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      // A second late count lands after the first: the conditional write finds nothing.
      prisma.warehouseReturn.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.accept(dokonchi, 151, body)).rejects.toBeInstanceOf(ConflictException);
      // Read again, it now carries the count: 409 before anything is written.
      prisma.warehouseReturn.updateMany.mockClear();
      prisma.warehouseReturn.findMany.mockResolvedValue([released({ acceptedByTelegramId: '77', acceptedByName: 'Vali', answer: [] })]);
      await expect(service.accept(dokonchi, 151, body)).rejects.toThrow('Бу возврат қабул қилинган');
      expect(prisma.warehouseReturn.updateMany).not.toHaveBeenCalled();
    });

    it('a row the storekeeper took in normally still answers 409', async () => {
      const { prisma, service } = setup(null);
      prisma.warehouseReturn.findMany.mockResolvedValue([
        released({ destination: 'warehouse', releasedByOffice: false, acceptedByTelegramId: '42', acceptedByName: 'Ali', answer: [] }),
      ]);
      await expect(service.accept(user, 151, body)).rejects.toThrow('Бу возврат қабул қилинган');
      expect(prisma.warehouseReturn.updateMany).not.toHaveBeenCalled();
    });

    it('the page lists a released row with no count as still to count', async () => {
      const { prisma, service } = setup(null);
      const view = (r: Record<string, unknown>) => ({
        at: new Date(), driverName: 'd', clientName: 'c', sellerName: 's', comment: null, answerComment: null, overallPhotoUrl: null, ...r,
      });
      prisma.warehouseReturn.findMany
        .mockResolvedValueOnce([view(released({ destination: 'warehouse', items: [] }))])
        .mockResolvedValueOnce([view(released({ id: 'w3', orderNumber: 150, destination: 'warehouse', items: [], acceptedByTelegramId: '42', answer: [] }))]);
      const list = await service.list(user);
      expect(list.map((r) => [r.id, r.holat, r.sanash])).toEqual([
        [151, 'qabul', true],
        [150, 'qabul', false],
      ]);
    });
  });

  describe('taking in and freeing the driver are one step (owner, 07.11.2026)', () => {
    const body = { malumot, rasmlar: { '0u': P + 'a.jpg', '0y': P + 'b.jpg' }, umumiy: P + 'u.jpg' };

    it('accept: the claim and the driver flag run inside one transaction; a failing flag fails the accept', async () => {
      const { prisma, service, $transaction } = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, acceptedAt: null, items: [tovar()] });
      prisma.order.updateMany.mockRejectedValueOnce(new Error('db down'));
      await expect(service.accept(user, 151, body)).rejects.toThrow('db down');
      expect($transaction).toHaveBeenCalledTimes(1);
      // The product names are not tied when the step failed.
      expect(prisma.warehouseReturn.update).not.toHaveBeenCalled();
      // Both writes went through the transaction client, the binding after it.
      await expect(service.accept(user, 151, body)).resolves.toEqual({ ok: true });
      expect($transaction).toHaveBeenCalledTimes(2);
      const claim = prisma.warehouseReturn.updateMany.mock.invocationCallOrder[1];
      const flag = prisma.order.updateMany.mock.invocationCallOrder[1];
      const bind = prisma.warehouseReturn.update.mock.invocationCallOrder[0];
      expect(claim).toBeLessThan(flag);
      expect(flag).toBeLessThan(bind);
    });

    it('release: the mark and the driver flag run inside one transaction', async () => {
      const { prisma, service, $transaction } = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, destination: 'warehouse', acceptedAt: null, items: [tovar()] });
      await expect(service.release('w1', 'u1')).resolves.toEqual({ ok: true });
      expect($transaction).toHaveBeenCalledTimes(1);
      expect(prisma.warehouseReturn.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
    });

    it('release on a row taken in whose driver was never freed frees him and answers ok', async () => {
      const { prisma, service } = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, destination: 'warehouse', acceptedAt: new Date(), items: [tovar()] });
      prisma.order.findUnique.mockResolvedValue({ returnWarehouseAcceptedAt: null, returnStoreAcceptedAt: new Date() });
      await expect(service.release('w1', 'u1')).resolves.toEqual({ ok: true });
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'o1', returnWarehouseAcceptedAt: null },
        data: { returnWarehouseAcceptedAt: expect.any(Date) },
      });
      // The row itself is left as it is.
      expect(prisma.warehouseReturn.updateMany).not.toHaveBeenCalled();
      // Once he is free, a second press is 409.
      prisma.order.findUnique.mockResolvedValue({ returnWarehouseAcceptedAt: new Date(), returnStoreAcceptedAt: null });
      await expect(service.release('w1', 'u1')).rejects.toThrow('return_already_accepted');
    });
  });

  it('the office releasing a warehouse return opens the warehouse stop', async () => {
    const { prisma, service } = setup({ id: 'w1', orderId: 'o1', orderNumber: 151, destination: 'warehouse', acceptedAt: null, items: [tovar()] });
    await service.release('w1', 'u1');
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', returnWarehouseAcceptedAt: null },
      data: { returnWarehouseAcceptedAt: expect.any(Date) },
    });
  });

  it("reminds each place's people of their own returns only", async () => {
    const { prisma, bot, service } = setup(null);
    byRole(prisma);
    prisma.warehouseReturn.findMany.mockResolvedValue([
      { id: 'w1', orderNumber: 101, destination: 'warehouse' },
      { id: 'w2', orderNumber: 102, destination: 'store' },
    ]);
    await expect(service.remind(new Date())).resolves.toBe(2);
    expect(bot.send).toHaveBeenCalledWith(['42'], expect.stringContaining('1 та возврат омборда қабул қилинмаган (№101)'));
    expect(bot.send).toHaveBeenCalledWith(['77'], expect.stringContaining('1 та возврат дўконда қабул қилинмаган (№102)'));
    expect(prisma.warehouseReturn.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['w1'] } }, data: { remindedAt: expect.any(Date) } });
    expect(prisma.warehouseReturn.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['w2'] } }, data: { remindedAt: expect.any(Date) } });
  });
});
