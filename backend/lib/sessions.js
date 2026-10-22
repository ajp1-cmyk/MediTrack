// Refresh-token sessions.
//
//   • The browser keeps an opaque 32-byte token in a signed, httpOnly cookie
//     scoped to /api/auth. JavaScript (and therefore XSS) cannot read it.
//   • MongoDB stores only the SHA-256 hash, so a database leak cannot be
//     replayed against the API.
//   • Every refresh rotates the token. Presenting an already-rotated token is
//     treated as theft: all sessions for the user are revoked and
//     `tokenVersion` is bumped so outstanding access tokens die immediately.
const crypto = require('crypto');
const Session = require('../models/Session');
const User = require('../models/User');

const COOKIE_NAME = 'mt_refresh';
const COOKIE_PATH = '/api/auth';

function positiveInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

const REFRESH_TOKEN_TTL_DAYS = positiveInteger(process.env.REFRESH_TOKEN_TTL_DAYS, 30);
const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
// Two tabs can race on the same cookie. A token presented again within this
// window is treated as that race (409 + retry), not as theft.
const REFRESH_REUSE_GRACE_MS = nonNegativeInteger(
  process.env.REFRESH_REUSE_GRACE_MS,
  10 * 1000
);

/** Random token placed in the cookie (the raw value is never stored). */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Hash used for the `tokenHash` database field. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cookieOptions(expiresAt) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    // Only sent over HTTPS in production; plain HTTP is needed for local dev.
    secure: process.env.NODE_ENV === 'production',
    signed: true,
    path: COOKIE_PATH,
  };
  if (expiresAt) options.expires = expiresAt;
  return options;
}

/** Read the (already signature-verified) refresh token from the request. */
function readRefreshToken(req) {
  const token = req.signedCookies ? req.signedCookies[COOKIE_NAME] : null;
  return typeof token === 'string' && token ? token : null;
}

function setRefreshCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, cookieOptions(expiresAt));
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: COOKIE_PATH,
  });
}

/** Create a session for a user and return the raw token to put in the cookie. */
async function createSession(user, req) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const session = await Session.create({
    user: user._id,
    tokenHash: hashToken(token),
    userAgent: String(req.get('user-agent') || '').slice(0, 300),
    ip: String(req.ip || '').slice(0, 64),
    lastUsedAt: new Date(),
    expiresAt,
  });

  return { session, token, expiresAt };
}

async function revokeSession(session, reason) {
  session.revokedAt = new Date();
  session.revokedReason = reason;
  await session.save();
  return session;
}

/** Revoke the session belonging to a raw refresh token (idempotent). */
async function revokeSessionByToken(token, reason = 'logout') {
  if (!token) return null;
  const session = await Session.findOne({
    tokenHash: hashToken(token),
    revokedAt: null,
  });
  if (!session) return null;
  return revokeSession(session, reason);
}

/** Revoke every active session for a user. */
async function revokeAllSessions(userId, reason = 'revoked') {
  return Session.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );
}

/** Invalidate every access token issued before this point. */
async function bumpTokenVersion(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}

/**
 * Validate and rotate a refresh token.
 * @returns {{ user: object, session: object, token: string, expiresAt: Date }
 *          | { error: 'missing'|'invalid'|'expired'|'revoked' }}
 */
async function rotateSession(token, req) {
  if (!token) return { error: 'missing' };

  const session = await Session.findOne({ tokenHash: hashToken(token) }).populate('user');
  if (!session) return { error: 'invalid' };

  if (session.revokedAt) {
    // Two tabs sharing one cookie jar can legitimately refresh at the same
    // time: the loser sees a just-rotated token within the grace window. Tell
    // it to retry (the shared cookie has been updated by then) instead of
    // treating a race as theft.
    const rotatedRecently =
      session.revokedReason === 'rotated' &&
      Date.now() - new Date(session.revokedAt).getTime() < REFRESH_REUSE_GRACE_MS;
    if (rotatedRecently) return { error: 'race' };

    // Reuse after the grace window = the cookie was copied. Kill everything.
    if (session.revokedReason === 'rotated' && session.user) {
      await revokeAllSessions(session.user._id, 'token_reuse');
      await bumpTokenVersion(session.user._id);
    }
    return { error: 'revoked' };
  }

  if (session.expiresAt <= new Date()) {
    await revokeSession(session, 'expired');
    return { error: 'expired' };
  }

  const user = session.user;
  if (!user) {
    await revokeSession(session, 'user_missing');
    return { error: 'invalid' };
  }

  const next = await createSession(user, req);

  session.revokedAt = new Date();
  session.revokedReason = 'rotated';
  session.replacedBy = next.session._id;
  await session.save();

  return { user, ...next };
}

/** Active sessions for the account, with the current one flagged. */
async function listSessions(userId, currentToken) {
  const currentHash = currentToken ? hashToken(currentToken) : null;
  const sessions = await Session.find({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .select('+tokenHash')
    .sort({ lastUsedAt: -1 });

  return sessions.map((session) => ({
    id: session._id.toString(),
    userAgent: session.userAgent,
    ip: session.ip,
    createdAt: session.created_at,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    current: Boolean(currentHash && session.tokenHash === currentHash),
  }));
}

/**
 * Revoke one of the caller's sessions.
 * @returns {Promise<{ session: object, isCurrent: boolean } | null>}
 */
async function revokeSessionById(userId, sessionId, currentToken) {
  const session = await Session.findOne({
    _id: sessionId,
    user: userId,
    revokedAt: null,
  }).select('+tokenHash');

  if (!session) return null;

  const isCurrent = Boolean(currentToken && hashToken(currentToken) === session.tokenHash);
  await revokeSession(session, 'revoked_by_user');
  return { session, isCurrent };
}

module.exports = {
  COOKIE_NAME,
  COOKIE_PATH,
  REFRESH_TOKEN_TTL_DAYS,
  REFRESH_TOKEN_TTL_MS,
  REFRESH_REUSE_GRACE_MS,
  generateToken,
  hashToken,
  readRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  createSession,
  revokeSession,
  revokeSessionByToken,
  revokeAllSessions,
  bumpTokenVersion,
  rotateSession,
  listSessions,
  revokeSessionById,
};

