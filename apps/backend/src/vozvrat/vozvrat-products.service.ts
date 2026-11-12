import { Injectable } from '@nestjs/common';
import type { VozvratProduct } from '@bigant/shared';
import { OmborService } from '../ombor/ombor.service';

/**
 * The product list the driver's vozvrat form searches: the warehouse's own
 * list, kept on this server since the warehouse moved here from the mini app
 * (owner, 05.11.2026) — the same products, the same ids.
 */
@Injectable()
export class VozvratProductsService {
  constructor(private readonly ombor: OmborService) {}

  /** Up to `limit` products matching `q`; the first ones alphabetically when `q` is blank. */
  async search(q: string, limit = 20): Promise<VozvratProduct[]> {
    return rankProducts(await this.all(), q).slice(0, limit);
  }

  async all(): Promise<VozvratProduct[]> {
    return (await this.ombor.products()).map((m) => ({ id: String(m.id), name: m.name, unit: m.unit, xodovoy: m.hodovoy }));
  }
}

const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();

// The catalogue is written in Cyrillic ("Дорожная сетка"); drivers type in
// Uzbek Latin, by ear ("darojni setka"). Both are brought to one rough Latin
// sound-skeleton: Cyrillic spelled out, o and a treated alike, q/k and x/h
// alike, apostrophes dropped.
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 's',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'u', қ: 'k', ғ: 'g', ҳ: 'h',
};
const skeleton = (s: string) =>
  [...s.toLowerCase()]
    .map((ch) => CYR[ch] ?? ch)
    .join('')
    .replace(/[ʻʼ'`‘’]/g, '')
    .replace(/o/g, 'a')
    .replace(/q/g, 'k')
    .replace(/x/g, 'h');
const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Uzbek endings a driver adds by habit ("setkani", "trubadan").
const SUFFIXES = ['ning', 'lar', 'dan', 'ni', 'ga', 'da'];
const stem = (w: string) => {
  for (const suf of SUFFIXES) if (w.length - suf.length >= 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  return w;
};
/** Every typed word starts some word of the name, by sound, in either script. */
const soundsLike = (name: string, q: string) => {
  const nameWords = words(name).map(skeleton);
  const typed = words(q).map((w) => stem(skeleton(w)));
  return typed.length > 0 && typed.every((t) => nameWords.some((n) => n.startsWith(t)));
};

/** Best matches first: name starts with the text, then a word does, then it is
 *  inside, then it sounds like it in the other script. */
export function rankProducts(products: VozvratProduct[], q: string): VozvratProduct[] {
  const needle = fold(q);
  if (!needle) return products;
  const score = (name: string) => {
    const n = fold(name);
    if (n.startsWith(needle)) return 0;
    if (n.split(/[\s\-/(),.]+/).some((w) => w.startsWith(needle))) return 1;
    if (n.includes(needle)) return 2;
    return soundsLike(name, q) ? 3 : null;
  };
  return products
    .map((p, i) => ({ p, i, s: score(p.name) }))
    .filter((x): x is { p: VozvratProduct; i: number; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.p);
}
