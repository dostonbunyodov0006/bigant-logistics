import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

/**
 * The Monday odometer photo, read by the same vision model that reads fuel
 * dispensers (owner, 02.11.2026): a driver photographed something else and
 * typed a number under it, and nothing noticed. The photo has to show an
 * odometer, and the number on it has to be the number he typed.
 *
 * The model is a check, not the record: when it cannot answer (no key, time
 * out, unclear picture) the reading is taken as typed and marked unread, so
 * a provider outage never stops a driver starting his week.
 */
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const INSTRUCTIONS = `You check odometer photos for a trucking company in Uzbekistan.
The photo should show a vehicle instrument cluster with the total-mileage odometer (digits, usually 5-7, often labelled km, ODO or TOTAL; not the trip meter, not the speed needle, not the fuel gauge).
Answer with JSON only:
{"is_odometer": boolean, "km": integer or null, "confidence": "high" | "medium" | "low"}
is_odometer: true only if an odometer reading is actually visible in the picture.
km: the total-mileage digits exactly as shown, without decimals or the trip meter; null if not readable.
confidence: how sure you are of both fields; "low" if the picture is blurred, dark, cropped or the digits are doubtful.`;
const SCHEMA = {
  type: 'object',
  properties: {
    is_odometer: { type: 'boolean' },
    km: { type: 'integer', nullable: true },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['is_odometer', 'km', 'confidence'],
};
/** The last digit is often a rolling drum caught between two numbers. */
const TOLERANCE_KM = 1;

export type OdometerReading = { is_odometer: boolean; km: number | null; confidence: 'high' | 'medium' | 'low' };
export type OdometerVerdict = 'ok' | 'not_odometer' | 'mismatch' | 'unread';

/** Pure: what the typed number and the model's reading add up to. */
export function judgeOdometer(typedKm: number, reading: OdometerReading | null): OdometerVerdict {
  if (!reading || reading.confidence === 'low') return 'unread';
  if (!reading.is_odometer) return 'not_odometer';
  if (reading.km == null) return 'unread';
  return Math.abs(reading.km - typedKm) <= TOLERANCE_KM ? 'ok' : 'mismatch';
}

/** The model's JSON, checked field by field; anything off-shape is no reading. */
export function parseOdometer(content: string): OdometerReading | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.is_odometer !== 'boolean') return null;
  const confidence = r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low' ? r.confidence : null;
  if (!confidence) return null;
  const km = typeof r.km === 'number' && Number.isFinite(r.km) && r.km >= 0 ? Math.round(r.km) : null;
  return { is_odometer: r.is_odometer, km, confidence };
}

@Injectable()
export class OdometerReaderService {
  private readonly logger = new Logger(OdometerReaderService.name);
  private readonly key: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.key = config.get('GEMINI_API_KEY', { infer: true }) || undefined;
    this.model = config.get('GEMINI_VISION_MODEL', { infer: true });
    this.timeoutMs = config.get('FUEL_AI_TIMEOUT_MS', { infer: true });
    if (!this.key) this.logger.log('GEMINI_API_KEY is not set — odometer photos will not be read');
  }

  /** Null means "no answer": not configured, the photo could not be fetched, time out, refusal, malformed reply. Never throws. */
  async read(photoUrl: string): Promise<OdometerReading | null> {
    if (!this.key) return null;
    const photo = await this.fetchPhoto(photoUrl);
    if (!photo) return null;
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
          contents: [{ role: 'user', parts: [{ text: 'Check this odometer photo.' }, { inline_data: { mime_type: photo.mime, data: photo.base64 } }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 256 },
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const content = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      const reading = parseOdometer(content);
      if (!reading) this.logger.warn(`Gemini odometer reply did not match the schema: ${content.slice(0, 200)}`);
      else this.logger.log(`odometer photo: ${reading.is_odometer ? `${reading.km ?? '?'} km` : 'not an odometer'} (${reading.confidence})`);
      return reading;
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      this.logger.warn(aborted ? `Gemini timed out after ${this.timeoutMs}ms` : `Gemini failed: ${(err as Error)?.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchPhoto(url: string): Promise<{ mime: string; base64: string } | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
      return { mime, base64: Buffer.from(await res.arrayBuffer()).toString('base64') };
    } catch (err) {
      this.logger.warn(`odometer photo could not be fetched: ${(err as Error)?.message}`);
      return null;
    }
  }
}
