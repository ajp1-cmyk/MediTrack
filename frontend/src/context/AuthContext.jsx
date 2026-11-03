import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { adminApi, authApi, setToken } from '../lib/api.js';

const AuthContext = createContext(null);
const AUTH_CHANNEL = 'meditrack-auth';

/**
 * Holds the signed-in user and exposes login / register / logout.
 *
 * The access token is kept in memory by lib/api.js (never localStorage). On a
 * page load the httpOnly refresh cookie silently restores the session, and
 * lib/api.js replays any request whose 15-minute access token expired.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Always true on first render: we cannot read the httpOnly cookie from JS, so
  // we try a silent refresh and resolve loading once it answers.
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const channelRef = useRef(null);

  // Restore the session from the refresh cookie on page load.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await authApi.refresh();
        if (!cancelled && data && data.user) {
          setUser(data.user);
        }
      } catch {
        // No cookie / expired session → stay anonymous.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // lib/api.js fires this when a request 401s and the refresh attempt failed.
  useEffect(() => {
    const handleExpired = () => {
      setToken(null);
      setUser(null);
      setSessionExpired(true);
    };

    window.addEventListener('meditrack:session-expired', handleExpired);
    return () => window.removeEventListener('meditrack:session-expired', handleExpired);
  }, []);

  // Sign out of the other tabs as soon as one tab logs out.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;

    const channel = new BroadcastChannel(AUTH_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data === 'logout') {
        setToken(null);
        setUser(null);
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  /**
   * Store a freshly issued MediTrack session. Every sign-in path (password,
   * registration, emailed code, staff/admin, invite) ends here, so they share one
   * place to reset the session state.
   */
  const applySession = useCallback((data) => {
    setToken(data.token);
    setUser(data.user);
    setSessionExpired(false);
    return data.user;
  }, []);

  const login = useCallback(
    async (email, password) => applySession(await authApi.login(email, password)),
    [applySession]
  );

  const register = useCallback(
    async (payload) => applySession(await authApi.register(payload)),
    [applySession]
  );

  /**
   * Ask the API to email a one-time code. Resolves with the server's reply
   * (`expiresAt`, `resendAfterSeconds`, and `devCode` when the API is running with
   * OTP_EXPOSE_CODE=true) so the sign-in page can show a countdown.
   */
  const requestOtp = useCallback((email) => authApi.requestOtp(email), []);

  /**
   * Trade the emailed code for the normal MediTrack session. The API creates a
   * `customer` account when the address is new, so this signs up and signs in.
   */
  const verifyOtp = useCallback(
    async (payload) => applySession(await authApi.verifyOtp(payload)),
    [applySession]
  );

  /** Staff/admin sign-in from /admin/login. */
  const loginAdmin = useCallback(
    async (email, password) => applySession(await adminApi.login(email, password)),
    [applySession]
  );

  /** Redeem an invite link from /admin/register. */
  const acceptAdminInvite = useCallback(
    async (payload) => applySession(await adminApi.acceptInvite(payload)),
    [applySession]
  );

  const logout = useCallback(async () => {
    try {
      // Revokes this browser's refresh session server-side.
      await authApi.logout();
    } catch {
      // Offline / already expired: still clear the local state.
    }

    setToken(null);
    setUser(null);
    setSessionExpired(false);
    // Sign the other tabs out as well.
    if (channelRef.current) channelRef.current.postMessage('logout');
  }, []);

  const clearSessionExpired = useCallback(() => setSessionExpired(false), []);

  const can = useCallback(
    (permission) => Boolean(user?.permissions?.includes(permission)),
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      sessionExpired,
      clearSessionExpired,
      login,
      loginAdmin,
      requestOtp,
      verifyOtp,
      register,
      acceptAdminInvite,
      logout,
      can,
      isAdmin: user?.role === 'admin',
      isStaff: user?.role === 'staff',
      isBackOffice: user?.role === 'admin' || user?.role === 'staff',
    }),
    [
      user,
      loading,
      sessionExpired,
      clearSessionExpired,
      login,
      loginAdmin,
      requestOtp,
      verifyOtp,
      register,
      acceptAdminInvite,
      logout,
      can,
    ]
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

