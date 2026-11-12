import { photoUrlSchema } from './photo-url';
import { z } from 'zod';

/**
 * Vozvrat (return) report — what the driver records for each returned product
 * when he starts a return: how many, usable or damaged, why, and who is to
 * blame. The server forwards it to the vozvrat mini app
 * (POST …/api/tashqi/vozvrat) with the reason *code*; the blamed party is
 * derived from the code there, except for "x" where the driver names it.
 *
 * The warehouse side is not the driver's to fill in: which storekeeper handed
 * the goods out is recorded by the storekeeper who takes them back, in the
 * mini app. So no storekeeper is asked for here, whatever the reason.
 */

export const VOZVRAT_CULPRITS = ['sotuvchi', 'mijoz', 'omborchi', 'haydovchi'] as const;
export type VozvratCulprit = (typeof VOZVRAT_CULPRITS)[number];

/** Code → the text the driver sees → who is to blame (null: the driver chooses). */
export const VOZVRAT_REASONS = [
  { code: 's1', text: 'Noto‘g‘ri tovar yozgan Sotuvchi', culprit: 'sotuvchi' },
  { code: 's2', text: 'Sonini ko‘p yozgan Sotuvchi', culprit: 'sotuvchi' },
  { code: 's3', text: 'Yetkazib berish kechikkan Sotuvchi', culprit: 'sotuvchi' },
  { code: 'm1', text: 'Qabul qilayotganda yaroqsiz holatga keltirgan Mijoz', culprit: 'mijoz' },
  { code: 'm2', text: 'Kunlar o‘tgach yaroqsiz holatga keltirgan Mijoz', culprit: 'mijoz' },
  { code: 'm3', text: 'Mijoz noto‘g‘ri tovar zayavka bergan', culprit: 'mijoz' },
  { code: 'm4', text: 'Mijoz ortiqcha buyurtma bergan', culprit: 'mijoz' },
  { code: 'm5', text: 'Mijoz buyurtmani bekor qilgan', culprit: 'mijoz' },
  { code: 'o1', text: 'Noto‘g‘ri tovar bergan Omborchi', culprit: 'omborchi' },
  { code: 'o2', text: 'Sonini ko‘p bergan Omborchi', culprit: 'omborchi' },
  { code: 'o3', text: 'Yaroqsiz tovar bergan Omborchi', culprit: 'omborchi' },
  { code: 'o4', text: 'Yuklashda tovarni shikastlagan Omborchi', culprit: 'omborchi' },
  { code: 'o5', text: 'Yetkazib berish kechikkan Omborchi', culprit: 'omborchi' },
  { code: 'h1', text: 'Yo‘lda yaroqsiz holatga keltirgan Haydovchi', culprit: 'haydovchi' },
  { code: 'h2', text: 'Yetkazib berish kechikkan Haydovchi', culprit: 'haydovchi' },
  { code: 'x', text: 'Boshqa sabab', culprit: null },
] as const satisfies readonly { code: string; text: string; culprit: VozvratCulprit | null }[];

export const VOZVRAT_REASON_CODES = VOZVRAT_REASONS.map((r) => r.code) as [
  (typeof VOZVRAT_REASONS)[number]['code'],
  ...(typeof VOZVRAT_REASONS)[number]['code'][],
];
export type VozvratReasonCode = (typeof VOZVRAT_REASON_CODES)[number];

export const VOZVRAT_CONDITIONS = ['yaroqli', 'yaroqsiz'] as const;
export type VozvratCondition = (typeof VOZVRAT_CONDITIONS)[number];

/** Who a reason blames; null for "x", where the driver says. */
export function culpritOf(code: VozvratReasonCode): VozvratCulprit | null {
  return VOZVRAT_REASONS.find((r) => r.code === code)?.culprit ?? null;
}

/** Quantities are counted in the product's own unit, so 2.5 (kg, m) is a
 *  valid amount; three decimals is as fine as any price list goes. */
export const VOZVRAT_QUANTITY_MAX = 1_000_000;
export const VOZVRAT_QUANTITY_DECIMALS = 3;

export const vozvratQuantitySchema = z
  .number()
  .positive()
  .max(VOZVRAT_QUANTITY_MAX)
  // Not Number.isInteger(n * 1000): 16.08 * 1000 is 16079.999999999998 in
  // binary floating point, and the driver was told his quantity was invalid.
  // Compare against the nearest whole thousandth instead.
  .refine(
    (n) => {
      const scaled = n * 10 ** VOZVRAT_QUANTITY_DECIMALS;
      return Number.isFinite(scaled) && Math.abs(scaled - Math.round(scaled)) < 1e-6;
    },
    { message: 'vozvrat_quantity_precision' },
  );

/** One returned product, as the driver records it. */
export const vozvratItemSchema = z
  .object({
    // From the product catalogue search; name, unit and xodovoy are copied as seen.
    product_id: z.string().trim().max(100).nullish(),
    name: z.string().trim().min(1).max(200),
    unit: z.string().trim().max(20).nullish(),
    xodovoy: z.boolean().nullish(),
    quantity: vozvratQuantitySchema,
    condition: z.enum(VOZVRAT_CONDITIONS),
    reason: z.enum(VOZVRAT_REASON_CODES),
    // "x" only: the reason in words and who is to blame.
    other_reason: z.string().trim().max(500).nullish(),
    culprit: z.enum(VOZVRAT_CULPRITS).nullish(),
    // Photo of the returned product — required.
    photo_url: photoUrlSchema,
    // More photos of it, up to three: four in all.
    extra_photo_urls: z.array(photoUrlSchema).max(3).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.reason === 'x') {
      if (!v.other_reason) ctx.addIssue({ code: 'custom', path: ['other_reason'], message: 'vozvrat_other_reason_required' });
      if (!v.culprit) ctx.addIssue({ code: 'custom', path: ['culprit'], message: 'vozvrat_culprit_required' });
    }
  });
export type VozvratItemInput = z.infer<typeof vozvratItemSchema>;

/** A product from the catalogue search (the mini app's list). */
export const vozvratProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string().nullable(),
  xodovoy: z.boolean().nullable(),
});
export type VozvratProduct = z.infer<typeof vozvratProductSchema>;
