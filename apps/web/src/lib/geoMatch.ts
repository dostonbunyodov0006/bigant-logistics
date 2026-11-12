import type { GeoDistrictPublic, GeocodingResult, RegionPublic } from '@bigant/shared';

/**
 * Turns a Photon reverse-geocode result into our official region / district
 * codes, so a dropped pin can fill the two selects. OSM names for Uzbekistan
 * arrive in three scripts for the same place — "Chilonzor Tumani",
 * "Учтепинский район", "Тошкент вилояти" — and the tuman sits in `district`
 * inside Tashkent but in `county` elsewhere. Everything here is about being
 * tolerant of that while refusing to guess: a miss returns null and the user
 * picks by hand, which is the right outcome for a field that drives pay.
 */

// Uzbek/Russian Cyrillic → Latin, enough to compare stems. Not a full standard.
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', қ: 'q', ғ: 'g', ҳ: 'h',
  // Uzbek ў is oʻ in Latin script (Oltinkoʻl), not u — matters for stem equality.
  ў: 'o',
};

// Admin-unit words in every script we have seen. Stripped before comparing.
const UNIT_WORDS =
  /\b(tumani|tuman|rayon|district|shahri|shahar|shaxri|viloyati|viloyat|oblast|respublikasi|respublika|hokimiyati|city|region)\b/g;

/** Russian adjectival tuman names for Tashkent city, whose vowels differ from the
 *  Uzbek form too much for a prefix match ("mirabad" vs "mirobod"). Stems only. */
const RU_ALIASES: Record<string, string> = {
  uchtepin: 'uchtepa',
  chilanzar: 'chilonzor',
  yunusabad: 'yunusobod',
  mirabad: 'mirobod',
  yakkasaray: 'yakkasaroy',
  // The official list spells these its own way: Shayxontoxur, Sirg‘ali.
  shayxantaxur: 'shayxontoxur',
  shayhantahur: 'shayxontoxur',
  shayxontohur: 'shayxontoxur',
  almazar: 'olmazor',
  sergeliy: 'sirgali',
  sergeli: 'sirgali',
  sergeliyskiy: 'sirgali',
  bektemir: 'bektemir',
  yashnabad: 'yashnobod',
  mirzoulugbek: 'mirzoulugbek',
  yangixayot: 'yangihayot',
  yangihayot: 'yangihayot',
};

export function normalizeGeoName(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.toLowerCase();
  s = s.replace(/[а-яёўқғҳ]/g, (ch) => CYR[ch] ?? ch);
  // Apostrophes/okina in oʻ, gʻ → dropped; ŭ is how OSM writes Uzbek oʻ (Oltinkŭl = Oltinkoʻl).
  s = s.replace(/[ʻʼ'‘’`]/g, '').replace(/ŭ/g, 'o').replace(/ğ/g, 'g').replace(/ō/g, 'o');
  s = s.replace(UNIT_WORDS, ' ');
  // Russian adjective endings: учтепинский → uchtepin, мирабадский → mirabad.
  s = s.replace(/(skiy|skij|skaya|skoe|sky)\b/g, '');
  s = s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/** Stem used for comparison: normalised, spaces removed, aliases applied. */
function stem(raw: string | null | undefined): string {
  const n = normalizeGeoName(raw).replace(/\s+/g, '');
  return RU_ALIASES[n] ?? n;
}

/** Two stems refer to the same place if equal, or one is a ≥5-char prefix of the other. */
function sameStem(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  return short.length >= 5 && long.startsWith(short);
}

export function matchRegion(regions: RegionPublic[], r: GeocodingResult): RegionPublic | null {
  const byName = (name: string | null | undefined, opts: { cityOnly?: boolean } = {}) => {
    const s = stem(name);
    if (!s) return null;
    return (
      regions.find((reg) => {
        if (opts.cityOnly && !reg.is_city) return false;
        return sameStem(stem(reg.name), s);
      }) ?? null
    );
  };

  // 1. An explicit state ("Samarqand viloyati", "Тошкент вилояти"). For
  //    "toshkent" this is the *viloyat* — the city never has a state in OSM.
  const state = normalizeGeoName(r.state);
  if (state) {
    if (state === 'toshkent') {
      return regions.find((reg) => reg.code === '1727') ?? byName('Toshkent viloyati');
    }
    const hit = byName(r.state);
    if (hit) return hit;
  }
  // 2. No state and the city is Tashkent → Toshkent shahri.
  if (!state && normalizeGeoName(r.city) === 'toshkent') {
    return regions.find((reg) => reg.code === '1726') ?? byName('Toshkent shahri', { cityOnly: true });
  }
  // 3. Sometimes only the county names the region ("Nukus shahri hokimiyati" → no).
  return byName(r.county) ?? null;
}

export function matchDistrict(districts: GeoDistrictPublic[], r: GeocodingResult): GeoDistrictPublic | null {
  // Inside Tashkent the tuman is `district`; outside, `district` is usually a
  // mahalla and the tuman is `county`. Try both, tuman-shaped candidates first.
  for (const candidate of [r.district, r.county]) {
    const s = stem(candidate);
    if (!s) continue;
    const hit = districts.find((d) => sameStem(stem(d.name), s));
    if (hit) return hit;
  }
  return null;
}
