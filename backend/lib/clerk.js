// Clerk identity provider (optional).
//
// MediTrack keeps its own session (a short-lived JWT plus the httpOnly refresh
// cookie), roles and permissions. Clerk is used only to authenticate the person:
//
//   1. the browser signs in with Clerk's prebuilt UI and gets a Clerk session JWT
//   2. the SPA posts that JWT to `POST /api/auth/clerk`
//   3. this module verifies the signature with `CLERK_SECRET_KEY` and reads the
//      verified profile from Clerk's Backend API
//   4. `routes/auth.js` maps that identity to a local `users` row and issues the
//      usual MediTrack session
//
// Nothing here is required for the password login: when `CLERK_SECRET_KEY` is
// unset the endpoint answers 503 and the SPA hides the Clerk option.
const { httpError } = require('./errors');

const CLERK_SECRET_KEY = () => process.env.CLERK_SECRET_KEY || '';
// Comma-separated origins that may present a Clerk token (Clerk's `azp` claim).
// Leave empty to accept tokens from every origin of this Clerk instance.
const AUTHORIZED_PARTIES = () =>
  String(process.env.CLERK_AUTHORIZED_PARTIES || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

/** True when the server has a Clerk secret key and can verify sign-ins. */
function configured() {
  return Boolean(CLERK_SECRET_KEY());
}

/** The Clerk SDK (CJS build). Required lazily so local/test runs never load it. */
function sdk() {
  // eslint-disable-next-line global-require
  return require('@clerk/backend');
}

/** Turn a Clerk user object into the fields MediTrack stores. */
function identityFromProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw httpError(401, 'Clerk did not return a user profile');
  }

  const emails = Array.isArray(profile.emailAddresses) ? profile.emailAddresses : [];
  const primary =
    emails.find((entry) => entry.id === profile.primaryEmailAddressId) || emails[0];

  if (!primary || !primary.emailAddress) {
    throw httpError(400, 'Your Clerk account has no email address');
  }

  // Linking an existing MediTrack account by email is only safe when Clerk has
  // verified that address — otherwise anyone could claim someone else's account.
  if (primary.verification?.status !== 'verified') {
    throw httpError(
      403,
      'Please verify your email address in Clerk before signing in this way.'
    );
  }

  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  const fallbackName = profile.username || primary.emailAddress.split('@')[0];

  return {
    clerkUserId: String(profile.id || '').trim(),
    email: primary.emailAddress.trim().toLowerCase(),
    name: (name || fallbackName || 'Customer').slice(0, 80),
  };
}

/**
 * Verify a Clerk session token and load the signed-in profile.
 *
 * @param {string} sessionToken raw Clerk session JWT from `useAuth().getToken()`
 * @returns {Promise<{clerkUserId: string, email: string, name: string}>}
 */
async function resolveClerkIdentity(sessionToken) {
  if (!configured()) {
    throw httpError(503, 'Clerk sign-in is not configured on this server.');
  }

  const { verifyToken, createClerkClient } = sdk();
  const secretKey = CLERK_SECRET_KEY();
  const authorizedParties = AUTHORIZED_PARTIES();

  let claims;
  try {
    claims = await verifyToken(sessionToken, {
      secretKey,
      ...(authorizedParties.length > 0 ? { authorizedParties } : {}),
    });
  } catch {
    // Expired, tampered or issued by another Clerk instance.
    throw httpError(401, 'Your Clerk session could not be verified. Please sign in again.');
  }

  if (!claims || !claims.sub) {
    throw httpError(401, 'Your Clerk session could not be verified. Please sign in again.');
  }

  let profile;
  try {
    const client = createClerkClient({ secretKey });
    profile = await client.users.getUser(claims.sub);
  } catch {
    throw httpError(502, 'Could not load your Clerk profile. Please try again.');
  }

  return identityFromProfile(profile);
}

module.exports = {
  configured,
  identityFromProfile,
  resolveClerkIdentity,
};
