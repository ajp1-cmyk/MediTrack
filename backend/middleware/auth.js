// JWT authentication / role authorisation middleware.
//
// Clients send:  Authorization: Bearer <token>
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { roleHasPermission } = require('../lib/permissions');
const { httpError } = require('../lib/errors');

// Development fallback so `npm run dev` works before a .env file exists.
// Always set JWT_SECRET outside of local development.
const DEV_SECRET = 'meditrack-insecure-dev-secret-change-me';
const getSecret = () => process.env.JWT_SECRET || DEV_SECRET;
// Access tokens are deliberately short-lived: the SPA refreshes them silently
// with the httpOnly refresh cookie. `JWT_EXPIRES_IN` is deprecated/ignored.
const getExpiry = () => process.env.JWT_ACCESS_TTL || '15m';

/** Create a signed JWT for a user document. */
function signToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      ver: Number(user.tokenVersion) || 0,
    },
    getSecret(),
    {
      expiresIn: getExpiry(),
      // Every access token gets a unique id, even when two are minted in the
      // same second (also makes future token revocation lists possible).
      jwtid: crypto.randomUUID(),
    }
  );
}

/** Reject the request unless it carries a valid, non-expired token. */
async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw httpError(401, 'Authentication required. Please sign in.');
    }

    let payload;
    try {
      payload = jwt.verify(token, getSecret());
    } catch {
      throw httpError(401, 'Your session is invalid or has expired. Please sign in again.');
    }

    // Load the user so that deleted users / role changes take effect immediately.
    const user = await User.findById(payload.sub);
    if (!user) {
      throw httpError(401, 'This account no longer exists.');
    }

    // A password change or "sign out everywhere" bumps tokenVersion, which
    // invalidates every access token issued before it.
    if ((Number(payload.ver) || 0) !== (Number(user.tokenVersion) || 0)) {
      throw httpError(401, 'Your session is no longer valid. Please sign in again.');
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Allow only the listed roles. Must run after requireAuth. */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(httpError(401, 'Authentication required. Please sign in.'));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        httpError(403, `Access denied. This action requires the ${roles.join(' or ')} role.`)
      );
    }
    return next();
  };
}

/** Allow only roles that hold every listed permission. Must run after requireAuth. */
function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(httpError(401, 'Authentication required. Please sign in.'));
    }
    const allowed = permissions.every((permission) =>
      roleHasPermission(req.user.role, permission)
    );
    if (!allowed) {
      return next(httpError(403, 'Access denied. Your account does not have this permission.'));
    }
    return next();
  };
}

/**
 * Attach `req.user` when a valid token is present, but never reject the
 * request. Used by the cart, which works for anonymous visitors as well as for
 * signed-in users.
 */
async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, getSecret());
    const user = await User.findById(payload.sub);
    if (user && (Number(payload.ver) || 0) === (Number(user.tokenVersion) || 0)) {
      req.user = user;
    }
  } catch {
    // Invalid / expired token → treat the request as anonymous.
  }

  return next();
}

module.exports = {
  signToken,
  requireAuth,
  requireRole,
  requirePermission,
  optionalAuth,
  getSecret,
  DEV_SECRET,
};

