import { parseReceipt, readTotal, receiptDiffers } from './receipt-reader.service';

describe('service receipt reading (owner, 11.11.2026)', () => {
  it('keeps a confident total off a receipt, nothing else', () => {
    expect(readTotal(parseReceipt('{"is_receipt":true,"total_sum":350000,"confidence":"high"}'))).toBe(350_000);
    expect(readTotal(parseReceipt('{"is_receipt":true,"total_sum":350000,"confidence":"low"}'))).toBeNull();
    expect(readTotal(parseReceipt('{"is_receipt":false,"total_sum":null,"confidence":"high"}'))).toBeNull();
    expect(readTotal(parseReceipt('not json'))).toBeNull();
    expect(readTotal(null)).toBeNull();
  });

  it('a difference beyond rounding is flagged: 1 000 so\'m or 1 %', () => {
    expect(receiptDiffers(350_000, 350_000)).toBe(false);
    expect(receiptDiffers(350_000, 353_000)).toBe(false); // 1 % of 350 000 is 3 500
    expect(receiptDiffers(350_000, 300_000)).toBe(true);
    expect(receiptDiffers(50_000, 50_900)).toBe(false);
    expect(receiptDiffers(50_000, 52_000)).toBe(true);
    expect(receiptDiffers(350_000, null)).toBe(false);
  });
});
