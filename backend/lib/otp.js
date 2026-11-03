// Issuing and checking emailed one-time sign-in codes.
//
//   • 6 digits, generated with `crypto.randomInt` (not `Math.random`).
//   • stored as an HMAC of `<email>:<code>`, never in clear text.
//   • single-use, expires after OTP_TTL_MINUTES and dies after OTP_MAX_ATTEMPTS
//     wrong guesses.
//   • a short cooldown between requests for the same address
//     (OTP_RESEND_COOLDOWN_SECONDS) so the endpoint cannot be used as an email
//     cannon, on top of the per-IP rate limit in middleware/rateLimit.js.
//
// Together with the cookie-based session this gives the storefront a sign-in
// method that needs no password and no third-party provider.
const crypto = require('crypto');
const OtpCode = require('../models/OtpCode');
const { httpError } = require('./errors');

function positiveInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

const CODE_DIGITS = 6;
const TTL_MINUTES = positiveInteger(process.env.OTP_TTL_MINUTES, 10);
const RESEND_COOLDOWN_SECONDS = nonNegativeInteger(process.env.OTP_RESEND_COOLDOWN_SECONDS, 30);
const MAX_ATTEMPTS = positiveInteger(process.env.OTP_MAX_ATTEMPTS, 5);

/** Key for the code HMAC. A dedicated OTP_SECRET is preferred; JWT_SECRET works too. */
function secret() {
  return process.env.OTP_SECRET || process.env.JWT_SECRET || '';
}

/** Lowercase, trimmed address — the form stored on `users.email`. */
function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

/** A zero-padded 6-digit code from a cryptographically secure source. */
function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

function hashCode(email, code) {
  return crypto.createHmac('sha256', secret()).update(`${email}:${code}`).digest('hex');
}

/** Constant-time comparison of two hex digests (length-checked first). */
function hashMatches(expected, actual) {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(actual || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

/** Public configuration (the SPA shows it; tests read it). */
function config() {
  return {
    ttlMinutes: TTL_MINUTES,
    resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
    maxAttempts: MAX_ATTEMPTS,
    // Local-development convenience: when OTP_EXPOSE_CODE=true the code is also
    // returned by the API so it can be typed without reading the server log.
    // Refused in production, where the code must only travel by email.
    exposeCode: process.env.OTP_EXPOSE_CODE === 'true' && process.env.NODE_ENV !== 'production',
  };
}


/**
 * Create a fresh code for `email`, replacing any live one so only the newest
 * code can be used.
 *
 * @returns {Promise<{ code: string, expiresAt: Date }>} the clear-text code — it
 *          is handed to the mailer and never persisted.
 */
async function issueCode(email, req) {
  const address = normalizeEmail(email);
  const now = new Date();

  const pending = await OtpCode.findOne({
    email: address,
    consumed_at: null,
    expires_at: { $gt: now },
  }).sort({ created_at: -1 });

  if (pending) {
    const waitedSeconds = Math.floor(
      (now.getTime() - new Date(pending.created_at).getTime()) / 1000
    );
    const waitFor = RESEND_COOLDOWN_SECONDS - waitedSeconds;
    if (waitFor > 0) {
      const err = httpError(
        429,
        `A code was just sent. Please wait ${waitFor} second(s) before asking for another one.`
      );
      err.retryAfterSeconds = waitFor;
      throw err;
    }
    // Only one code may be live at a time: an attacker cannot keep several
    // guesses in play at once.
    await OtpCode.deleteOne({ _id: pending._id });
  }

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + TTL_MINUTES * 60 * 1000);

  await OtpCode.create({
    email: address,
    codeHash: hashCode(address, code),
    expires_at: expiresAt,
    request_ip: String((req && req.ip) || '').slice(0, 64),
  });

  return { code, expiresAt };
}

/**
 * Check a code and burn it.
 *
 * Throws 401 for an unknown / expired / wrong code (with the remaining attempts
 * in the message) and 429 once the guess limit is reached, so the caller only
 * has to translate "no error" into "signed in".
 *
 * @returns {Promise<object>} the consumed OtpCode document.
 */
async function consumeCode(email, code) {
  const address = normalizeEmail(email);
  const now = new Date();

  const record = await OtpCode.findOne({
    email: address,
    consumed_at: null,
    expires_at: { $gt: now },
  })
    .sort({ created_at: -1 })
    .select('+codeHash');

  if (!record) {
    throw httpError(401, 'That code is no longer valid. Please request a new one.');
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await OtpCode.deleteOne({ _id: record._id });
    throw httpError(429, 'Too many incorrect codes. Please request a new one.');
  }

  if (!hashMatches(record.codeHash, hashCode(address, code))) {
    // Counted atomically so parallel guesses cannot slip past the limit.
    await OtpCode.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    const left = Math.max(0, MAX_ATTEMPTS - (record.attempts + 1));
    throw httpError(
      401,
      left > 0
        ? `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} left.`
        : 'Too many incorrect codes. Please request a new one.'
    );
  }

  // Atomic single use: the first caller to flip `consumed_at` wins; a replay (or
  // a double-submitted form) finds the code gone.
  const consumed = await OtpCode.findOneAndUpdate(
    { _id: record._id, consumed_at: null },
    { $set: { consumed_at: now } },
    { new: true }
  );

  if (!consumed) {
    throw httpError(401, 'That code has already been used. Please request a new one.');
  }

  return consumed;
}

/** Remove every live code for an address (used when delivery failed). */
async function discardCodes(email) {
  return OtpCode.deleteMany({ email: normalizeEmail(email), consumed_at: null });
}

module.exports = {
  CODE_DIGITS,
  config,
  normalizeEmail,
  generateCode,
  hashCode,
  issueCode,
  consumeCode,
  discardCodes,
};
