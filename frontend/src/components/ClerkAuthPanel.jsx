import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SignIn, useAuth as useClerkAuth } from '@clerk/clerk-react';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Clerk's prebuilt sign-in UI plus the exchange that turns a Clerk session into a
 * MediTrack session.
 *
 * Clerk authenticates the person; the API (`POST /api/auth/clerk`) verifies the
 * session token and returns the usual MediTrack token + refresh cookie, so the
 * rest of the app (cart, orders, prescriptions, roles) is unchanged.
 *
 * Only rendered when VITE_CLERK_PUBLISHABLE_KEY is configured — see lib/clerk.js.
 */
export default function ClerkAuthPanel() {
  const { isSignedIn, getToken } = useClerkAuth();
  const { loginWithClerk } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from || '/';

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Guards against exchanging the same Clerk session twice (StrictMode mounts
  // the effect twice in development).
  const exchangedToken = useRef(null);

  useEffect(() => {
    if (!isSignedIn) {
      exchangedToken.current = null;
      return undefined;
    }

    let cancelled = false;

    (async () => {
      setBusy(true);
      setError('');
      try {
        const clerkToken = await getToken();
        if (!clerkToken) {
          throw new Error('Clerk did not return a session token. Please try again.');
        }
        if (exchangedToken.current === clerkToken) return;
        await loginWithClerk(clerkToken);
        exchangedToken.current = clerkToken;
        if (!cancelled) navigate(redirectTo, { replace: true });
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, getToken, loginWithClerk, navigate, redirectTo]);

  return (
    <div className="clerk-panel">
      <SignIn routing="hash" />
      {busy && (
        <p className="muted" role="status">
          Signing you in…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
