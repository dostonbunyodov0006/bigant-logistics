import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FUEL_UNITS, FUEL_UNIT_PRICE_BAND, type FuelRetakeReason, type FuelType } from '@bigant/shared';
import type { Env } from '../config/env.validation';

/**
 * What the model saw on the dispenser.
 *
 * `readable: false` is a real answer, not an error: the display was blurred,
 * glared, cut off, or the photo is not of a dispenser at all, and the driver
 * should be asked to retake. The numbers are then absent.
 */
export interface DispenserReading {
  readable: boolean;
  /** 0-100, the model's own word on how sure it is of the three numbers. */
  confidence: number | null;
  reason: FuelRetakeReason | null;
  total_sum: number | null;
  quantity: number | null;
  unit_price_sum: number | null;
  /** The unit printed on the display, as seen — not inferred from the fuel type. */
  unit: 'nm3' | 'l' | null;
  /** Lines of the display on which at least one digit was guessed. */
  unclear?: ('total' | 'quantity' | 'unit_price')[];
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

/**
 * The exact shape the model must answer in. Structured output means the
 * reply is either this JSON or a refusal; there is no prose to parse.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'confidence', 'reason', 'total_sum', 'quantity', 'unit_price_sum', 'unit', 'unclear'],
  properties: {
    readable: { type: 'boolean', description: 'True only if the unit price and the quantity can be read with confidence.' },
    confidence: {
      type: ['integer', 'null'],
      description:
        'How sure you are of the three numbers together, 0-100. 100 means every digit is sharp and the arithmetic agrees; below 60 means the driver should photograph the pump again.',
    },
    reason: {
      type: ['string', 'null'],
      enum: ['blur', 'glare', 'cropped', 'not_dispenser', 'unreadable', null],
      description: 'Why it is not readable; null when readable.',
    },
    // No example values anywhere in here. A model handed "e.g. 75527.2"
    // will return 75527.2 for a photo of a wall — it did, in testing.
    total_sum: { type: ['number', 'null'], description: 'The TOTAL PRICE / SUM figure exactly as displayed.' },
    quantity: { type: ['number', 'null'], description: 'The quantity dispensed (MASS / VOLUME / LITRES) exactly as displayed.' },
    unit_price_sum: { type: ['number', 'null'], description: 'The UNIT PRICE per unit exactly as displayed.' },
    unit: {
      type: ['string', 'null'],
      enum: ['nm3', 'l', null],
      description: 'The unit label printed next to the quantity: nm3 for NM³/m³/кг of gas, l for litres.',
    },
    unclear: {
      type: 'array',
      items: { type: 'string', enum: ['total', 'quantity', 'unit_price'] },
      description: 'The lines (total, quantity, unit_price) on which at least one digit was faint, half-lit or guessed. Empty when every digit was clear.',
    },
  },
} as const;

/**
 * The same shape for Gemini, in the OpenAPI subset its responseSchema takes:
 * `nullable` instead of a type union, no additionalProperties.
 */
const GEMINI_SCHEMA = {
  type: 'object',
  required: ['readable', 'confidence', 'reason', 'total_sum', 'quantity', 'unit_price_sum', 'unit', 'unclear'],
  properties: {
    readable: { type: 'boolean', description: 'True only if the unit price and the quantity can be read with confidence.' },
    confidence: {
      type: 'integer',
      nullable: true,
      description:
        'How sure you are of the three numbers together, 0-100. 100 means every digit is sharp and the arithmetic agrees; below 60 means the driver should photograph the pump again.',
    },
    reason: { type: 'string', nullable: true, enum: ['blur', 'glare', 'cropped', 'not_dispenser', 'unreadable'], description: 'Why it is not readable; null when readable.' },
    total_sum: { type: 'number', nullable: true, description: 'The TOTAL PRICE / SUM figure exactly as displayed.' },
    quantity: { type: 'number', nullable: true, description: 'The quantity dispensed (MASS / VOLUME / LITRES) exactly as displayed.' },
    unit_price_sum: { type: 'number', nullable: true, description: 'The UNIT PRICE per unit exactly as displayed.' },
    unit: { type: 'string', nullable: true, enum: ['nm3', 'l'], description: 'The unit label printed next to the quantity: nm3 for NM³/m³/кг of gas, l for litres.' },
    unclear: { type: 'array', items: { type: 'string', enum: ['total', 'quantity', 'unit_price'] }, description: 'The lines (total, quantity, unit_price) on which at least one digit was faint, half-lit or guessed. Empty when every digit was clear.' },
  },
} as const;

const INSTRUCTIONS = `You read fuel purchase evidence in Uzbekistan for a logistics company's fuel log: either the dispenser's display, or the printed receipt the station hands out.
Two numbers matter; read them with all your care:
- the UNIT PRICE in so'm per Nm³ or per litre — on a dispenser usually the BOTTOM, smallest field: "Цена", "Narx", "UNIT PRICE", "SUM/NM³"; on a receipt the figure next to the quantity, e.g. "12.073 × 16400". A leading letter or symbol in the cell (like "c" before 5600.0) is not a digit;
- the QUANTITY dispensed — on a dispenser the MIDDLE field: "Объем", "Hajm", "MASS" / "VOLUME" — in Nm³ (Нм3, м3) for methane, litres (л / L / litr) for petrol and propane; on a receipt the line with the fuel name, e.g. "Бензин АИ-92, литр 12.073".
The total to pay ("К оплате", "СУМ", "TOTAL PRICE", "JAMI", "ИТОГО") is worked out by us as quantity × unit price. Report it too if you can see it — it is used only to cross-check your two readings — but your task is the unit price and the quantity.
Displays are seven-segment LCD or LED. Work digit by digit, left to right, and count the digit cells in each field: faint or partially lit segments are still digits, and a leading digit is often dimmer than the rest — do not drop it. The decimal point is a small dot that is easy to miss; note where it is.
On a receipt, take the fuel line only: ignore VAT ("QQS", "НДС"), card or cash lines, and any item that is not fuel.
Check yourself with arithmetic: quantity × unit price must equal the total to within a few so'm (the pump rounds to the so'm and shows two decimals of quantity). If your reading is off by roughly a factor of ten, you have dropped or added a digit — re-read that field. If after re-reading they still disagree by more than a few so'm, one digit is wrong: answer readable=false, reason=unreadable, confidence at most 50, and still report the figures.
Confidence is about the digits, not the photo as a whole. Give 90-100 only when every digit of all three fields is crisp and unambiguous and the arithmetic agrees to the so'm. If even one digit is faded, half-lit, smeared, covered by glare, cut off, or could be read two ways (3 or 8, 5 or 6, 0 or 8, 1 or 7, a dot you are not sure of), that digit was guessed: confidence at most 60 and readable=false with the reason, whatever the other digits look like. A number you had to infer from the arithmetic rather than see counts as guessed too. Under-claiming costs the driver one tap to confirm; over-claiming puts a wrong amount in the books.
Whatever the confidence, always fill total_sum, quantity and unit_price_sum with your best digit-by-digit reading of what is on the display — a low confidence says "check this", it does not mean "say nothing". Leave a field null only when that field is not in the photo at all.
Only report numbers that are physically visible as digits in this photo. Never estimate, never fill in typical values, never reuse numbers from anywhere but the image.
If the photo shows neither a fuel dispenser display nor a fuel receipt — a wall, a receipt for parts or services, a car — answer readable=false, reason=not_dispenser.
If any of the three cannot be read with confidence — motion blur, glare across the digits, a dim unit-price cell, part of the display or paper cut off — answer readable=false with that reason, but still report every figure you can make out and leave null only the ones you genuinely cannot see. The driver is standing in front of the pump with the photo on his screen: correcting one digit of your reading is quicker, and safer, than typing all three from memory.
In "unclear" list every line — total, quantity, unit_price — on which you had to guess even one digit; leave it empty when every digit was crisp.
Answer in JSON only.`;

@Injectable()
export class FuelReaderService {
  private readonly logger = new Logger(FuelReaderService.name);
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly geminiKey: string | undefined;
  private readonly geminiModel: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.apiKey = config.get('OPENAI_API_KEY', { infer: true }) || undefined;
    this.model = config.get('OPENAI_VISION_MODEL', { infer: true });
    this.geminiKey = config.get('GEMINI_API_KEY', { infer: true }) || undefined;
    this.geminiModel = config.get('GEMINI_VISION_MODEL', { infer: true });
    this.timeoutMs = config.get('FUEL_AI_TIMEOUT_MS', { infer: true });
    if (!this.enabled) this.logger.log('neither OPENAI_API_KEY nor GEMINI_API_KEY is set — dispenser photos will not be read');
  }

  /** Two providers read the same display the same way; OpenAI when both keys are set. */
  get enabled(): boolean {
    return !!this.apiKey || !!this.geminiKey;
  }

  /**
   * Reads the display. Null means "no answer" — not configured, timed out,
   * the API refused, or the reply was malformed — and the caller carries on
   * exactly as if the reader did not exist. Nothing here throws.
   */
  async read(photoBase64: string, fuelType: FuelType): Promise<DispenserReading | null> {
    if (!this.enabled) return null;
    const expectedUnit = FUEL_UNITS[fuelType] === 'nm3' ? 'NM³ (gas)' : 'litres';
    const ask = `The driver says this is a ${fuelType} fill, so the quantity should be in ${expectedUnit}. Report the unit you actually see.`;
    return this.apiKey ? this.readOpenAI(photoBase64, fuelType, ask) : this.readGemini(photoBase64, fuelType, ask);
  }

  private readOpenAI(photoBase64: string, fuelType: FuelType, ask: string): Promise<DispenserReading | null> {
    return this.call('OpenAI', this.model, fuelType, {
      url: OPENAI_URL,
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: {
        model: this.model,
        temperature: 0,
        max_tokens: 120,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'dispenser_reading', strict: true, schema: RESPONSE_SCHEMA },
        },
        messages: [
          { role: 'system', content: INSTRUCTIONS },
          {
            role: 'user',
            content: [
              { type: 'text', text: ask },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${photoBase64}`, detail: 'high' } },
            ],
          },
        ],
      },
      extract: (body: {
        choices?: { message?: { content?: string | null; refusal?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }) => {
        const msg = body.choices?.[0]?.message;
        return {
          content: msg?.content ?? null,
          refusal: msg?.refusal ?? null,
          tokens: `${body.usage?.prompt_tokens ?? '?'}+${body.usage?.completion_tokens ?? '?'}`,
        };
      },
    });
  }

  private readGemini(photoBase64: string, fuelType: FuelType, ask: string): Promise<DispenserReading | null> {
    return this.call('Gemini', this.geminiModel, fuelType, {
      url: `${GEMINI_URL}${encodeURIComponent(this.geminiModel)}:generateContent`,
      // The key goes in a header, not the query string: URLs end up in logs.
      headers: { 'x-goog-api-key': this.geminiKey! },
      body: {
        systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: ask }, { inline_data: { mime_type: 'image/jpeg', data: photoBase64 } }],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, maxOutputTokens: 1024 },
      },
      extract: (body: {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      }) => {
        const cand = body.candidates?.[0];
        const content = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        return {
          content: content || null,
          refusal: content ? null : (body.promptFeedback?.blockReason ?? cand?.finishReason ?? null),
          tokens: `${body.usageMetadata?.promptTokenCount ?? '?'}+${body.usageMetadata?.candidatesTokenCount ?? '?'}`,
        };
      },
    });
  }

  /**
   * One POST, one timeout, one place where every way it can go wrong turns
   * into a logged null. `extract` pulls the model's text out of the
   * provider's envelope; the text is then checked like any other reply.
   */
  private async call<B>(
    provider: string,
    model: string,
    fuelType: FuelType,
    req: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
      extract: (body: B) => { content: string | null; refusal: string | null; tokens: string };
    },
  ): Promise<DispenserReading | null> {
    // A dropped connection or a busy model is not the photograph's fault: one
    // more try before the driver is handed empty boxes.
    const first = await this.once(provider, model, fuelType, req);
    if (first.reading || !first.retry) return first.reading;
    return (await this.once(provider, model, fuelType, req)).reading;
  }

  private async once<B>(
    provider: string,
    model: string,
    fuelType: FuelType,
    req: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
      extract: (body: B) => { content: string | null; refusal: string | null; tokens: string };
    },
  ): Promise<{ reading: DispenserReading | null; retry: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(req.url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', ...req.headers },
        body: JSON.stringify(req.body),
      });
      if (!res.ok) {
        this.logger.warn(`${provider} ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return { reading: null, retry: res.status === 429 || res.status >= 500 };
      }
      const { content, refusal, tokens } = req.extract((await res.json()) as B);
      if (!content) {
        this.logger.warn(`${provider} gave no content${refusal ? `: ${refusal}` : ''}`);
        return { reading: null, retry: false };
      }
      const reading = parseReading(content, fuelType);
      if (!reading) {
        this.logger.warn(`${provider} reply did not match the schema: ${content.slice(0, 200)}`);
        return { reading: null, retry: true };
      }
      this.logger.log(
        `read dispenser (${model}, ${tokens} tok): ` +
          (reading.readable ? `${reading.quantity} × ${reading.unit_price_sum} = ${reading.total_sum}` : `unreadable (${reading.reason})`),
      );
      return { reading, retry: false };
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      this.logger.warn(aborted ? `${provider} timed out after ${this.timeoutMs}ms` : `${provider} failed: ${(err as Error)?.message}`);
      return { reading: null, retry: true };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The model's JSON, checked field by field. Anything off-shape is a null read. */
export function parseReading(content: string, fuelType: FuelType): DispenserReading | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.readable !== 'boolean') return null;

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const reason = typeof r.reason === 'string' && ['blur', 'glare', 'cropped', 'not_dispenser', 'unreadable'].includes(r.reason)
    ? (r.reason as FuelRetakeReason)
    : null;
  const unit = r.unit === 'nm3' || r.unit === 'l' ? r.unit : null;
  const unclear = Array.isArray(r.unclear)
    ? (r.unclear.filter((x) => x === 'total' || x === 'quantity' || x === 'unit_price') as ('total' | 'quantity' | 'unit_price')[])
    : [];
  // The model's own word on how sure it is, kept inside 0-100.
  const said = typeof r.confidence === 'number' && Number.isFinite(r.confidence)
    ? Math.max(0, Math.min(100, Math.round(r.confidence)))
    : null;
  // Whatever it managed to read travels with the answer, sure or not: the
  // driver corrects a digit instead of typing three numbers from memory.
  const total_sum = num(r.total_sum);
  let quantity = num(r.quantity);
  let unit_price_sum = num(r.unit_price_sum);
  const anyRead = total_sum != null || quantity != null || unit_price_sum != null;

  // Any two of the three lines give the third: the pump's own arithmetic.
  // A faint price cell under a clear total and quantity is not a failed
  // photo — the price is the total over the quantity; likewise the quantity
  // is the total over the price. The band check below still applies, so a
  // misread digit that makes an impossible price is still caught.
  const missingOne =
    reason !== 'not_dispenser' &&
    [total_sum, quantity, unit_price_sum].filter((v) => v == null).length === 1;
  let derived = false;
  if (missingOne && total_sum != null && quantity != null && unit_price_sum == null) {
    unit_price_sum = Math.round((total_sum / quantity) * 10) / 10;
    derived = true;
  } else if (missingOne && total_sum != null && unit_price_sum != null && quantity == null) {
    quantity = Math.round((total_sum / unit_price_sum) * 1000) / 1000;
    derived = true;
  }

  if (!r.readable && !derived && !(missingOne && quantity != null && unit_price_sum != null)) {
    // Its own doubt, held under the line where the app asks for a new photo.
    return {
      readable: false,
      confidence: Math.min(said ?? (anyRead ? 50 : 30), 59),
      reason: reason ?? 'unreadable',
      total_sum,
      quantity,
      unit_price_sum,
      unit,
      unclear,
    };
  }
  // The total is ours: quantity × unit price, rounded to the so'm. The
  // model's own total, when it gave one, only cross-checks its two readings.
  const computed = quantity != null && unit_price_sum != null ? Math.round(quantity * unit_price_sum * 100) / 100 : null;
  // "Readable" with a number missing is the model contradicting itself: what
  // it did read is offered for correction, not treated as a reading.
  if (quantity == null || unit_price_sum == null) {
    return {
      readable: false,
      confidence: anyRead ? Math.min(said ?? 65, 79) : 40,
      reason: 'unreadable',
      total_sum,
      quantity,
      unit_price_sum,
      unit,
      unclear,
    };
  }
  // Two checks the model cannot talk its way past. The numbers come off one
  // display and must multiply out; and a unit price has to be one this fuel
  // can actually cost. A faded LCD showing 273 960 / 48.9 / 5 600 was read as
  // 27 456 / 48.81 / 562 — arithmetic nearly held, the price gave it away. A
  // wrong prefill the driver taps through is worse than an empty form, so
  // either failure is "unreadable": the driver types, as before the reader.
  const [min, max] = FUEL_UNIT_PRICE_BAND[fuelType];
  const plausible = unit_price_sum >= min && unit_price_sum <= max;
  // The displayed total, where it was read, must agree with ours; a
  // disagreement means one of the two readings has a wrong digit.
  const crossChecks = total_sum == null || productMatches(quantity, unit_price_sum, total_sum);
  if (!plausible || !crossChecks) {
    // A price this fuel cannot cost means a digit is wrong somewhere, so the
    // reading drops to where the app asks for a new photograph; arithmetic
    // that does not quite multiply out is usually one digit the driver can
    // see and fix, so that one lands in the correcting band.
    return {
      readable: false,
      confidence: plausible ? Math.min(said ?? 70, 79) : Math.min(said ?? 50, 59),
      reason: 'unreadable',
      total_sum: computed,
      quantity,
      unit_price_sum,
      unit,
      unclear,
    };
  }
  // Read whole, multiplies out, price is one this fuel can cost: it stands.
  return {
    readable: true,
    confidence: derived ? Math.min(Math.max(said ?? 85, 80), 89) : Math.max(said ?? 100, 80),
    reason: null,
    total_sum: computed,
    quantity,
    unit_price_sum,
    unit,
    unclear,
  };
}

/** Within 1 % or 1 so'm, whichever is looser — displays round the last digit. */
export function productMatches(quantity: number, unitPrice: number, total: number): boolean {
  const product = quantity * unitPrice;
  return Math.abs(product - total) <= Math.max(1, total * 0.01);
}
