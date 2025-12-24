import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { apiLogin, apiMe } from '../../api/client';

const STORAGE_KEY = 'ruts_auth';

type Role = 'manager' | 'admin' | 'teacher' | 'student';

type User = {
  id: string;
  role: Role;
  username: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  photo_data_url?: string | null;
  teacher_subject?: string | null;
  must_change_password?: boolean;
};

type AuthState = {
  accessToken: string | null;
  user: User | null;
};

type AuthContextValue = {
  state: AuthState;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<User>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

// Keep context identity stable across Vite HMR to avoid duplicate module instances
// causing "useAuth must be used inside AuthProvider" at runtime.
const AUTH_CONTEXT_KEY = '__ruts_auth_ctx__';
const AuthContext: React.Context<AuthContextValue | null> =
  ((globalThis as any)[AUTH_CONTEXT_KEY] as React.Context<AuthContextValue | null> | undefined) ??
  createContext<AuthContextValue | null>(null);
(globalThis as any)[AUTH_CONTEXT_KEY] = AuthContext;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const loadSavedState = (): AuthState => {
    // Prefer localStorage (remember-me), fallback to sessionStorage.
    const tryLoad = (store: Storage): AuthState | null => {
      try {
        const saved = store.getItem(STORAGE_KEY);
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        return { accessToken: parsed.accessToken || null, user: parsed.user || null };
      } catch {
        return null;
      }
    };

    return tryLoad(localStorage) ?? tryLoad(sessionStorage) ?? { accessToken: null, user: null };
  };

  const clearSavedState = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const persistState = (nextState: AuthState, rememberMe: boolean) => {
    try {
      if (rememberMe) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        sessionStorage.removeItem(STORAGE_KEY);
      } else {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore storage failures
    }
  };

  const [state, setState] = useState<AuthState>(() => {
    return loadSavedState();
  });

  // Validate token on mount
  useEffect(() => {
    if (state.accessToken) {
      apiMe(state.accessToken)
        .then((me) => setState((prev) => ({ ...prev, user: me.user })))
        .catch((err: any) => {
          // Clear auth only if token is actually invalid.
          // If backend is temporarily down (ERR_CONNECTION_REFUSED), don't log the user out.
          const status = err?.status;
          if (status === 401 || status === 403) {
            clearSavedState();
            setState({ accessToken: null, user: null });
          }
        });
    }
  }, []);

  const login = useCallback(async (username: string, password: string, rememberMe: boolean = false) => {
    const res = await apiLogin(username, password);
    const newState = { accessToken: res.accessToken, user: res.user };
    setState(newState);
    // Keep session alive on reload even when rememberMe=false.
    persistState(newState, rememberMe);
    return res.user as User;
  }, []);

  const logout = useCallback(() => {
    clearSavedState();
    setState({ accessToken: null, user: null });
  }, []);

  const refreshMe = useCallback(async () => {
    if (!state.accessToken) return;
    const me = await apiMe(state.accessToken);
    setState((prev: AuthState) => ({ ...prev, user: me.user }));
  }, [state.accessToken]);

  const value = useMemo<AuthContextValue>(() => {
    return {
      state,
      login,
      logout,
      refreshMe,
    };
  }, [state, login, logout, refreshMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
