import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, getToken, setToken } from '../lib/api.js';

const AuthContext = createContext(null);

/**
 * Holds the signed-in user and exposes login / register / logout.
 * The token lives in localStorage so a refresh keeps you signed in.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Only show the "checking your session" state when there is a token to validate.
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return undefined;

    let cancelled = false;
    (async () => {
      try {
        const { user: me } = await authApi.me();
        if (!cancelled) setUser(me);
      } catch {
        // Expired or invalid token — drop it and treat the visitor as anonymous.
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await authApi.register(payload);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, isAdmin: user?.role === 'admin' }),
    [user, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }
  return ctx;
}
