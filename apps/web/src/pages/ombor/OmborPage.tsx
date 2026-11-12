import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { API_URL } from '../../lib/api';
import './ombor.css';
import { safeHref } from '../../lib/safeHref';

/**
 * Omborchi (owner, 05.11.2026): the storekeeper's "Омбор қабул", moved here
 * from the Telegram mini app with the same screens and words. Opened inside
 * Telegram (the mini app's button, or "Очиш" under the bot's message), which
 * hands the page its signed initData; this site's login plays no part.
 */

type Aybdor = 'mijoz' | 'sotuvchi' | 'omborchi' | 'haydovchi';
interface Tovar {
  nom: string;
  soni: number;
  birlik?: string;
  holat: string;
  sabab: string;
  izoh_sabab?: string;
  aybdor?: Aybdor | null;
  mahsulot_id?: number | null;
  hodovoy: boolean | null;
  yangiMahsulot: boolean;
}
interface OmborTovar {
  nom: string;
  soni: number;
  holat: 'yaroqli' | 'yaroqsiz';
  sabab: string;
  izoh_sabab: string;
  aybdor: Aybdor;
  rasm?: { u?: string; y?: string };
}
// (owner, 07.11.2026) The same page serves our shop: its person (dokonchi)
// sees and takes in the store-bound returns, a storekeeper the warehouse's.
type Joy = 'warehouse' | 'store';
const JOY_NOM: Record<Joy, string> = { warehouse: 'Омбор', store: 'Дўкон' };
const JOY_XODIM: Record<Joy, string> = { warehouse: 'Омборчи', store: 'Дўкон ходими' };
const JOYGA: Record<Joy, string> = { warehouse: 'Омборга', store: 'Дўконга' };
const ROLE_JOY: Record<string, Joy> = { omborchi: 'warehouse', dokonchi: 'store' };
const kalit = (r: { id: number; joy: Joy }) => `${r.joy}-${r.id}`;

interface Vozvrat {
  id: number;
  joy: Joy;
  sana: string;
  haydovchi: string;
  mijoz: string;
  sotuvchi: string;
  izoh: string;
  holat: 'ombor' | 'qabul';
  tovarlar: Tovar[];
  omborJavob: OmborTovar[] | null;
  omborIzoh: string;
  omborVaqt: string | null;
  omborUmumiy: string | null;
  /** Who took it in; "… (ofis)" when the office marked it, with no count. */
  omborchi: string | null;
  /** (owner, 07.11.2026) The office marked it with no count: the count may still be sent. */
  sanash?: boolean;
}
interface Qator {
  nom: string;
  mahsulot_id: number | null;
  soni: number | string;
  holat: 'yaroqli' | 'yaroqsiz' | null;
  sabab: string | null;
  izoh_sabab: string;
  aybdor: Aybdor | null;
  u: Blob | null;
  uUrl: string;
  y: Blob | null;
  yUrl: string;
}

const AYB: Record<Aybdor, { t: string; c: string }> = {
  mijoz: { t: 'Мижоз', c: 'amb' },
  sotuvchi: { t: 'Сотувчи', c: 'or' },
  omborchi: { t: 'Омборчи', c: 'vi' },
  haydovchi: { t: 'Ҳайдовчи', c: 'rd' },
};
// The owner's order (12.11.2026): seller, client, storekeeper, driver.
const AYB_TARTIB: Aybdor[] = ['sotuvchi', 'mijoz', 'omborchi', 'haydovchi'];
const SABABLAR: [string, string, Aybdor][] = [
  ['s1', 'Нотўғри товар ёзган Сотувчи', 'sotuvchi'],
  ['s2', 'Сонини кўп ёзган Сотувчи', 'sotuvchi'],
  ['s3', 'Етказиб бериш кечиккан Сотувчи', 'sotuvchi'],
  ['m1', 'Қабул қилаётганда яроқсиз ҳолатга келтирган Мижоз', 'mijoz'],
  ['m2', 'Кунлар ўтгач яроқсиз ҳолатга келтирган Мижоз', 'mijoz'],
  ['m3', 'Мижоз нотўғри товар заявка берган', 'mijoz'],
  ['m4', 'Мижоз ортиқча буюртма берган', 'mijoz'],
  ['m5', 'Мижоз буюртмани бекор қилган', 'mijoz'],
  ['o1', 'Нотўғри товар берган Омборчи', 'omborchi'],
  ['o2', 'Сонини кўп берган Омборчи', 'omborchi'],
  ['o3', 'Яроқсиз товар берган Омборчи', 'omborchi'],
  ['o4', 'Юклашда товарни шикастлаган Омборчи', 'omborchi'],
  ['o5', 'Етказиб бериш кечиккан Омборчи', 'omborchi'],
  ['h1', 'Йўлда яроқсиз ҳолатга келтирган Ҳайдовчи', 'haydovchi'],
  ['h2', 'Етказиб бериш кечиккан Ҳайдовчи', 'haydovchi'],
];
const HOLAT = { yaroqli: 'Яроқли', yaroqsiz: 'Яроқсиз' } as Record<string, string>;
const sababMatn = (v: { sabab?: string | null; izoh_sabab?: string }) =>
  !v.sabab ? '' : v.sabab === 'x' ? v.izoh_sabab || 'Бошқа сабаб' : SABABLAR.find((s) => s[0] === v.sabab)?.[1] ?? v.sabab;
const aybdorOl = (v: { sabab?: string | null; aybdor?: Aybdor | null }): Aybdor | null =>
  !v.sabab ? null : v.sabab === 'x' ? v.aybdor ?? null : SABABLAR.find((s) => s[0] === v.sabab)?.[2] ?? null;
const sababTayyor = (v: Qator) => !!v.sabab && (v.sabab !== 'x' || (!!v.izoh_sabab.trim() && !!v.aybdor));
const hodovoyMatn = (t: { hodovoy: boolean | null; yangiMahsulot?: boolean }) =>
  t.hodovoy === true ? { t: 'Ҳодовой', c: 'gr' } : t.hodovoy === false ? { t: 'Ноҳодовой', c: 'amb' } : t.yangiMahsulot ? { t: 'Янги маҳсулот', c: 'or' } : null;
const soniMatn = (n: number, birlik?: string) => `${Number(n).toLocaleString('ru-RU')}${birlik ? ' ' + birlik : ''}`;
function sana(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // (audit, 07.11.2026) Tashkent time, whatever the phone's own zone is set to.
  return d
    .toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .replace(',', '');
}

const ICONS: Record<string, string> = {
  chev: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8v6M8 11h6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  checkcircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }} />
  );
}

// ---- Telegram sign-in and the API ------------------------------------------

const KEY = 'bigant.ombor.initData';
/** Telegram puts the signed initData in the page's hash; it is kept for a reload. */
function initData(): string {
  const read = (s: string) => new URLSearchParams(s.replace(/^[#?]/, '')).get('tgWebAppData') ?? '';
  const got = read(window.location.hash) || read(window.location.search);
  try {
    if (got) sessionStorage.setItem(KEY, got);
    return got || sessionStorage.getItem(KEY) || '';
  } catch {
    return got;
  }
}

/**
 * Telegram's colours: light only when Telegram says so (its theme in the
 * page's hash, when opened from the bot's button); otherwise dark, as the
 * mini app's own default.
 */
function yorugmi(): boolean {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (p.get('tgWebAppColorScheme')) return p.get('tgWebAppColorScheme') === 'light';
  try {
    const bg = (JSON.parse(p.get('tgWebAppThemeParams') ?? '{}') as { bg_color?: string }).bg_color ?? '';
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg);
    if (m) return 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16) > 150;
  } catch {
    // No theme: dark.
  }
  return false;
}

/** An API refusal, with its HTTP status (0: no answer at all). */
class ApiXato extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** (audit, 07.11.2026) A request on a dead signal used to hang for good. Old webviews lack AbortSignal.timeout. */
function vaqtSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// (audit, 07.11.2026) The pass is kept for a reload too: Telegram's initData is
// taken for an hour only now, and a reload after that hour would lock the
// storekeeper out though his 12 h pass is still good.
const PASS_KEY = 'bigant.ombor.pass';
type Pass = { token: string; name: string; roles?: string[] };
function passOl(): Pass | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PASS_KEY) ?? 'null') as Pass | null;
    return p && typeof p.token === 'string' ? p : null;
  } catch {
    return null;
  }
}
function passSaqla(p: Pass) {
  try {
    sessionStorage.setItem(PASS_KEY, JSON.stringify(p));
  } catch {
    // No storage: the pass lives in memory only.
  }
}

let token = '';
async function sessiya(): Promise<Pass> {
  const s = await call<{ token: string; user: { name: string; roles: string[] } }>('/session', { method: 'POST', body: { initData: initData() } }, false);
  token = s.token;
  const p = { token: s.token, name: s.user.name, roles: s.user.roles };
  passSaqla(p);
  return p;
}

async function call<T>(path: string, init: { method?: string; body?: unknown; vaqtMs?: number } = {}, qayta = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/ombor${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-ombor-token': token } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: vaqtSignal(init.vaqtMs ?? 60_000),
    });
  } catch {
    throw new ApiXato('Интернет йўқ ёки жуда секин — қайта уриниб кўринг', 0);
  }
  // (audit, 07.11.2026) The 12 h pass ran out: sign in again once, then retry.
  if (res.status === 401 && qayta && path !== '/session') {
    await sessiya();
    return call<T>(path, init, false);
  }
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[] } & T;
  if (!res.ok) throw new ApiXato((Array.isArray(data.message) ? data.message[0] : data.message) || 'Хатолик', res.status);
  return data;
}

/** A phone photo shrunk to 1280 px JPEG, as the mini app did. */
async function siq(f: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(f).catch(() => null);
  if (!bmp) return f;
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob((b) => ok(b ?? f), 'image/jpeg', 0.8));
}
const dataUrl = (b: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new Error('Расм ўқилмади'));
    r.readAsDataURL(b);
  });
// A photo already on the server is not sent again when "Қабул қилдим" is retried.
const yuklangan = new WeakMap<Blob, string>();
async function yuklaRasm(b: Blob): Promise<string> {
  const bor = yuklangan.get(b);
  if (bor) return bor;
  const url = (await call<{ url: string }>('/photo', { method: 'POST', body: { base64: await dataUrl(b) }, vaqtMs: 90_000 })).url;
  yuklangan.set(b, url);
  return url;
}

// ---- the camera ----
// (owner, 12.11.2026) The phone's own camera, not one drawn inside the page:
// inside Telegram the page's camera asked for permission again and again, its
// button was slow to come alive and the picture slow to take. The phone's
// camera needs Telegram's camera permission once, for good.

/** A file picker that opens the back camera (capture) or the gallery. */
function RasmTanla({ kamera, onrasm, children, className }: { kamera: boolean; onrasm: (b: Blob) => void; children: ReactNode; className: string }) {
  return (
    <label className={className}>
      {children}
      <input type="file" accept="image/*" {...(kamera ? { capture: 'environment' as const } : {})} hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onrasm(f);
        }} />
    </label>
  );
}

function Sheet({ onclose, children }: { onclose: () => void; children: ReactNode }) {
  return (
    <div className="overlay" role="presentation" onClick={onclose}>
      <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="handle" />
        {children}
      </div>
    </div>
  );
}

/**
 * «Нега қайтди?» (owner, 12.11.2026): the four culprits as buttons on the form
 * itself; pressing one opens its reasons right under it and closes the other's.
 * "Бошқа сабаб" asks for the reason in words and who is to blame.
 */
function SababMaydon({ v, set }: { v: Qator; set: (p: Partial<Qator>) => void }) {
  const id = useId();
  const ayb = aybdorOl(v);
  // Nothing chosen yet: the list waits for a culprit. Chosen: it stays closed
  // until a culprit is pressed again.
  const [ochiqAyb, setOchiqAyb] = useState<Aybdor | null>(null);
  const tanla = (k: string) => {
    set(k === 'x' ? { sabab: k } : { sabab: k, izoh_sabab: '', aybdor: null });
    setOchiqAyb(null);
  };
  const tanlanganAyb = v.sabab && v.sabab !== 'x' ? SABABLAR.find((s) => s[0] === v.sabab)?.[2] ?? null : null;
  return (
    <>
      <div className="field">
        <span className="lb">Нега қайтди? Айбдорни босинг</span>
        <div className="vz-ayb4">
          {AYB_TARTIB.map((a) => {
            const faol = ochiqAyb === a || (!ochiqAyb && tanlanganAyb === a);
            return (
              <button key={a} type="button" className={`vz-ayb4-b${faol ? ` on ${AYB[a].c}` : ''}`} aria-expanded={ochiqAyb === a}
                onClick={() => setOchiqAyb(ochiqAyb === a ? null : a)}>
                {AYB[a].t}
                <Icon name="chev" size={16} />
              </button>
            );
          })}
          <button type="button" className={`vz-ayb4-b keng${v.sabab === 'x' && !ochiqAyb ? ' on' : ''}`} onClick={() => tanla('x')}>
            Бошқа сабаб
          </button>
        </div>
        {ochiqAyb ? (
          <div className="vz-akk ochiq">
            {SABABLAR.filter((s) => s[2] === ochiqAyb).map(([k, t]) => (
              <button key={k} type="button" className={`vz-opt${v.sabab === k ? ' on' : ''}`} onClick={() => tanla(k)}>
                <span>{t}</span>
                {v.sabab === k && <Icon name="check" size={18} />}
              </button>
            ))}
          </div>
        ) : v.sabab && v.sabab !== 'x' ? (
          <div className="vz-ayb">
            <span>{sababMatn(v)}</span>
            {ayb && <span className={`chip ${AYB[ayb].c}`}>{AYB[ayb].t}</span>}
          </div>
        ) : !v.sabab ? (
          <span className="muted" style={{ fontSize: 13 }}>Айбдорни босинг, сабаблари очилади</span>
        ) : null}
      </div>
      {v.sabab === 'x' && (
        <>
          <div className="field">
            <label htmlFor={`${id}-izs`}>Сабабни ёзинг</label>
            <textarea id={`${id}-izs`} className={v.izoh_sabab.trim() ? '' : 'bosh'} value={v.izoh_sabab} maxLength={500}
              placeholder="Нима бўлганини қисқа ёзинг" onChange={(e) => set({ izoh_sabab: e.target.value })} />
          </div>
          <div className="field">
            <span className="lb">Ким айбдор?</span>
            <div className="chips">
              {AYB_TARTIB.map((k) => (
                <button key={k} type="button" className={`chip ${v.aybdor === k ? AYB[k].c : ''}`} style={{ height: 36, padding: '0 14px', fontSize: 14 }} onClick={() => set({ aybdor: k })}>
                  {AYB[k].t}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** The item's name: typing offers products from the list; a name not on it is added as a new one. */
function MahsulotTanla({ v, set }: { v: Qator; set: (p: Partial<Qator>) => void }) {
  const id = useId();
  const [variantlar, setVariantlar] = useState<{ id: number; nom: string; hodovoy: boolean | null; holat: string }[]>([]);
  const [ochiq, setOchiq] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const seq = useRef(0);
  const yozildi = (nom: string) => {
    set({ nom, mahsulot_id: null });
    clearTimeout(timer.current);
    const q = nom.trim();
    if (!q) return setVariantlar([]);
    timer.current = setTimeout(async () => {
      const n = ++seq.current;
      try {
        const r = await call<{ royxat: typeof variantlar }>(`/products?q=${encodeURIComponent(q)}`);
        if (n === seq.current) {
          setVariantlar(r.royxat);
          setOchiq(true);
        }
      } catch {
        // No search: the name is written by hand.
      }
    }, 150);
  };
  const aniq = variantlar.some((m) => m.nom.trim().toLowerCase() === v.nom.trim().toLowerCase());
  return (
    <div className="field">
      <label htmlFor={`${id}-nom`}>Товар номи</label>
      <input id={`${id}-nom`} className={v.nom.trim() ? '' : 'bosh'} value={v.nom} maxLength={200} autoComplete="off"
        onChange={(e) => yozildi(e.target.value)} onFocus={() => setOchiq(variantlar.length > 0)} onBlur={() => setTimeout(() => setOchiq(false), 200)} />
      {v.mahsulot_id ? (
        <span className="muted" style={{ fontSize: 12 }}>Рўйхатдан танланди</span>
      ) : v.nom.trim() && !ochiq && !aniq ? (
        <span style={{ fontSize: 12, color: 'var(--or)', fontWeight: 600 }}>Рўйхатда йўқ — янги товар бўлиб қўшилади</span>
      ) : null}
      {ochiq && variantlar.length > 0 && (
        <div className="vz-var">
          {variantlar.map((m) => {
            const hm = hodovoyMatn({ hodovoy: m.hodovoy, yangiMahsulot: m.holat === 'yangi' });
            return (
              <button key={m.id} type="button" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { set({ nom: m.nom, mahsulot_id: m.id }); setVariantlar([]); setOchiq(false); }}>
                <span>{m.nom}</span>
                {hm && <span className={`chip ${hm.c}`}>{hm.t}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KvYozuv({ v, birlik, holatBor }: { v: { sabab?: string | null; izoh_sabab?: string; aybdor?: Aybdor | null; soni: number; holat?: string }; birlik?: string; holatBor: boolean }) {
  const a = aybdorOl(v);
  return (
    <div className="vz-kv">
      <div><span>Сабаби</span><b>{sababMatn(v)}</b></div>
      <div><span>Айбдор</span>{a && <span className={`chip ${AYB[a].c}`}>{AYB[a].t}</span>}</div>
      <div><span>Сони</span><b>{soniMatn(v.soni, birlik)}</b></div>
      {holatBor && v.holat && (
        <div><span>Ҳолати</span><b style={{ color: `var(--${v.holat === 'yaroqli' ? 'gr' : 'rd'})` }}>{HOLAT[v.holat]}</b></div>
      )}
    </div>
  );
}

// ---- the page --------------------------------------------------------------

type Foto = { i: number; k: 'u' | 'y' | 'umumiy' };

export function OmborPage() {
  const [kirish, setKirish] = useState<'kut' | 'ok' | string>('kut');
  const [ism, setIsm] = useState('');
  const [rollar, setRollar] = useState<string[] | null>(null);
  // Both roles: the omborchi's view and the do'konchi's view, one at a time (owner, 12.11.2026).
  const [korinish, setKorinish] = useState<Joy>(() => {
    try {
      return localStorage.getItem('omb.korinish') === 'store' ? 'store' : 'warehouse';
    } catch {
      return 'warehouse';
    }
  });
  const korinishTanla = (j: Joy) => {
    setKorinish(j);
    try {
      localStorage.setItem('omb.korinish', j);
    } catch {
      // Not kept: fine.
    }
  };
  const [royxat, setRoyxat] = useState<Vozvrat[] | null>(null);
  const [xato, setXato] = useState('');
  const [ochiqId, setOchiqId] = useState<string | null>(null);
  const [qatorlar, setQatorlar] = useState<Qator[] | null>(null);
  const [umumiy, setUmumiy] = useState<{ b: Blob | null; url: string }>({ b: null, url: '' });
  const [izoh, setIzoh] = useState('');
  const [band, setBand] = useState(false);
  const [foto, setFoto] = useState<Foto | null>(null);
  const [tayyorlanmoqda, setTayyorlanmoqda] = useState(false);
  const [toast, setToast] = useState<{ t: string; rd: boolean } | null>(null);
  const [light] = useState(yorugmi);

  const xabar = (t: string, rd = false) => {
    setToast({ t, rd });
    setTimeout(() => setToast(null), 2500);
  };

  /** `jim`: a refresh in the background — a failed one leaves the page as it is. */
  const yukla = useCallback(async (jim = false) => {
    try {
      setRoyxat((await call<{ royxat: Vozvrat[] }>('/returns')).royxat);
      setXato('');
    } catch (e) {
      if (!jim) setXato((e as Error).message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        let p: Pass;
        try {
          p = await sessiya();
        } catch (e) {
          // initData over an hour old (a reload): the pass kept from before still serves.
          const eski = passOl();
          if (!(e instanceof ApiXato && e.status === 401) || !eski) throw e;
          token = eski.token;
          p = eski;
        }
        setIsm(p.name);
        setRollar(p.roles ?? null);
        setKirish('ok');
        await yukla();
      } catch (e) {
        setKirish((e as Error).message);
      }
    })();
  }, [yukla]);

  // (audit, 07.11.2026) Back in the app (Telegram brought forward, phone woken):
  // the list is read again, or a return another storekeeper took in stayed on it.
  useEffect(() => {
    const qayt = () => {
      if (document.visibilityState === 'visible' && token) void yukla(true);
    };
    document.addEventListener('visibilitychange', qayt);
    window.addEventListener('focus', qayt);
    return () => {
      document.removeEventListener('visibilitychange', qayt);
      window.removeEventListener('focus', qayt);
    };
  }, [yukla]);

  const ochiq = royxat && ochiqId != null ? royxat.find((r) => kalit(r) === ochiqId) ?? null : null;
  // (owner, 07.11.2026) Taken in is the server's word: the office may mark one
  // taken in with no count (omborJavob stays empty).
  // (owner, 07.11.2026) One the office marked with no count is not finished:
  // it waits here with "Санаб қўйиш" until someone counts it.
  // The places this person works at: from the pass, else from what is listed.
  const joylar: Joy[] = (() => {
    const j = new Set<Joy>((rollar ?? []).map((x) => ROLE_JOY[x]).filter(Boolean));
    if (!j.size) (royxat ?? []).forEach((r) => j.add(r.joy));
    return j.size ? (['warehouse', 'store'] as Joy[]).filter((x) => j.has(x)) : ['warehouse'];
  })();
  const ikkala = joylar.length > 1;
  // Both roles: one view at a time, chosen above the list (owner, 12.11.2026);
  // the page reads exactly as it does for an omborchi or a do'konchi alone.
  const joy: Joy = ikkala ? korinish : joylar[0];
  const meniki = (royxat ?? []).filter((r) => r.joy === joy);
  const keldi = meniki.filter((r) => r.holat !== 'qabul' || r.sanash);
  const qabul = meniki.filter((r) => r.holat === 'qabul' && !r.sanash);
  const sarlavha = JOY_NOM[joy];
  // (audit, 07.11.2026) None of an item came (0): no photo and no condition to
  // give — they were required and the return could never be taken in. The
  // overall photo is asked for unless nothing came at all.
  const yoq = (t: Qator) => t.soni !== '' && Number(t.soni) === 0;
  const kerakRasm = (t: Qator) => (yoq(t) ? ([] as const) : t.holat === 'yaroqsiz' ? (['u', 'y'] as const) : (['u'] as const));
  const umumiyKerak = !!qatorlar && !qatorlar.every(yoq);
  const rasmTayyor = !!qatorlar && (!!umumiy.b || !umumiyKerak) && qatorlar.every((t) => (t.holat || yoq(t)) && kerakRasm(t).every((k) => t[k]));
  const qolganiTayyor = !!qatorlar && qatorlar.every((t) => t.nom.trim() && t.soni !== '' && Number(t.soni) >= 0 && (t.holat || yoq(t)) && sababTayyor(t));
  const tayyor = rasmTayyor && qolganiTayyor;

  const setQator = (i: number, p: Partial<Qator>) => setQatorlar((q) => q && q.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const och = (r: Vozvrat) => {
    setOchiqId(kalit(r));
    window.scrollTo(0, 0);
    setQatorlar(
      r.holat === 'qabul' && !r.sanash
        ? null
        : r.tovarlar.map((t) => ({ nom: t.nom, mahsulot_id: t.mahsulot_id ?? null, soni: t.soni, holat: null, sabab: null, izoh_sabab: '', aybdor: null, u: null, uUrl: '', y: null, yUrl: '' })),
    );
    setUmumiy({ b: null, url: '' });
    setIzoh('');
  };
  const yop = () => {
    setOchiqId(null);
    setQatorlar(null);
    window.scrollTo(0, 0);
  };

  const rasmTanlandi = async (f: Blob) => {
    const fo = foto;
    setFoto(null);
    if (!fo) return;
    setTayyorlanmoqda(true);
    const b = await siq(f).finally(() => setTayyorlanmoqda(false));
    const url = URL.createObjectURL(b);
    if (fo.k === 'umumiy') {
      if (umumiy.url) URL.revokeObjectURL(umumiy.url);
      setUmumiy({ b, url });
    } else {
      const old = qatorlar?.[fo.i]?.[`${fo.k}Url`];
      if (old) URL.revokeObjectURL(old);
      setQator(fo.i, { [fo.k]: b, [`${fo.k}Url`]: url } as Partial<Qator>);
    }
  };

  const qabulQil = async () => {
    if (!tayyor || band || !ochiq || !qatorlar) return;
    setBand(true);
    try {
      // (audit, 07.11.2026) Two photos at a time, not one after another: a
      // return of many items took minutes on a weak signal.
      const ishlar: [string, Blob][] = [];
      qatorlar.forEach((t, i) => kerakRasm(t).forEach((k) => ishlar.push([`${i}${k}`, t[k]!])));
      if (umumiy.b && umumiyKerak) ishlar.push(['umumiy', umumiy.b]);
      const urllar: Record<string, string> = {};
      let navbat = 0;
      const ishchi = async () => {
        while (navbat < ishlar.length) {
          const [kalit, b] = ishlar[navbat++];
          urllar[kalit] = await yuklaRasm(b);
        }
      };
      await Promise.all([ishchi(), ishchi()]);
      const { umumiy: umumiyUrl, ...rasmlar } = urllar;
      await call(`/returns/${ochiq.id}/accept?joy=${ochiq.joy}`, {
        method: 'POST',
        body: {
          malumot: {
            izoh,
            tovarlar: qatorlar.map((t) => ({ nom: t.nom.trim(), mahsulot_id: t.mahsulot_id, soni: Number(t.soni), holat: yoq(t) ? null : t.holat, sabab: t.sabab, izoh_sabab: t.izoh_sabab, aybdor: t.aybdor })),
          },
          rasmlar,
          umumiy: umumiyUrl,
        },
      });
      xabar(ochiq.sanash ? 'Саналди ✓' : 'Қабул қилинди ✓');
      yop();
      await yukla();
    } catch (e) {
      xabar((e as Error).message, true);
      // (audit, 07.11.2026) Another storekeeper took it in first: the form is
      // closed and the list read again, instead of a button that fails forever.
      if (e instanceof ApiXato && e.status === 409) {
        yop();
        await yukla();
      }
    }
    setBand(false);
  };

  const slot = (url: string, yozuv: string, k: 'u' | 'y' | 'umumiy', i: number, onRm: () => void) =>
    url ? (
      <div className="vz-slot bor" style={{ backgroundImage: `url('${url}')` }}>
        <span className="fl">{yozuv}</span>
        <button className="rm" aria-label="Расмни ўчириш" onClick={onRm}>×</button>
      </div>
    ) : (
      <button className={`vz-slot ${k === 'y' ? 'y' : 'u'}`} onClick={() => setFoto({ i, k })}>
        <Icon name="camera" size={24} />
        <span>{yozuv}</span>
      </button>
    );
  const korRasm = (url: string, yozuv: string) => (
    <a className="vz-slot bor" href={safeHref(url)} target="_blank" rel="noopener noreferrer" style={{ backgroundImage: `url('${url}')` }}>
      <span className="fl">{yozuv}</span>
    </a>
  );

  return (
    <div className={`omb${light ? ' light' : ''}`}>
      <div className="top">
        <div>
          <h1>{sarlavha} қабул</h1>
          {ism && <div className="sub">{ism}</div>}
        </div>
      </div>
      {ikkala && !ochiq && (
        <div className="seg">
          {joylar.map((j) => (
            <button key={j} className={j === joy ? 'on' : ''} onClick={() => korinishTanla(j)}>
              {JOY_NOM[j]}
              {(royxat ?? []).filter((r) => r.joy === j && (r.holat !== 'qabul' || r.sanash)).length > 0 && <span className="dot" />}
            </button>
          ))}
        </div>
      )}
      <div className="body">
        {kirish === 'kut' ? (
          <div className="spin" />
        ) : kirish !== 'ok' ? (
          <div className="note rd"><Icon name="alert" size={18} />{kirish}</div>
        ) : xato ? (
          <>
            <div className="note rd"><Icon name="alert" size={18} />{xato}</div>
            <button className="btn soft" onClick={() => void yukla()}>Қайта юклаш</button>
          </>
        ) : !royxat ? (
          <div className="spin" />
        ) : ochiq ? (
          <>
            <button className="rowbtn" onClick={yop}><Icon name="back" size={18} /><span>Рўйхатга қайтиш</span></button>
            <div className="card">
              <div className="vz-nom">Возврат №{ochiq.id}</div>
              <div className="vz-kv">
                <div><span>Олиб келди</span><b>Ҳайдовчи {ochiq.haydovchi}</b></div>
                <div><span>Мижоз</span><b>{ochiq.mijoz}</b></div>
                <div><span>Сотувчи</span><b>{ochiq.sotuvchi}</b></div>
              </div>
            </div>
            {ochiq.sanash && (
              <div className="note">
                <Icon name="info" size={18} />
                Офис қабул қилинди деб белгилади{ochiq.omborVaqt ? ' · ' + sana(ochiq.omborVaqt) : ''}. Санаб, расмга олиб юборинг.
              </div>
            )}
            {ochiq.tovarlar.map((t, i) => {
              const hm = hodovoyMatn(t);
              const v = qatorlar?.[i];
              const q = ochiq.omborJavob?.[i];
              return (
                <div className="card" key={i}>
                  {hm && <span className={`chip ${hm.c}`} style={{ alignSelf: 'flex-start' }}>{hm.t}</span>}
                  {v ? <MahsulotTanla v={v} set={(p) => setQator(i, p)} /> : <div className="vz-nom">{q ? q.nom : t.nom}</div>}
                  <div className="vz-h">Ҳайдовчи маълумоти</div>
                  <KvYozuv v={t} birlik={t.birlik} holatBor />
                  {v ? (
                    <>
                      <div className="vz-h or">{JOY_XODIM[ochiq.joy]} маълумоти</div>
                      <div className="field">
                        <label htmlFor={`os${i}`}>Нечта келди?{t.birlik ? ` (${t.birlik})` : ''}</label>
                        <input id={`os${i}`} type="number" inputMode="decimal" min={0}
                          className={v.soni === '' || !(Number(v.soni) >= 0) ? 'bosh' : ''} value={v.soni}
                          onChange={(e) => setQator(i, { soni: e.target.value })} />
                      </div>
                      {/* (audit, 07.11.2026) None came: nothing to judge or photograph. */}
                      {!yoq(v) && (
                        <div className="field">
                          <span className="lb">Ҳолати</span>
                          <div className={`vz-hol${v.holat ? '' : ' bosh'}`}>
                            <button className={`gr${v.holat === 'yaroqli' ? ' on' : ''}`} onClick={() => setQator(i, { holat: 'yaroqli' })}>Яроқли</button>
                            <button className={`rd${v.holat === 'yaroqsiz' ? ' on' : ''}`} onClick={() => setQator(i, { holat: 'yaroqsiz' })}>Яроқсиз</button>
                          </div>
                        </div>
                      )}
                      <SababMaydon v={v} set={(p) => setQator(i, p)} />
                      {!yoq(v) && (
                        <div className="field">
                          <span className="lb">Расм</span>
                          <div className="vz-slots">
                            {slot(v.uUrl, '1. Маҳсулот расми', 'u', i, () => setQator(i, { u: null, uUrl: '' }))}
                            {v.holat === 'yaroqsiz' && slot(v.yUrl, '2. Шикастланган жойи', 'y', i, () => setQator(i, { y: null, yUrl: '' }))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : q ? (
                    <>
                      <div className="vz-h or">{JOY_XODIM[ochiq.joy]} маълумоти</div>
                      <KvYozuv v={q} birlik={t.birlik} holatBor />
                      {q.rasm && (
                        <div className="vz-slots">
                          {q.rasm.u && korRasm(q.rasm.u, 'Маҳсулот')}
                          {q.rasm.y && korRasm(q.rasm.y, 'Шикастланган жойи')}
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              );
            })}
            {qatorlar ? (
              <>
                {umumiyKerak && (
                  <div className="card">
                    <div className="vz-h or">Ҳаммаси битта расмда</div>
                    <div className="vz-slots">{slot(umumiy.url, 'Умумий расм', 'umumiy', -1, () => setUmumiy({ b: null, url: '' }))}</div>
                  </div>
                )}
                <div className="card">
                  <div className="field">
                    <label htmlFor="oiz">Изоҳ</label>
                    <textarea id="oiz" value={izoh} maxLength={2000} placeholder="Масалан: 2 таси келмади" onChange={(e) => setIzoh(e.target.value)} />
                  </div>
                </div>
                <div className="vz-foot">
                  <button className={`btn${tayyor ? ' green' : ''}`} disabled={!tayyor || band} onClick={qabulQil}>
                    {band ? 'Юборилмоқда…' : tayyor ? (ochiq.sanash ? 'Санаб қўйиш' : 'Қабул қилдим') : !qolganiTayyor ? 'Ҳолати ва сабабини танланг' : umumiyKerak && !umumiy.b ? 'Умумий расмни олинг' : 'Расмларни олинг'}
                  </button>
                </div>
              </>
            ) : (
              <>
                {ochiq.omborUmumiy && (
                  <div className="card"><div className="vz-h or">Умумий расм</div><div className="vz-slots">{korRasm(ochiq.omborUmumiy, 'Ҳаммаси')}</div></div>
                )}
                {ochiq.omborIzoh && <div className="note">{JOY_XODIM[ochiq.joy]} изоҳи: {ochiq.omborIzoh}</div>}
                <div className="note gr">
                  <Icon name="info" size={18} />
                  {ochiq.omborJavob ? `${JOY_NOM[ochiq.joy]} қабул қилди` : 'Офис қабул қилинди деб белгилади'}
                  {ochiq.omborchi ? ' · ' + ochiq.omborchi : ''}
                  {ochiq.omborVaqt ? ' · ' + sana(ochiq.omborVaqt) : ''}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="sect">Қабул қилиш керак · {keldi.length}</div>
            {keldi.length ? (
              <div className="card list">
                {keldi.map((r) => (
                  <button key={kalit(r)} className="lrow" onClick={() => och(r)}>
                    <span className="icav or"><Icon name="box" size={18} /><span className="nuqta" /></span>
                    <span className="mid">
                      <span className="t">{r.mijoz}</span>
                      <span className="s">Ҳайдовчи {r.haydovchi} · Сотувчи {r.sotuvchi}</span>
                      <span className="s">№{r.id} · {r.tovarlar.length} та товар</span>
                    </span>
                    {r.sanash && <span className="chip or">Санаб қўйиш</span>}
                    <span className="chev"><Icon name="chev" size={18} /></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="card" style={{ alignItems: 'center', padding: 28 }}>
                <span className="muted"><Icon name="checkcircle" size={32} /></span>
                <div className="muted">{JOYGA[joy]} келаётган возврат йўқ</div>
              </div>
            )}
            {qabul.length > 0 && (
              <>
                <hr className="vz-ajrat" />
                <div className="sect">Қабул қилинган · {qabul.length}</div>
                <div className="card list">
                  {qabul.map((r) => (
                    <button key={kalit(r)} className="lrow" onClick={() => och(r)}>
                      <span className="icav gr"><Icon name="check" size={18} /></span>
                      <span className="mid">
                        <span className="t">{r.mijoz}</span>
                        <span className="s">Ҳайдовчи {r.haydovchi} · Сотувчи {r.sotuvchi}</span>
                        <span className="s">№{r.id} · {r.omborVaqt ? sana(r.omborVaqt) : ''}</span>
                      </span>
                      <span className="chev"><Icon name="chev" size={18} /></span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {foto && (
        <Sheet onclose={() => setFoto(null)}>
          <h2>{foto.k === 'y' ? 'Шикастланган жойи' : foto.k === 'umumiy' ? 'Умумий расм' : 'Маҳсулот расми'}</h2>
          <div className={`vz-hint${foto.k === 'y' ? ' y' : ''}`}>
            <div className="ic"><Icon name={foto.k === 'y' ? 'zoom' : 'camera'} size={34} /></div>
            {foto.k === 'y' ? (
              <>
                <p>Товарнинг <b>айнан яроқсиз жойини</b> яқиндан расмга олинг: йиртилган, синган, эгилган ёки намланган жойи аниқ кўринсин.</p>
                <div className="m">Шу расмга қараб айбдор текширилади</div>
              </>
            ) : foto.k === 'umumiy' ? (
              <p>Келган <b>ҳамма товарни</b> битта расмга олинг.</p>
            ) : (
              <p>Товарни <b>бутунлай</b> кўринадиган қилиб битта расм олинг.</p>
            )}
          </div>
          <RasmTanla kamera className="btn" onrasm={rasmTanlandi}><Icon name="camera" />Расмга олиш</RasmTanla>
          <RasmTanla kamera={false} className="btn soft" onrasm={rasmTanlandi}>Галереядан</RasmTanla>
        </Sheet>
      )}
      {tayyorlanmoqda && <div className="toast">Расм тайёрланмоқда…</div>}
      {toast && <div className={`toast${toast.rd ? ' rd' : ''}`}>{toast.t}</div>}
    </div>
  );
}
