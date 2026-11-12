/**
 * The white screen (owner, 06.11.2026): the server answered the refresh 200
 * every time, but the app never read the body and kept asking. Requests now
 * go as one XMLHttpRequest exchange with a text body under one time limit,
 * and one refresh runs at a time.
 */
// The secure store is read through a dynamic import, which jest cannot run:
// the web path (localStorage) stands in for it here.
const mockStore: Record<string, string> = {};
jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.Platform.OS = 'web';
  return rn;
});
(global as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mockStore[k] ?? null,
  setItem: (k: string, v: string) => {
    mockStore[k] = v;
  },
  removeItem: (k: string) => {
    delete mockStore[k];
  },
};
jest.mock('../lib/bootTrace', () => ({ bootMark: () => undefined }));

type Sent = { method: string; url: string; headers: Record<string, string>; body: unknown; x: FakeXhr };
const sent: Sent[] = [];
class FakeXhr {
  status = 0;
  responseText = '';
  responseType = '';
  timeout = 0;
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  private req: Partial<Sent> = { headers: {} };
  open(method: string, url: string) {
    this.req.method = method;
    this.req.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.req.headers![k] = v;
  }
  send(body: unknown) {
    sent.push({ ...(this.req as Sent), body, x: this });
  }
  answer(status: number, text: string) {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

beforeEach(() => {
  jest.resetModules();
  sent.length = 0;
  mockStore['bigant.refresh'] = 'old-refresh';
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
});

// Fresh after jest.resetModules(): the module keeps its token and its one refresh in flight.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const load = () => require('../lib/api') as typeof import('../lib/api');
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(n: number) {
  for (let i = 0; i < 50 && sent.length < n; i++) await tick();
}

it('reads the answer as text within one time limit, never through Blob', async () => {
  const { api } = load();
  const p = api.get<{ ok: boolean }>('/health');
  await until(1);
  expect(sent[0].x.responseType).toBe('text');
  expect(sent[0].x.timeout).toBe(20_000);
  sent[0].x.answer(200, '{"ok":true}');
  await expect(p).resolves.toEqual({ ok: true });
});

it('one refresh at a time: every caller gets the same answer', async () => {
  const { api, ensureSession } = load();
  const a = api.restore();
  const b = ensureSession();
  const c = api.restore();
  await until(1);
  await tick();
  expect(sent.filter((s) => s.url.endsWith('/auth/refresh'))).toHaveLength(1);
  sent[0].x.answer(200, '{"access_token":"A","refresh_token":"new-refresh"}');
  await expect(a).resolves.toBe(true);
  await expect(c).resolves.toBe(true);
  await b;
  expect(mockStore['bigant.refresh']).toBe('new-refresh');
});

it('a refresh that times out fails instead of waiting for ever, and the session is kept', async () => {
  const { api } = load();
  const p = api.restore();
  await until(1);
  sent[0].x.ontimeout?.();
  await expect(p).resolves.toBe(false);
  expect(mockStore['bigant.refresh']).toBe('old-refresh');
});

it('a failed refresh is not asked again by every fix for a minute', async () => {
  const { ensureSession } = load();
  const first = ensureSession(1_000);
  await until(1);
  sent[0].x.onerror?.();
  await first;
  await ensureSession(30_000);
  expect(sent).toHaveLength(1);
  const later = ensureSession(62_000);
  await until(2);
  expect(sent).toHaveLength(2);
  sent[1].x.answer(200, '{"access_token":"A","refresh_token":"r2"}');
  await later;
});

it('a photo gets time to go up; a plain request keeps 20 s (audit, 07.11.2026)', () => {
  const { timeoutFor } = load();
  expect(timeoutFor(undefined)).toBe(20_000);
  expect(timeoutFor('{"a":1}')).toBe(21_000);
  expect(timeoutFor('x'.repeat(3_000_000))).toBe(204_000);
  expect(timeoutFor('x'.repeat(10_000_000))).toBe(240_000);
});
