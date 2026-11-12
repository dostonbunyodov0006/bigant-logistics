import type { AuthTokens } from '@bigant/shared';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const REFRESH_KEY = 'bigant.refresh';

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
/** Current in-memory access token (for the SSE `?token=` query param). */
export function getAccessToken(): string | null {
  return accessToken;
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setRefreshToken(token: string | null): void {
  if (token) {
    localStorage.setItem(REFRESH_KEY, token);
  } else {
    localStorage.removeItem(REFRESH_KEY);
  }
}
export function storeTokens(tokens: AuthTokens): void {
  setAccessToken(tokens.access_token);
  setRefreshToken(tokens.refresh_token);
}
export function clearTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return false;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    // No answer at all (a deploy restart, a dropped connection): the session
    // is not over, the server is away. Keep the token for the next try.
    return false;
  }
  // Only the server saying "this token is no good" ends the session. A 502
  // from the thirty seconds a deploy takes is not that, and clearing the
  // token on it sent every seller back to the login page at each release.
  if (res.status === 401 || res.status === 403) {
    clearTokens();
    return false;
  }
  if (!res.ok) {
    return false;
  }
  storeTokens((await res.json()) as AuthTokens);
  return true;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true, extraHeaders: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && (await tryRefresh())) {
    return request<T>(method, path, body, false);
  }

  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }
    const message =
      (parsed as { message?: string } | undefined)?.message ?? res.statusText ?? 'Request failed';
    throw new ApiError(res.status, message, parsed);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  // A success with an empty body (a delete that returns nothing) is still a
  // success; reading it as JSON threw and showed the user a parser's error.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  // The header tells the server this is the console: drivers are refused there.
  login: (phone: string, password: string) =>
    request<AuthTokens>('POST', '/auth/login', { phone_number: phone, password }, true, { 'x-bigant-client': 'web' }),
};
