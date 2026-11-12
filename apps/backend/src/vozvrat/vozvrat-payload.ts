import { type VozvratCulprit, type VozvratReasonCode } from '@bigant/shared';
import { TASHKENT_OFFSET_MS } from '../common/tashkent-time';

/**
 * The vozvrat as the mini app takes it (POST …/api/tashqi/vozvrat).
 * Pure: the order's facts in, the exact JSON out. Rules from their contract
 * (tashqi.js): the reason goes as its code and they derive the blamed party
 * from it — except for "x", which adds `izoh_sabab` and `aybdor`; `soni` is
 * any positive number in `birlik`; `mahsulot_id` is their catalogue number
 * when the driver picked from the list; `rasmlar` must be https links, so a
 * photo on a plain-http dev server is simply left out rather than refused.
 */

export interface VozvratFacts {
  orderNumber: number;
  at: Date;
  driverName: string;
  clientName: string;
  sellerName: string;
  sellerTelegramId: string | null;
  comment: string | null;
  items: {
    productId: string | null;
    name: string;
    unit: string | null;
    quantity: number;
    condition: string;
    reasonCode: VozvratReasonCode;
    otherReason: string | null;
    culprit: string | null;
    photoUrl: string;
  }[];
}

/** Tashkent wall-clock time with its offset: 2026-09-29T10:20:00+05:00. */
export function tashkentIso(date: Date): string {
  return new Date(date.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 19) + '+05:00';
}

/** Their catalogue ids are integers; anything else (sample ids, blanks) is not sent. */
export function catalogueId(productId: string | null): number | null {
  // (owner, 07.11.2026) Up to 2147483647 (a Postgres INTEGER): a longer
  // "id" is no catalogue row, and looking it up failed the receive for good.
  if (!productId || !/^[1-9]\d{0,9}$/.test(productId)) return null;
  const n = Number(productId);
  return n <= 2_147_483_647 ? n : null;
}

const isHttps = (url: string) => /^https:\/\//i.test(url);

export function vozvratPayload(f: VozvratFacts) {
  return {
    id: String(f.orderNumber),
    sana: tashkentIso(f.at),
    haydovchi: f.driverName,
    mijoz: f.clientName,
    sotuvchi: f.sellerName,
    sotuvchi_id: f.sellerTelegramId ? Number(f.sellerTelegramId) : null,
    izoh: f.comment ?? '',
    tovarlar: f.items.map((i) => {
      const mahsulotId = catalogueId(i.productId);
      return {
        nom: i.name,
        soni: i.quantity,
        ...(i.unit ? { birlik: i.unit } : {}),
        holat: i.condition,
        sabab: i.reasonCode,
        ...(i.reasonCode === 'x'
          ? { izoh_sabab: i.otherReason ?? '', aybdor: i.culprit as VozvratCulprit }
          : {}),
        ...(mahsulotId !== null ? { mahsulot_id: mahsulotId } : {}),
        ...(isHttps(i.photoUrl) ? { rasmlar: [i.photoUrl] } : {}),
      };
    }),
  };
}

export type VozvratPayload = ReturnType<typeof vozvratPayload>;

/** Retry spacing after a failed send: 1, 2, 4 … minutes, at most an hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}
