import { Platform } from 'react-native';
import { bootMark } from './bootTrace';
import Constants from 'expo-constants';

// Only a fallback for a build whose config never arrived; a shipped APK that
// quietly talked to the phone itself would look broken with no reason given.
const FALLBACK = 'https://logistics.example.com/api';

/**
 * app.config.js always supplies this — production by default, overridden for
 * development by .env.development.
 *
 * On a handset `localhost` is the handset, so a development URL pointing there
 * reaches nothing. Expo already knows the address of the machine serving the
 * bundle, so borrow its host: the same `.env.development` then works on a
 * phone, an emulator and the web with no per-machine IP to keep up to date.
 */
function resolveBase(): string {
  const base = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? FALLBACK;
  if (Platform.OS === 'web' || !/^https?:\/\/(localhost|127\.0\.0\.1)(?::|\/|$)/.test(base)) {
    return base;
  }
  const hostUri = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri;
  const host = hostUri?.split(':')[0];
  return host ? base.replace(/\/\/(?:localhost|127\.0\.0\.1)/, `//${host}`) : base;
}

const BASE: string = resolveBase();
/** The API's address, for the phone's own location service. */
export const apiBase = (): string => BASE;
const REFRESH_KEY = 'bigant.refresh';

const STORE_SLOW = Symbol('store-slow');
/** The secure store did not answer in time: the session is not known, not absent. */
export class StoreSlowError extends Error {
  constructor() {
    super('secure_store_slow');
  }
}

/**
 * The phone's secure store can refuse to read what it wrote — a reinstall
 * that kept the data but not the key behind it (02.11.2026: the app sat on
 * its spinner for ever, never reaching the server). An unreadable entry is
 * dropped and counts as absent: he signs in again, which is all it means.
 */
const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    // A keystore left unreadable by a restored backup can hang the read
    // instead of failing: the app sat on its spinner (owner, 04.11.2026).
    // After four seconds the read is given up — but as "not known yet", not as
    // "no session" (audit, 07.11.2026): a phone merely slow at a cold start
    // was sent to the login screen with a good session in the store. The
    // caller tries again; the entry is not deleted.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<typeof STORE_SLOW>((resolve) => {
      timer = setTimeout(() => resolve(STORE_SLOW), 4_000);
    });
    try {
      const v = await Promise.race([
        import('expo-secure-store').then((SecureStore) => SecureStore.getItemAsync(key)),
        slow,
      ]);
      if (v === STORE_SLOW) throw new StoreSlowError();
      return v;
    } catch (err) {
      if (err instanceof StoreSlowError) throw err;
      const SecureStore = await import('expo-secure-store');
      await SecureStore.deleteItemAsync(key).catch(() => undefined);
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    // Never waited on for ever either: a write that hangs must not hold the start.
    await Promise.race([
      import('expo-secure-store').then((SecureStore) =>
        // iPhone: readable by the background location task while the phone is
        // locked (the default keychain class is not). Android ignores it.
        SecureStore.setItemAsync(
          key,
          value,
          Platform.OS === 'ios' ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : undefined,
        ),
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
    ]);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
  },
};

let accessToken: string | null = null;

/**
 * Called when the stored session is refused and cleared, so the app can send
 * the driver back to the login screen. Without it he kept a screen full of
 * stale data and every tap failed with no way to sign in again.
 */
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(fn: (() => void) | null) {
  onSessionLost = fn;
}

async function endSession() {
  await clearTokens();
  onSessionLost?.();
}

/**
 * Whether the server could be reached the last time anything was asked (owner,
 * 04.11.2026): the driver's app shows a red bar while it cannot.
 */
let reachable = true;
const netListeners = new Set<(on: boolean) => void>();
export const netState = {
  get: () => reachable,
  subscribe(fn: (on: boolean) => void): () => void {
    netListeners.add(fn);
    return () => netListeners.delete(fn);
  },
};
const markReachable = (on: boolean) => {
  if (on === reachable) return;
  reachable = on;
  netListeners.forEach((l) => l(on));
};
/** fetch, noting whether it got through. */
/** A request that never answers is given up after this long, so nothing waits for ever. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The whole exchange — sending, the answer and its body — within one time
 * limit, with the body read as plain text (owner, 06.11.2026). fetch() read
 * the body through Blob/FileReader, outside its timeout: started by the
 * background location task, the app sat on `refresh:sending` for minutes
 * while the server had answered 200 every time, and a driver opening it then
 * met a white screen. XMLHttpRequest with responseType 'text' needs neither.
 */
/**
 * A photo needs time to go up (audit, 07.11.2026): one 20 s limit for every
 * request made a Monday odometer photo on a weak signal fail every time, and
 * that screen cannot be left. A request carrying a body gets 20 s plus one
 * second for every 16 KB of it (a 3 MB photo: about three minutes), at most
 * four minutes. A plain request keeps the 20 s.
 */
export function timeoutFor(body: unknown): number {
  const bytes = typeof body === 'string' ? body.length : 0;
  return Math.min(REQUEST_TIMEOUT_MS + Math.ceil(bytes / 16_384) * 1000, 240_000);
}

function exchange(url: string, init: RequestInit): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(init.method ?? 'GET', url, true);
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) x.setRequestHeader(k, String(v));
    x.responseType = 'text';
    x.timeout = timeoutFor(init.body);
    x.onload = () => resolve({ status: x.status, text: typeof x.responseText === 'string' ? x.responseText : '' });
    x.onerror = () => reject(new TypeError('Network request failed'));
    x.ontimeout = () => reject(new TypeError('Network request timed out'));
    x.onabort = () => reject(new TypeError('Network request aborted'));
    x.send((init.body as string | undefined) ?? null);
  });
}

async function reach(url: string, init: RequestInit): Promise<Response> {
  try {
    const { status, text } = await exchange(url, init);
    markReachable(true);
    // A body-less answer (204, 304) must not carry one.
    return new Response(text === '' || status === 204 || status === 304 ? null : text, { status });
  } catch (err) {
    markReachable(false);
    throw err;
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(typeof body === 'object' && body !== null && 'message' in body ? String((body as { message: string }).message) : `HTTP ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let res = await reach(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Auto-refresh on 401 (once).
  if (res.status === 401 && accessToken) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await reach(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errorBody);
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

/**
 * One refresh at a time (owner, 06.11.2026): the background location task
 * asks for a session with every fix, and while one refresh waited each new
 * fix started another. Everyone waiting gets the same answer.
 */
/**
 * How a refresh ended (owner, 07.11.2026): the cold start needs to tell a
 * refused session or no token (sign-in screen now) from a slow store or a
 * server away (try again, keep the token).
 */
export type RefreshOutcome = 'ok' | 'refused' | 'no-token' | 'store-slow' | 'failed';

let refreshing: Promise<RefreshOutcome> | null = null;
function refreshShared(): Promise<RefreshOutcome> {
  refreshing ??= refreshOnce().finally(() => (refreshing = null));
  return refreshing;
}
async function tryRefresh(): Promise<boolean> {
  return (await refreshShared()) === 'ok';
}

async function refreshOnce(): Promise<RefreshOutcome> {
  bootMark('refresh:read-token');
  let refreshToken: string | null;
  try {
    refreshToken = await storage.get(REFRESH_KEY);
  } catch {
    // Too slow to read (audit, 07.11.2026): no refresh this time, nothing lost.
    bootMark('refresh:store-slow');
    return 'store-slow';
  }
  bootMark(refreshToken ? 'refresh:token-found' : 'refresh:no-token');
  if (!refreshToken) return 'no-token';

  try {
    bootMark('refresh:sending');
    const res = await reach(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (res.status === 401 || res.status === 403) {
      // The server refused the token: the session is over.
      await endSession();
      return 'refused';
    }
    if (!res.ok) {
      // The server answered but not about the token — a 502 while a deploy
      // restarts it. The session stands; try again later.
      bootMark(`refresh:http-${res.status}`);
      return 'failed';
    }
    const data = (await res.json()) as { access_token: string; refresh_token: string };
    accessToken = data.access_token;
    bootMark('refresh:saving-token');
    await storage.set(REFRESH_KEY, data.refresh_token);
    bootMark('refresh:done');
    return 'ok';
  } catch {
    bootMark('refresh:failed');
    // A dropped connection is not a refused session — keep the token so the
    // driver is still signed in when the network comes back.
    return 'failed';
  }
}

/** Code started with the app closed has no access token in memory: get one. */
let lastFailedRefresh = -Infinity;
export async function ensureSession(now = Date.now()): Promise<void> {
  if (accessToken) return;
  // After a failed try, the next fixes go without asking for a minute: the
  // native service sends the positions itself with its own key meanwhile.
  if (now - lastFailedRefresh < 60_000) return;
  if (!(await tryRefresh())) lastFailedRefresh = now;
}

export async function clearTokens() {
  accessToken = null;
  await storage.remove(REFRESH_KEY);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),

  /** Login stores both tokens and returns the access token. */
  async login(phone_number: string, password: string) {
    const res = await request<{ access_token: string; refresh_token: string }>(
      'POST',
      '/auth/login',
      { phone_number, password },
    );
    accessToken = res.access_token;
    await storage.set(REFRESH_KEY, res.refresh_token);
    return res;
  },

  /** Try to restore the session from a stored refresh token. */
  async restore() {
    return tryRefresh();
  },

  /** The same refresh, saying how it ended (owner, 07.11.2026): for the cold start's restore. */
  restoreOutcome(): Promise<RefreshOutcome> {
    return refreshShared();
  },

  /**
   * Whether a refresh token is still held — a session that may yet be
   * restored. 'unknown' when the store was too slow to say (audit,
   * 07.11.2026): the caller tries again rather than signing him out.
   */
  async sessionState(): Promise<'yes' | 'no' | 'unknown'> {
    try {
      return (await storage.get(REFRESH_KEY)) ? 'yes' : 'no';
    } catch {
      return 'unknown';
    }
  },

  async hasSession() {
    return (await api.sessionState()) !== 'no';
  },

  setAccessToken(token: string) {
    accessToken = token;
  },
};
