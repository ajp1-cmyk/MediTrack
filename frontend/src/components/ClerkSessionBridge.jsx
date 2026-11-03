import { useEffect } from 'react';
import { useClerk } from '@clerk/clerk-react';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Keeps Clerk's own session in sync with MediTrack's "Log out".
 *
 * Without this, signing out of MediTrack would leave the Clerk session alive and
 * the login page would immediately sign the user back in. Rendered only when
 * Clerk is configured (inside <ClerkProvider> and <AuthProvider>).
 */
export default function ClerkSessionBridge() {
  const { signOut } = useClerk();
  const { registerExternalSignOut } = useAuth();

  useEffect(() => {
    registerExternalSignOut(() => signOut({ redirectUrl: '/' }));
    return () => registerExternalSignOut(null);
  }, [signOut, registerExternalSignOut]);

  return null;
}
