import { FuelReaderService, parseReading } from './fuel-reader.service';

/**
 * The reader is a thin, defensive wrapper: whatever OpenAI does — answer,
 * refuse, time out, be unconfigured — the caller gets a reading or null and
 * never an exception.
 */

const config = (env: Record<string, unknown>) =>
  ({ get: (k: string) => env[k] }) as never;

const openaiReply = (content: unknown, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
      usage: { prompt_tokens: 1200, completion_tokens: 40 },
      ...extra,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('parseReading — the model\'s JSON, checked', () => {
  it('accepts the real dispenser reading', () => {
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600, unit: 'nm3' }), 'gaz'))
      .toEqual({ readable: true, confidence: 100, reason: null, total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600, unit: 'nm3', unclear: [] });
  });

  it('carries the retake reason through', () => {
    expect(parseReading(JSON.stringify({ readable: false, reason: 'glare', total_sum: null, quantity: null, unit_price_sum: null, unit: null }), 'gaz'))
      .toMatchObject({ readable: false, reason: 'glare', total_sum: null });
  });

  it('fills a missing quantity from the total and the price', () => {
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 75527.2, quantity: null, unit_price_sum: 5600, unit: 'nm3' }), 'gaz'))
      .toMatchObject({ readable: true, quantity: 13.487 });
  });

  it('refuses a unit price no fuel costs — the dropped digit arithmetic could not catch', () => {
    // What gpt-4.1-mini returned for a faded Russian-labelled LCD showing
    // 273 960 / 48.9 / 5 600: self-consistent to 0.1 %, and 562 so'm per Nm³.
    // Kept on the screen for the driver to correct, but under the line where
    // the app asks for a better photograph.
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 27456, quantity: 48.81, unit_price_sum: 562, unit: 'nm3' }), 'gaz'))
      // The total is ours now: 48.81 × 562, offered for correction with the rest.
      .toMatchObject({ readable: false, reason: 'unreadable', total_sum: 27431.22, confidence: 50 });
    // The same price is fine for the fuel it belongs to, and vice versa.
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 560000, quantity: 100, unit_price_sum: 5600, unit: 'nm3' }), 'gaz')).toMatchObject({ readable: true });
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 560000, quantity: 100, unit_price_sum: 5600, unit: 'l' }), 'benzin')).toMatchObject({ readable: true });
  });

  it('refuses a reading whose own numbers do not multiply out', () => {
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 75527.2, quantity: 13.487, unit_price_sum: 6600, unit: 'nm3' }), 'gaz'))
      .toMatchObject({ readable: false, reason: 'unreadable' });
  });

  it('tolerates the rounding a display does, absolute or relative', () => {
    // Off by 0.6 so'm on a small fill, and by 0.4 % on a large one.
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 75527, quantity: 13.487, unit_price_sum: 5600, unit: 'nm3' }), 'gaz'))
      .toMatchObject({ readable: true });
    // The total recorded is quantity × price, whatever the display rounded to.
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 273960, quantity: 48.9, unit_price_sum: 5600, unit: 'nm3' }), 'gaz'))
      .toMatchObject({ readable: true, total_sum: 273840 });
    // The photo from the field: 5600.0 per Nm³ × 12.120 Nm³ = 67 872.0.
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 67872, quantity: 12.12, unit_price_sum: 5600, unit: 'nm3' }), 'gaz'))
      .toMatchObject({ readable: true, total_sum: 67872 });
    // The total not seen at all: worked out from the two that were.
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: null, quantity: 12.12, unit_price_sum: 5600, unit: 'nm3' }), 'gaz'))
      .toMatchObject({ readable: true, total_sum: 67872 });
  });

  it('treats zero, negatives and non-numbers as not read, and works them out when it can', () => {
    // A zero quantity is no reading; the total and price give it back.
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 72800, quantity: 0, unit_price_sum: 5600, unit: 'l' }), 'gaz'))
      .toMatchObject({ readable: true, quantity: 13 });
    // A price as text is no reading; the total and quantity give it back.
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 72800, quantity: 13, unit_price_sum: '5600', unit: 'l' }), 'gaz'))
      .toMatchObject({ readable: true, unit_price_sum: 5600 });
    // Two not read: nothing to work out.
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: 72800, quantity: -1, unit_price_sum: 'x', unit: 'l' }), 'gaz'))
      .toMatchObject({ readable: false });
    // A total it could not make out does not matter: ours is 13 × 5600.
    expect(parseReading(JSON.stringify({ readable: true, reason: null, total_sum: '75527', quantity: 13, unit_price_sum: 5600, unit: 'l' }), 'gaz'))
      .toMatchObject({ readable: true, total_sum: 72800 });
  });

  it('works out the missing line from the other two', () => {
    // Price cell too faint: 55927.2 / 9.987 = 5600.0.
    expect(parseReading(JSON.stringify({ readable: false, reason: 'unreadable', total_sum: 55927.2, quantity: 9.987, unit_price_sum: null, unit: 'nm3' }), 'gaz'))
      .toMatchObject({ readable: true, unit_price_sum: 5600, quantity: 9.987, total_sum: 55927.2 });
    // Quantity cell too faint: 67872 / 5600 = 12.12.
    expect(parseReading(JSON.stringify({ readable: false, reason: 'unreadable', total_sum: 67872, quantity: null, unit_price_sum: 5600, unit: 'nm3' }), 'gaz'))
      .toMatchObject({ readable: true, quantity: 12.12, total_sum: 67872 });
    // A worked-out price no gas can cost is still refused.
    expect(parseReading(JSON.stringify({ readable: false, reason: 'unreadable', total_sum: 5592.7, quantity: 9.987, unit_price_sum: null, unit: 'nm3' }), 'gaz'))
      .toMatchObject({ readable: false });
    // Two lines missing: nothing to work out.
    expect(parseReading(JSON.stringify({ readable: false, reason: 'unreadable', total_sum: 55927.2, quantity: null, unit_price_sum: null, unit: 'nm3' }), 'gaz'))
      .toMatchObject({ readable: false });
  });

  it('carries the lines the reader was unsure of', () => {
    expect(parseReading(JSON.stringify({ readable: false, reason: 'unreadable', total_sum: 55927.2, quantity: 9.987, unit_price_sum: 5600, unit: 'nm3', unclear: ['unit_price', 'bogus'] }), 'gaz'))
      .toMatchObject({ unclear: ['unit_price'] });
  });

  it('returns null for anything that is not the schema at all', () => {
    expect(parseReading('not json', 'gaz')).toBeNull();
    expect(parseReading('null', 'gaz')).toBeNull();
    expect(parseReading(JSON.stringify({ hello: 'world' }), 'gaz')).toBeNull();
  });
});

describe('FuelReaderService', () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch');
  afterEach(() => fetchSpy.mockReset());
  afterAll(() => fetchSpy.mockRestore());

  const svc = () => new FuelReaderService(config({ OPENAI_API_KEY: 'sk-test', OPENAI_VISION_MODEL: 'gpt-4.1-mini', FUEL_AI_TIMEOUT_MS: 50 }));

  it('reads through Gemini when only its key is set — same instructions, same checks', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ readable: true, reason: null, total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600, unit: 'nm3' }) }] } }],
          usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const s = new FuelReaderService(config({ OPENAI_API_KEY: '', GEMINI_API_KEY: 'g-test', GEMINI_VISION_MODEL: 'gemini-3.6-flash', FUEL_AI_TIMEOUT_MS: 50 }));
    expect(s.enabled).toBe(true);
    const r = await s.read('aGVsbG8=', 'gaz');
    expect(r).toMatchObject({ readable: true, total_sum: 75527.2, unit: 'nm3' });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
    expect(url).not.toContain('g-test');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-test');
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.required).toContain('total_sum');
    expect(body.contents[0].parts[1].inline_data.data).toBe('aGVsbG8=');
    expect(body.systemInstruction.parts[0].text).toContain('dispenser');
  });

  it('a Gemini reply with no text (blocked) is null', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }), { status: 200 }));
    const s = new FuelReaderService(config({ GEMINI_API_KEY: 'g-test', GEMINI_VISION_MODEL: 'gemini-3.6-flash', FUEL_AI_TIMEOUT_MS: 50 }));
    expect(await s.read('aGVsbG8=', 'gaz')).toBeNull();
  });

  it('is a no-op without a key — no request is made', async () => {
    const s = new FuelReaderService(config({ OPENAI_API_KEY: undefined, GEMINI_API_KEY: '', OPENAI_VISION_MODEL: 'gpt-4.1-mini', FUEL_AI_TIMEOUT_MS: 1000 }));
    expect(s.enabled).toBe(false);
    expect(await s.read('aGVsbG8=', 'gaz')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks for strict JSON, sends the photo, and returns the reading', async () => {
    fetchSpy.mockResolvedValue(openaiReply({ readable: true, reason: null, total_sum: 75527.2, quantity: 13.487, unit_price_sum: 5600, unit: 'nm3' }));
    const r = await svc().read('aGVsbG8=', 'gaz');
    expect(r).toMatchObject({ readable: true, total_sum: 75527.2, unit: 'nm3' });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4.1-mini');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,aGVsbG8=$/);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('a refusal or empty content is null, not an error', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: 'no' } }] }), { status: 200 }));
    expect(await svc().read('aGVsbG8=', 'gaz')).toBeNull();
  });

  it('an HTTP error is null, not an error', async () => {
    fetchSpy.mockResolvedValue(new Response('rate limited', { status: 429 }));
    expect(await svc().read('aGVsbG8=', 'gaz')).toBeNull();
  });

  it('a timeout is null, not a hung request', async () => {
    fetchSpy.mockImplementation((_u, init) =>
      new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    );
    expect(await svc().read('aGVsbG8=', 'gaz')).toBeNull();
  });

  it('a network failure is null', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNRESET'));
    expect(await svc().read('aGVsbG8=', 'gaz')).toBeNull();
  });
});
