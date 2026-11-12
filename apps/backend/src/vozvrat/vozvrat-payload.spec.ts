import { vozvratItemSchema } from '@bigant/shared';
import { catalogueId, retryDelayMs, tashkentIso, vozvratPayload, type VozvratFacts } from './vozvrat-payload';

describe('vozvrat payload', () => {
  it('writes Tashkent wall-clock time with its offset', () => {
    expect(tashkentIso(new Date('2026-09-29T05:20:00Z'))).toBe('2026-09-29T10:20:00+05:00');
    expect(tashkentIso(new Date('2026-09-29T20:30:00Z'))).toBe('2026-09-30T01:30:00+05:00');
  });

  it('spaces retries 1, 2, 4 … minutes, at most an hour', () => {
    expect([1, 2, 3, 4, 7, 20].map((n) => retryDelayMs(n) / 60_000)).toEqual([1, 2, 4, 8, 60, 60]);
  });

  it('sends only the mini app catalogue numbers as mahsulot_id', () => {
    expect(catalogueId('417')).toBe(417);
    expect(catalogueId('p-1001')).toBeNull();
    expect(catalogueId('0')).toBeNull();
    expect(catalogueId('')).toBeNull();
    expect(catalogueId(null)).toBeNull();
  });

  it('a catalogue number past 2147483647 is no catalogue number (owner, 07.11.2026)', () => {
    expect(catalogueId('2147483647')).toBe(2147483647);
    expect(catalogueId('2147483648')).toBeNull();
    expect(catalogueId('9999999999')).toBeNull();
    expect(catalogueId('1234567890123456')).toBeNull();
    const p = vozvratPayload(facts([{ ...item, productId: '9999999999' }]));
    expect(p.tovarlar[0]).not.toHaveProperty('mahsulot_id');
  });

  const facts = (items: VozvratFacts['items']): VozvratFacts => ({
    orderNumber: 1042,
    at: new Date('2026-09-29T05:20:00Z'),
    driverName: 'Hamza',
    clientName: 'Akmal',
    sellerName: 'Bekzod',
    sellerTelegramId: '100000001',
    comment: null,
    items,
  });
  const item: VozvratFacts['items'][number] = {
    productId: '417',
    name: 'Sement M400',
    unit: 'qop',
    quantity: 2.5,
    condition: 'yaroqsiz',
    reasonCode: 'o1',
    otherReason: null,
    culprit: null,
    photoUrl: 'https://cdn.example.com/p.jpg',
  };

  it('writes an item as their contract takes it: unit, catalogue number, photo link', () => {
    const p = vozvratPayload(facts([item]));
    expect(p).toMatchObject({ id: '1042', sana: '2026-09-29T10:20:00+05:00', sotuvchi_id: 100000001, izoh: '' });
    expect(p.tovarlar[0]).toEqual({
      nom: 'Sement M400',
      soni: 2.5,
      birlik: 'qop',
      holat: 'yaroqsiz',
      sabab: 'o1',
      mahsulot_id: 417,
      rasmlar: ['https://cdn.example.com/p.jpg'],
    });
  });

  it('leaves out what they would refuse: a sample id, a plain-http photo, a blank unit', () => {
    const p = vozvratPayload(
      facts([{ ...item, productId: 'p-1001', unit: null, photoUrl: 'http://192.168.1.3:3000/media/p.jpg' }]),
    );
    expect(p.tovarlar[0]).toEqual({ nom: 'Sement M400', soni: 2.5, holat: 'yaroqsiz', sabab: 'o1' });
  });

  it('adds the words and the blamed party only under "x"', () => {
    const p = vozvratPayload(
      facts([{ ...item, reasonCode: 'x', otherReason: 'yomgʻir', culprit: 'haydovchi' }]),
    );
    expect(p.tovarlar[0]).toMatchObject({ sabab: 'x', izoh_sabab: 'yomgʻir', aybdor: 'haydovchi' });
    expect(vozvratPayload(facts([item])).tovarlar[0]).not.toHaveProperty('aybdor');
  });

  it('keeps sotuvchi_id empty for a seller with no Telegram id, to be filled in later', () => {
    expect(vozvratPayload({ ...facts([item]), sellerTelegramId: null }).sotuvchi_id).toBeNull();
  });
});

describe('vozvrat item', () => {
  const base = {
    name: 'Kafel',
    quantity: 2,
    condition: 'yaroqli',
    photo_url: 'https://cdn.example.com/p.jpg',
  };

  it('takes a plain reason as is, with no storekeeper asked for', () => {
    expect(vozvratItemSchema.safeParse({ ...base, reason: 'm1' }).success).toBe(true);
    expect(vozvratItemSchema.safeParse({ ...base, reason: 'o3' }).success).toBe(true);
  });

  it('"x" needs the reason in words and who is to blame', () => {
    const r = vozvratItemSchema.safeParse({ ...base, reason: 'x' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).sort()).toEqual([
      'vozvrat_culprit_required',
      'vozvrat_other_reason_required',
    ]);
    expect(
      vozvratItemSchema.safeParse({ ...base, reason: 'x', other_reason: 'yomgʻir', culprit: 'omborchi' })
        .success,
    ).toBe(true);
  });

  it('counts in the product unit: 2.5 is fine, a fourth decimal or zero is not', () => {
    expect(vozvratItemSchema.safeParse({ ...base, reason: 'm1', quantity: 2.5 }).success).toBe(true);
    expect(vozvratItemSchema.safeParse({ ...base, reason: 'm1', quantity: 0.125 }).success).toBe(true);
    expect(vozvratItemSchema.safeParse({ ...base, reason: 'm1', quantity: 0.0001 }).success).toBe(false);
    expect(vozvratItemSchema.safeParse({ ...base, reason: 'm1', quantity: 0 }).success).toBe(false);
    expect(vozvratItemSchema.safeParse({ ...base, reason: 'm1', quantity: 2_000_000 }).success).toBe(false);
  });

  it('needs a photo and keeps the unit short', () => {
    expect(vozvratItemSchema.safeParse({ ...base, reason: 'm1', photo_url: undefined }).success).toBe(false);
    expect(vozvratItemSchema.safeParse({ ...base, reason: 'm1', unit: 'kg' }).success).toBe(true);
    expect(vozvratItemSchema.safeParse({ ...base, reason: 'm1', unit: 'x'.repeat(21) }).success).toBe(false);
  });
});
