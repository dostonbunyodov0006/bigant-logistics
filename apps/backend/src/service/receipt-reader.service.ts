import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

/**
 * The service receipt, read by the same vision model that reads the Monday
 * odometer (owner, 11.11.2026): the total printed on the receipt is set
 * against the total the driver typed, and a difference is shown to the
 * office.
 *
 * A check, not the record: what the driver typed is what is paid. When the
 * model cannot answer (no key, time out, unclear photo) the visit is saved
 * all the same, with nothing read.
 */
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const INSTRUCTIONS = `You read receipts for vehicle repair and spare parts in Uzbekistan for a logistics company.
Find the TOTAL amount paid on the receipt, in so'm: usually labelled "Jami", "JAMI", "Итого", "ИТОГО", "Всего", "К оплате", "Сумма", "TOTAL". It may be printed by a till or written by hand.
Read digit by digit. Spaces, dots or commas between groups of three digits are thousands separators (350 000, 350.000, 350,000 are all 350000). Ignore VAT lines ("QQS", "НДС") and change given back.
Answer with JSON only:
{"is_receipt": boolean, "total_sum": number or null, "confidence": "high" | "medium" | "low"}
is_receipt: true only if the photo shows a receipt, invoice or handwritten bill.
total_sum: the total in so'm exactly as written; null if it is not readable.
confidence: "low" if the photo is blurred, dark, cut off or any digit of the total is doubtful.
Only report digits that are visible in this photo. Never estimate.`;
const SCHEMA = {
  type: 'object',
  properties: {
    is_receipt: { type: 'boolean' },
    total_sum: { type: 'number', nullable: true },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['is_receipt', 'total_sum', 'confidence'],
};

export type ReceiptReading = { is_receipt: boolean; total_sum: number | null; confidence: 'high' | 'medium' | 'low' };

/** The read total worth keeping: a receipt, a number, and not a guess. */
export function readTotal(reading: ReceiptReading | null): number | null {
  if (!reading || !reading.is_receipt || reading.confidence === 'low' || reading.total_sum == null) return null;
  return reading.total_sum;
}

/** Typed and read differ by more than rounding: 1 000 so'm or 1 %, whichever is larger. */
export function receiptDiffers(typed: number, read: number | null): boolean {
  if (read == null) return false;
  return Math.abs(typed - read) > Math.max(1000, typed * 0.01);
}

/** The model's JSON, checked field by field; anything off-shape is no reading. */
export function parseReceipt(content: string): ReceiptReading | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.is_receipt !== 'boolean') return null;
  const confidence = r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low' ? r.confidence : null;
  if (!confidence) return null;
  const total = typeof r.total_sum === 'number' && Number.isFinite(r.total_sum) && r.total_sum >= 0 ? Math.round(r.total_sum) : null;
  return { is_receipt: r.is_receipt, total_sum: total, confidence };
}

@Injectable()
export class ReceiptReaderService {
  private readonly logger = new Logger(ReceiptReaderService.name);
  private readonly key: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.key = config.get('GEMINI_API_KEY', { infer: true }) || undefined;
    this.model = config.get('GEMINI_VISION_MODEL', { infer: true });
    this.timeoutMs = config.get('FUEL_AI_TIMEOUT_MS', { infer: true });
    if (!this.key) this.logger.log('GEMINI_API_KEY is not set — service receipts will not be read');
  }

  /** Null means "no answer". Never throws. */
  async read(photoBase64: string): Promise<ReceiptReading | null> {
    if (!this.key) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${GEMINI_URL}${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        // The key goes in a header, not the query string: URLs end up in logs.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
          contents: [{ role: 'user', parts: [{ text: 'Read the total on this receipt.' }, { inline_data: { mime_type: 'image/jpeg', data: photoBase64 } }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 256 },
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const content = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      const reading = parseReceipt(content);
      if (!reading) this.logger.warn(`Gemini receipt reply did not match the schema: ${content.slice(0, 200)}`);
      else this.logger.log(`service receipt: ${reading.is_receipt ? `${reading.total_sum ?? '?'} so'm` : 'not a receipt'} (${reading.confidence})`);
      return reading;
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      this.logger.warn(aborted ? `Gemini timed out after ${this.timeoutMs}ms` : `Gemini failed: ${(err as Error)?.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
