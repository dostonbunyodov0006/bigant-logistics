import type { DriverEarnings } from '@bigant/shared';

export type BonusRow = { key: 'pickup' | 'delivery' | 'overtime'; count: number; amount: number };

/**
 * The three rows of "Ma'lumotlarim" (owner, 02.11.2026), the same three the
 * office has: city and outside trips together, mornings and evenings together.
 * `count` is trips for the first two, minutes for the extra hours.
 */
export function bonusRows(lines: DriverEarnings['lines']): BonusRow[] {
  const sum = (types: string[]) => {
    const picked = lines.filter((l) => types.includes(l.type));
    return {
      count: picked.reduce((a, l) => a + l.count, 0),
      amount: picked.reduce((a, l) => a + l.amount_som, 0),
    };
  };
  return [
    { key: 'pickup', ...sum(['pickup_city', 'pickup_outside']) },
    { key: 'delivery', ...sum(['delivery_city', 'delivery_outside']) },
    { key: 'overtime', ...sum(['early_start', 'evening_overtime']) },
  ];
}
