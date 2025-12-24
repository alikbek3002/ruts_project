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
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
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
  const [state, setState] = useState<AuthState>(() => {
    // Load from localStorage on initial render
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { accessToken: parsed.accessToken || null, user: parsed.user || null };
      }
    } catch (e) {
      // Ignore parse errors
    }
    return { accessToken: null, user: null };
  });

  // Validate token on mount
  useEffect(() => {
    if (state.accessToken) {
      apiMe(state.accessToken)
        .then((me) => setState((prev) => ({ ...prev, user: me.user })))
        .catch(() => {
          // Token invalid, clear state
          localStorage.removeItem(STORAGE_KEY);
          setState({ accessToken: null, user: null });
        });
    }
  }, []);

  const login = useCallback(async (username: string, password: string, rememberMe: boolean = false) => {
    const res = await apiLogin(username, password);
    const newState = { accessToken: res.accessToken, user: res.user };
    setState(newState);
    if (rememberMe) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
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
