import { stopBackgroundLocation } from '../lib/backgroundLocation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { UserPublic } from '@bigant/shared';
import { api, ApiError, clearTokens, setSessionLostHandler } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { pushToken } from '../lib/pushToken';
import { bootMark } from '../lib/bootTrace';
import { gpsGuard } from '../lib/gpsGuard';
import { clearQueue, deliver } from '../lib/locationQueue';
import { RESTORE_CAP_MS, restoreSession, withCap } from './restoreSession';

/** How long signing out waits for kept positions to go. */
const LOGOUT_FLUSH_MS = 5_000;

interface AuthState {
  user: UserPublic | null;
  ready: boolean;
  /** A saved session not yet confirmed (no internet, server slow): not signed out. */
  reconnecting: boolean;
  retryNow: () => void;
  /** Leave the saved session and show the login screen. */
  useOtherAccount: () => void;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState>({
  user: null,
  ready: false,
  reconnecting: false,
  retryNow: () => {},
  useOtherAccount: () => {},
  login: async () => {},
  logout: () => {},
});

/**
 * Which sign-in this is (06.11.2026). Signing out finishes its work in the
 * background (the push token, the services); if he signs in again meanwhile,
 * that late work must not wipe the new session's tokens or stop its shift.
 */
let generation = 0;

/** Waits between tries of /auth/me at a cold start: about half a minute in all. */
const ME_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 8_000];

/** A failure worth another try: no network, a timeout, or the server itself failing. */
const transient = (err: unknown) =>
  !(err instanceof ApiError) || err.status >= 500 || err.status === 408 || err.status === 429;

/**
 * The signed-in user, right after a refresh that worked (audit, 07.11.2026).
 * One /auth/me lost to a weak signal or a deploy's 502 used to drop him on the
 * login screen with a good session. Now only a 401 signs him out; a timeout,
 * no network or a 5xx is tried again with growing waits. Null when it never
 * came — the tokens are kept, so the next start restores him.
 */
async function loadMe(stillWanted: () => boolean = () => true): Promise<UserPublic | null> {
  for (let attempt = 0; ; attempt++) {
    // Signed in or out by hand meanwhile (owner, 07.11.2026): this restore is no longer wanted.
    if (!stillWanted()) return null;
    try {
      bootMark('auth:me');
      const me = await api.get<UserPublic>('/auth/me');
      bootMark('auth:me-ok');
      return me;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        if (stillWanted()) await clearTokens();
        return null;
      }
      if (!transient(err) || attempt >= ME_BACKOFF_MS.length) return null;
      bootMark(`auth:me-retry-${attempt + 1}`);
      await new Promise((r) => setTimeout(r, ME_BACKOFF_MS[attempt]));
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [ready, setReady] = useState(false);
  // A saved session is never dropped for a slow start or a missing signal
  // (owner, 09.11.2026): the driver was sent to the login screen after an
  // update and had to type his number and password again. Until the server
  // says the session is gone (401) or there is none, the app keeps trying.
  const [reconnecting, setReconnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // One restore at a time: a new try waits until the last has ended.
  const restoring = useRef(false);

  /** Nothing from the old session may be read by the next one. */
  const forget = useCallback(() => {
    // The red GPS/internet screen is for a driver at work, not a signed-out phone.
    gpsGuard.setRequired(null);
    gpsGuard.setGpsOnly(null);
    setUser(null);
    queryClient.clear();
  }, []);

  // A refused refresh token used to leave the app sitting on a dead session:
  // the driver saw his old orders and every tap failed. Now it takes him back
  // to the login screen.
  useEffect(() => {
    setSessionLostHandler(forget);
    return () => setSessionLostHandler(null);
  }, [forget]);

  // Try restoring session from secure-store refresh token on mount.
  useEffect(() => {
    if (restoring.current) return;
    restoring.current = true;
    (async () => {
      // The spinner waits at most RESTORE_CAP_MS (owner, 07.11.2026). A 401 or
      // no token shows the login screen at once; a slow store or a server away
      // is tried again in the background after the cap, with the tokens kept,
      // and lets him in if it gets through before he signs in by hand.
      const mine = generation;
      const stillWanted = () => generation === mine;
      try {
        bootMark('auth:begin');
        const work = restoreSession({
          refresh: () => api.restoreOutcome(),
          sessionState: () => api.sessionState(),
          loadMe: () => loadMe(stillWanted),
          wait: (ms) => new Promise((r) => setTimeout(r, ms)),
          stillWanted,
          mark: bootMark,
        });
        const first = await withCap(work, RESTORE_CAP_MS);
        const settle = async (me: UserPublic | null) => {
          if (!stillWanted()) return;
          if (me) {
            setUser(me);
            setReconnecting(false);
            return;
          }
          // Not let in: signed out only when there is no session or it was refused.
          const state = await api.sessionState().catch(() => 'unknown' as const);
          if (stillWanted()) setReconnecting(state !== 'no');
        };
        if (first.settled) {
          await settle(first.value ?? null);
        } else {
          bootMark('auth:capped');
          setReconnecting(true);
          // The "connecting" screen shows now; this try runs on behind it.
          setReady(true);
          await work.then(settle).catch(() => undefined);
        }
      } catch {
        // Whatever failed, the app must come up: the login screen, not a spinner for ever.
      } finally {
        bootMark('auth:done');
        restoring.current = false;
        setReady(true);
      }
    })();
  }, [attempt]);

  // While reconnecting, try again every 5 s (owner, 09.11.2026), and at once when asked.
  useEffect(() => {
    if (!reconnecting || user) return;
    const id = setInterval(() => setAttempt((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, [reconnecting, user]);
  const retryNow = useCallback(() => setAttempt((n) => n + 1), []);
  const useOtherAccount = useCallback(() => {
    generation++;
    setReconnecting(false);
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    generation++;
    await api.login(phone, password);
    const me = await api.get<UserPublic>('/auth/me');
    setReconnecting(false);
    setUser(me);
    // The number is kept for the next sign-in (owner, 09.11.2026); never the password.
    void rememberPhone(phone);
  }, []);

  const logout = useCallback(() => {
    const mine = ++generation;
    void (async () => {
      // Take this phone off the account first — afterwards the token is gone
      // and the call would be refused. A failure here must not trap him in.
      const token = pushToken.get();
      if (token) {
        try {
          await api.del(`/notifications/push-token/${encodeURIComponent(token)}`);
        } catch {
          // Signing out matters more than the registration.
        }
        pushToken.set(null);
      }
      if (mine !== generation) return; // signed in again meanwhile: leave that session alone
      await stopBackgroundLocation();
      // Positions kept without internet go first, while this session's token
      // and key still work — at most a few seconds, signing out must not hang
      // on a bad signal. Whatever is still kept is then deleted: the next
      // account on this phone must never send this driver's points (audit, 07.11.2026).
      await Promise.race([
        Promise.all([gpsGuard.flushTracking(), deliver([]).catch(() => undefined)]),
        new Promise((r) => setTimeout(r, LOGOUT_FLUSH_MS)),
      ]);
      await clearQueue();
      if (mine !== generation) return;
      gpsGuard.forgetTracking();
      if (mine !== generation) return;
      await clearTokens();
    })();
    forget();
  }, [forget]);

  return (
    <Ctx.Provider value={{ user, ready, reconnecting, retryNow, useOtherAccount, login, logout }}>{children}</Ctx.Provider>
  );
}

const LAST_PHONE_KEY = 'bigant.lastPhone';

/** The last number signed in with, to fill the login form. */
export async function rememberPhone(phone: string): Promise<void> {
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(LAST_PHONE_KEY, phone);
  } catch {
    // A convenience only.
  }
}

export async function lastPhone(): Promise<string | null> {
  try {
    const SecureStore = await import('expo-secure-store');
    return await SecureStore.getItemAsync(LAST_PHONE_KEY);
  } catch {
    return null;
  }
}

export function useAuth() {
  return useContext(Ctx);
}
