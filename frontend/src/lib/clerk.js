// Clerk configuration (optional identity provider).
//
// Without `VITE_CLERK_PUBLISHABLE_KEY` the storefront keeps the MediTrack email +
// password form as its only sign-in method: <ClerkProvider> is never mounted and
// the "Continue with Clerk" option is hidden, so the app works exactly as before.
//
// The matching server-side variable is CLERK_SECRET_KEY (backend/.env or the
// Netlify environment); it is what verifies the session token.
export const CLERK_PUBLISHABLE_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();

export const clerkEnabled = Boolean(CLERK_PUBLISHABLE_KEY);
