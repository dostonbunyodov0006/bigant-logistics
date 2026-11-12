import {
  VOZVRAT_QUANTITY_DECIMALS,
  VOZVRAT_QUANTITY_MAX,
  VOZVRAT_REASONS,
  culpritOf,
  type VozvratCondition,
  type VozvratCulprit,
  type VozvratItemInput,
  type VozvratProduct,
  type VozvratReasonCode,
} from '@bigant/shared';
import { api } from './api';

/**
 * The vozvrat report on the phone: one entry per returned product, built up
 * on the Vozvrat screen and sent with the return itself.
 */

export const VOZVRAT_KEYS = {
  products: (q: string) => ['vozvrat', 'products', q] as const,
};

export const searchProducts = (q: string) =>
  api.get<VozvratProduct[]>(`/vozvrat/products?q=${encodeURIComponent(q)}`);

/** A product the driver typed because the list has no such thing. It goes
 *  by name only; the mini app files it as new for the manager to approve. */
export const CUSTOM_PRODUCT_ID = 'custom';
export const customProduct = (name: string): VozvratProduct => ({
  id: CUSTOM_PRODUCT_ID,
  name: name.trim(),
  unit: null,
  xodovoy: null,
});
export const isCustomProduct = (p: VozvratProduct | null) => p?.id === CUSTOM_PRODUCT_ID;

/** A product being written up. The photo is uploaded when the entry is saved,
 *  so a saved entry always carries its URL. */
export interface VozvratDraft {
  product: VozvratProduct | null;
  /** As typed: "2", "2.5" or "2,5" — read with quantityOf. */
  quantity: string;
  condition: VozvratCondition | null;
  reason: VozvratReasonCode | null;
  otherReason: string;
  culprit: VozvratCulprit | null;
  photoUri: string | null;
  photoUrl: string | null;
  /** More photos of the same product (up to three): a local shot until saved, then its URL. */
  extraPhotos: string[];
}

/** Photos of one product, the first one included. */
export const VOZVRAT_PHOTOS_MAX = 4;

export const emptyDraft = (): VozvratDraft => ({
  product: null,
  quantity: '1',
  condition: null,
  reason: null,
  otherReason: '',
  culprit: null,
  photoUri: null,
  photoUrl: null,
  extraPhotos: [],
});

/** Who is to blame: from the reason, or the driver's pick under "x". */
export function blameOf(d: VozvratDraft): VozvratCulprit | null {
  if (!d.reason) return null;
  return d.reason === 'x' ? d.culprit : culpritOf(d.reason);
}

/** Keeps a typed quantity to digits and one decimal mark, at most three decimals. */
export function cleanQuantityText(raw: string): string {
  const [whole = '', ...rest] = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '').split('.');
  const frac = rest.join('').slice(0, VOZVRAT_QUANTITY_DECIMALS);
  return rest.length > 0 ? `${whole.slice(0, 7)}.${frac}` : whole.slice(0, 7);
}

/** The quantity as a number, or null when what was typed is not a usable amount. */
export const quantityOf = (d: VozvratDraft): number | null => {
  const text = cleanQuantityText(d.quantity);
  if (!text || text.endsWith('.')) return null;
  const n = Number(text);
  return n > 0 && n <= VOZVRAT_QUANTITY_MAX ? n : null;
};

/** The quantity stepped by `by`, as text; never below the smallest amount. */
export function stepQuantity(d: VozvratDraft, by: number): string {
  const scale = 10 ** VOZVRAT_QUANTITY_DECIMALS;
  const next = Math.round(((quantityOf(d) ?? 0) + by) * scale) / scale;
  return String(next > 0 ? next : 1 / scale);
}

/** The first thing still missing, as an i18n key — or null when it can be saved.
 *  The photo is judged by the local shot; it is uploaded on save. */
export function missingOf(d: VozvratDraft): string | null {
  if (!d.product) return 'vozvrat.missingProduct';
  if (quantityOf(d) == null) return 'vozvrat.missingQuantity';
  if (!d.condition) return 'vozvrat.missingCondition';
  if (!d.reason) return 'vozvrat.missingReason';
  if (d.reason === 'x' && !d.otherReason.trim()) return 'vozvrat.missingOtherReason';
  if (d.reason === 'x' && !d.culprit) return 'vozvrat.missingCulprit';
  if (!d.photoUri && !d.photoUrl) return 'vozvrat.missingPhoto';
  return null;
}

/** A saved entry as the server takes it. */
export function toItemInput(d: VozvratDraft): VozvratItemInput {
  return {
    product_id: isCustomProduct(d.product) ? null : d.product!.id,
    name: d.product!.name,
    unit: d.product!.unit,
    xodovoy: d.product!.xodovoy,
    quantity: quantityOf(d)!,
    condition: d.condition!,
    reason: d.reason!,
    other_reason: d.reason === 'x' ? d.otherReason.trim() : null,
    culprit: d.reason === 'x' ? d.culprit : null,
    photo_url: d.photoUrl!,
    extra_photo_urls: d.extraPhotos ?? [],
  };
}

/** "2.5 kg" — the amount with the product's unit, for lists and summaries. */
export function quantityLabel(d: VozvratDraft): string {
  return `${quantityOf(d) ?? d.quantity} ${d.product?.unit ?? ''}`.trim();
}

export const reasonText = (code: VozvratReasonCode) =>
  VOZVRAT_REASONS.find((r) => r.code === code)?.text ?? code;

/** The reason list in the order the driver reads it, grouped by who is to blame. */
export const REASON_GROUPS: { key: VozvratCulprit | 'other'; codes: VozvratReasonCode[] }[] = [
  { key: 'sotuvchi', codes: ['s1', 's2', 's3'] },
  { key: 'mijoz', codes: ['m1', 'm2', 'm3', 'm4', 'm5'] },
  { key: 'omborchi', codes: ['o1', 'o2', 'o3', 'o4', 'o5'] },
  { key: 'haydovchi', codes: ['h1', 'h2'] },
  { key: 'other', codes: ['x'] },
];
