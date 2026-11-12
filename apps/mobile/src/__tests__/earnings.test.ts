import { bonusRows } from '../lib/earnings';

const line = (type: string, count: number, amount_som: number) => ({ type, count, unit_price_som: 0, amount_som }) as never;

describe('the three bonus rows', () => {
  it('joins city with outside, and mornings with evenings', () => {
    expect(
      bonusRows([
        line('pickup_city', 2, 20),
        line('pickup_outside', 1, 40),
        line('delivery_city', 3, 30),
        line('early_start', 30, 35),
        line('evening_overtime', 60, 70),
      ]),
    ).toEqual([
      { key: 'pickup', count: 3, amount: 60 },
      { key: 'delivery', count: 3, amount: 30 },
      { key: 'overtime', count: 90, amount: 105 },
    ]);
  });

  it('keeps all three rows when there is nothing yet, and ignores anything else an old server sends', () => {
    expect(bonusRows([line('daily_wage', 5, 1000), line('fine', 1, -50)])).toEqual([
      { key: 'pickup', count: 0, amount: 0 },
      { key: 'delivery', count: 0, amount: 0 },
      { key: 'overtime', count: 0, amount: 0 },
    ]);
  });
});
