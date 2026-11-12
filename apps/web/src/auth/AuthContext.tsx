import { queryClient } from '../lib/queryClient';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UserPublic } from '@bigant/shared';
import { api, clearTokens, getRefreshToken, storeTokens } from '../lib/api';

interface AuthState {
  user: UserPublic | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/** Drivers work in the mobile app; the console has nothing for them. */
export class DriverNotAllowedError extends Error {
  constructor() {
    super('driver_not_allowed');
    this.name = 'DriverNotAllowedError';
  }
}

const isConsoleUser = (u: UserPublic) => u.role !== 'driver';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (getRefreshToken()) {
        // No access token in memory yet → /auth/me 401s → client refreshes → retries.
        // A page opened while the server is restarting gets a 502, not a
        // verdict on the session: try again for a while before giving up,
        // and only a refused token (401) ends the session.
        for (let attempt = 0; active && attempt < 20; attempt++) {
          try {
            const me = await api.get<UserPublic>('/auth/me');
            if (!isConsoleUser(me)) {
              clearTokens();
            } else if (active) {
              setUser(me);
            }
            break;
          } catch {
            // A 401 here can be the server away mid-refresh (a deploy): the
            // refresh itself clears the token only when the server refuses it,
            // so the session ends exactly then and not on a network hiccup (06.11.2026).
            if (!getRefreshToken()) break;
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    storeTokens(await api.login(phone, password));
    const me = await api.get<UserPublic>('/auth/me');
    if (!isConsoleUser(me)) {
      clearTokens();
      throw new DriverNotAllowedError();
    }
    setUser(me);
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    // The next person on this computer must not see the last one's orders (06.11.2026).
    queryClient.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
