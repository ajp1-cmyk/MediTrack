// Brute-force protection for the public authentication endpoints.
//
// Two layers, following the usual e-commerce pattern:
//
//   • registerLimiter — per IP, stops scripted account creation and repeated
//     guesses at the administrator invite code.
//   • loginLimiter    — per IP *and* email, and only failed attempts count, so
//     a legitimate customer is never blocked by their own successful sign-ins
//     while an attacker cannot try thousands of passwords against one account.
//
// Limits are environment-configurable so deployments (and the test suite) can
// tune them without code changes. Defaults: 15-minute window, 10 failed
// sign-ins per IP+email, 30 account requests per IP.
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function positiveInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const WINDOW_MS = positiveInteger(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const LOGIN_MAX = positiveInteger(process.env.AUTH_LOGIN_RATE_LIMIT_MAX, 10);
const REGISTER_MAX = positiveInteger(process.env.AUTH_REGISTER_RATE_LIMIT_MAX, 30);

const LOGIN_MESSAGE =
  'Too many sign-in attempts. Please wait a few minutes and try again.';
const REGISTER_MESSAGE =
  'Too many account requests from this address. Please try again later.';

/** Build a JSON-returning limiter (the SPA expects `{ error }` bodies). */
function jsonLimiter({ limit, keyGenerator, skipSuccessfulRequests = false, message }) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator,
    handler: (_req, res) => res.status(429).json({ error: message }),
  });
}

/**
 * Normalise IPv4/IPv6 addresses so `::1`, `127.0.0.1` and IPv6 subnets
 * collapse into the same bucket. `ipKeyGenerator` is the helper
 * express-rate-limit recommends for custom key generators.
 */
function ipKey(req) {
  return ipKeyGenerator(req.ip);
}

/** Key used by the sign-in limiter: one bucket per IP + email pair. */
function loginKey(req) {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  return `${ipKey(req)}:${email}`;
}

const loginLimiter = jsonLimiter({
  limit: LOGIN_MAX,
  keyGenerator: loginKey,
  // Successful sign-ins are removed from the counter immediately.
  skipSuccessfulRequests: true,
  message: LOGIN_MESSAGE,
});

const registerLimiter = jsonLimiter({
  limit: REGISTER_MAX,
  keyGenerator: ipKey,
  message: REGISTER_MESSAGE,
});

module.exports = {
  loginLimiter,
  registerLimiter,
  loginKey,
  WINDOW_MS,
  LOGIN_MAX,
  REGISTER_MAX,
};
