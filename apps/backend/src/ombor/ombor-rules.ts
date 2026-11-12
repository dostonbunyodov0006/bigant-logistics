import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Omborchi (owner, 05.11.2026): the warehouse's rules, moved here unchanged
 * from the mini app (src/app/tashqi.js, vozvratapi.js, mahsulotvz.js). Pure:
 * data in, data out.
 */

export type Aybdor = 'mijoz' | 'sotuvchi' | 'omborchi' | 'haydovchi';
export const AYBDORLAR: Aybdor[] = ['mijoz', 'sotuvchi', 'omborchi', 'haydovchi'];
export const HOLATLAR = ['yaroqli', 'yaroqsiz'] as const;

/** Reason → who is to blame, as the manager gave it. */
export const SABABLAR: Record<string, [string, Aybdor]> = {
  s1: ['Сотувчи нотўғри товар ёзган', 'sotuvchi'],
  s2: ['Сотувчи сонини кўп ёзган', 'sotuvchi'],
  s3: ['Сотувчи етказиб беришни кечиктирган', 'sotuvchi'],
  m1: ['Мижоз қабул қилаётганда яроқсиз ҳолатга келтирган', 'mijoz'],
  m2: ['Мижоз кунлар ўтгач яроқсиз ҳолатга келтирган', 'mijoz'],
  m3: ['Мижоз нотўғри товар заявка берган', 'mijoz'],
  m4: ['Мижоз ортиқча буюртма берган', 'mijoz'],
  m5: ['Мижоз буюртмани бекор қилган', 'mijoz'],
  o1: ['Омборчи нотўғри товар берган', 'omborchi'],
  o2: ['Омборчи сонини кўп берган', 'omborchi'],
  o3: ['Омборчи яроқсиз товар берган', 'omborchi'],
  o4: ['Омборчи юклашда товарни шикастлаган', 'omborchi'],
  o5: ['Омборчи етказиб беришни кечиктирган', 'omborchi'],
  h1: ['Ҳайдовчи йўлда яроқсиз ҳолатга келтирган', 'haydovchi'],
  h2: ['Ҳайдовчи етказиб беришни кечиктирган', 'haydovchi'],
};

export interface Tovar {
  nom: string;
  soni: number;
  birlik?: string;
  holat: string;
  sabab: string;
  izoh_sabab?: string;
  aybdor?: Aybdor | null;
  rasmlar?: string[];
  mahsulot_id?: number | null;
}

export interface OmborTovar {
  nom: string;
  soni: number;
  holat: 'yaroqli' | 'yaroqsiz';
  sabab: string;
  izoh_sabab: string;
  aybdor: Aybdor;
  mahsulot_id: number | null;
  rasm?: { u?: string; y?: string };
}

const matn = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;

/** The reason decides the blame; "x" (another reason) carries its own text and blame. */
export function sababTekshir(t: { sabab?: unknown; izoh_sabab?: unknown; aybdor?: unknown }):
  | { xato: string }
  | { izoh_sabab: string; aybdor: Aybdor } {
  if (t.sabab === 'x') {
    const izoh = matn(t.izoh_sabab, 500);
    if (!izoh) return { xato: 'izoh' };
    if (!AYBDORLAR.includes(t.aybdor as Aybdor)) return { xato: 'aybdor' };
    return { izoh_sabab: izoh, aybdor: t.aybdor as Aybdor };
  }
  if (typeof t.sabab === 'string' && SABABLAR[t.sabab]) return { izoh_sabab: '', aybdor: SABABLAR[t.sabab][1] };
  return { xato: 'sabab' };
}

/** The driver's blame for an item: his reason's, or the one he chose for "x". */
export function tovarAybdor(t: Tovar): Aybdor | null {
  if (t.sabab === 'x') return (t.aybdor as Aybdor) ?? null;
  return SABABLAR[t.sabab]?.[1] ?? null;
}

const idOl = (x: unknown): number | null => {
  const n = Number(x);
  return x != null && x !== '' && Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** The storekeeper's count, checked (photos apart). */
export function omborTekshir(
  m: unknown,
  tovarlar: Tovar[],
): { xato: string } | { v: OmborTovar[]; izoh: string } {
  const b = m as { tovarlar?: unknown; izoh?: unknown } | null;
  if (!b || !Array.isArray(b.tovarlar) || b.tovarlar.length !== tovarlar.length) return { xato: 'Ҳар бир товарни тўлдиринг' };
  const v: OmborTovar[] = [];
  for (let i = 0; i < b.tovarlar.length; i++) {
    const t = (b.tovarlar[i] ?? {}) as Record<string, unknown>;
    const q = `${i + 1}-товар: `;
    const nom = matn(t.nom, 200) ?? tovarlar[i].nom;
    const soni = Number(t.soni);
    if (!Number.isFinite(soni) || soni < 0 || soni > 1e6) return { xato: q + 'нечта келганини ёзинг' };
    // (audit, 07.11.2026) None of it came: there is no condition to judge. The
    // field stays one of the two (the Vozvrat page and its schema know no third),
    // so an unset one is kept as 'yaroqsiz' — nothing usable reached the warehouse.
    const holat = soni === 0 && !HOLATLAR.includes(t.holat as 'yaroqli') ? 'yaroqsiz' : t.holat;
    if (!HOLATLAR.includes(holat as 'yaroqli')) return { xato: q + 'ҳолатини танланг' };
    const s = sababTekshir(t);
    if ('xato' in s) return { xato: q + 'сабабини танланг' + (t.sabab === 'x' ? ' (бошқа сабабда матн ва айбдор керак)' : '') };
    v.push({
      nom,
      soni,
      holat: holat as OmborTovar['holat'],
      sabab: t.sabab as string,
      izoh_sabab: s.izoh_sabab,
      aybdor: s.aybdor,
      mahsulot_id: idOl(t.mahsulot_id),
    });
  }
  const izoh = typeof b.izoh === 'string' ? b.izoh.trim().slice(0, 2000) : '';
  return { v, izoh };
}

/** The final blame per item: the storekeeper's when he wrote one, else the driver's. */
export function yakuniyAybdorlar(tovarlar: Tovar[], answer: OmborTovar[] | null): (Aybdor | null)[] {
  return tovarlar.map((t, i) => answer?.[i]?.aybdor ?? tovarAybdor(t));
}

// ---- product names ----------------------------------------------------------

/** Comparing key: lower case, ё→е, no quotes, spaces or punctuation, × → x. */
export function kalitOl(nom: string): string {
  return String(nom || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`ʼ‘’“”]/g, '')
    .replace(/[×*]/g, 'x')
    .replace(/[\s.,;:()\-_/\\]+/g, '')
    .slice(0, 200);
}

export interface ReturnView {
  id: number;
  /** Where it is taken in (owner, 07.11.2026). */
  joy: 'warehouse' | 'store';
  sana: string;
  haydovchi: string;
  mijoz: string;
  sotuvchi: string;
  izoh: string;
  holat: 'ombor' | 'qabul';
  tovarlar: (Tovar & { hodovoy: boolean | null; yangiMahsulot: boolean })[];
  aybdorlar: (Aybdor | null)[];
  omborJavob: OmborTovar[] | null;
  omborIzoh: string;
  omborVaqt: string | null;
  omborUmumiy: string | null;
  omborchi: string | null;
  /** (owner, 07.11.2026) The office released it with no count: "Санаб қўйиш" is still open. */
  sanash: boolean;
}

// ---- Telegram Mini App sign-in ------------------------------------------------

/**
 * Checks the Mini App's initData against the bot's token
 * (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * Returns the Telegram user id, or the reason it was refused.
 */
export function initDataTekshir(
  initData: string,
  token: string,
  // (audit, 07.11.2026) An hour, not a day: a copied initData was a way in for
  // 24 h. The page's own 12 h pass is what keeps a storekeeper signed in.
  { maxYoshSek = 3_600, hozir = Date.now() }: { maxYoshSek?: number; hozir?: number } = {},
): { ok: true; uid: string; ism: string } | { ok: false; xato: string } {
  if (!initData || !token) return { ok: false, xato: 'initData йўқ' };
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(initData);
  } catch {
    return { ok: false, xato: 'initData бузуқ' };
  }
  const hash = (p.get('hash') ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, xato: 'hash йўқ' };
  const satr = [...p.entries()]
    .filter(([k]) => k !== 'hash')
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const kutilgan = createHmac('sha256', secret).update(satr).digest('hex');
  if (!timingSafeEqual(Buffer.from(kutilgan), Buffer.from(hash))) return { ok: false, xato: 'имзо нотўғри' };
  const authDate = Number(p.get('auth_date'));
  if (!Number.isFinite(authDate) || hozir / 1000 - authDate > maxYoshSek) {
    return { ok: false, xato: 'муддати ўтган — иловани қайта очинг' };
  }
  let user: { id?: unknown; first_name?: unknown; last_name?: unknown } | null = null;
  try {
    user = JSON.parse(p.get('user') ?? 'null');
  } catch {
    user = null;
  }
  if (!user || !Number.isSafeInteger(Number(user.id))) return { ok: false, xato: 'user йўқ' };
  const ism = [user.first_name, user.last_name].filter((x) => typeof x === 'string' && x).join(' ');
  return { ok: true, uid: String(user.id), ism };
}

/** For tests: initData signed the way Telegram signs it. */
export function initDataYasa(user: { id: number; first_name?: string }, token: string, authDate = Math.floor(Date.now() / 1000)): string {
  const p = new URLSearchParams();
  p.set('auth_date', String(authDate));
  p.set('query_id', 'AAHtest');
  p.set('user', JSON.stringify(user));
  const satr = [...p.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(satr).digest('hex'));
  return p.toString();
}
