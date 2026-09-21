// JWT authentication / role authorisation middleware.
//
// Clients send:  Authorization: Bearer <token>
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { httpError } = require('../lib/errors');

// Development fallback so `npm run dev` works before a .env file exists.
// Always set JWT_SECRET outside of local development.
const DEV_SECRET = 'meditrack-insecure-dev-secret-change-me';
const getSecret = () => process.env.JWT_SECRET || DEV_SECRET;
const getExpiry = () => process.env.JWT_EXPIRES_IN || '7d';

/** Create a signed JWT for a user document. */
function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role },
    getSecret(),
    { expiresIn: getExpiry() }
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

module.exports = { signToken, requireAuth, requireRole, getSecret, DEV_SECRET };
