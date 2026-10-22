// Authentication (login / token issue) and user management routes.
//
//   POST /api/auth/register      → customer sign-up; role "admin" needs the invite code
//   POST /api/auth/login         → { token, user } + httpOnly refresh cookie
//   POST /api/auth/refresh       → rotate the refresh cookie, return a new access token
//   POST /api/auth/logout        → revoke the refresh session
//   GET  /api/auth/me            → the signed-in user
//   GET  /api/auth/sessions      → the caller's active sessions
//   DELETE /api/auth/sessions    → revoke every session ("sign out everywhere")
//   DELETE /api/auth/sessions/:id → revoke one session
//   PATCH /api/auth/password     → change password, revoke all sessions
//   GET  /api/auth/users         → admin only: list accounts + their roles
//   PATCH /api/auth/users/:id/role → admin only: promote/demote an account
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const { signToken, requireAuth, requirePermission } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');
const { rejectFormBody } = require('../middleware/requestGuards');
const { httpError, asyncHandler } = require('../lib/errors');
const { recordAudit } = require('../lib/audit');
const {
  readRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  createSession,
  revokeSessionByToken,
  revokeAllSessions,
  bumpTokenVersion,
  rotateSession,
  listSessions,
  revokeSessionById,
} = require('../lib/sessions');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 8;

function readCredentials(body = {}) {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : '',
    password: typeof body.password === 'string' ? body.password : '',
  };
}

/**
 * Registration rules
 *
 *   • Public registration always creates a `customer` account.
 *   • `staff` and `admin` accounts are never self-service: an administrator
 *     issues a single-use invite (see /api/admin/invites) and the invitee
 *     accepts it at /api/admin/auth/accept-invite.
 */
function resolveRegistrationRole(body = {}) {
  const requestedRole = body.role === undefined || body.role === null ? 'customer' : body.role;

  if (!User.ROLES.includes(requestedRole)) {
    throw httpError(400, `role must be one of: ${User.ROLES.join(', ')}`);
  }

  if (requestedRole !== 'customer') {
    throw httpError(
      403,
      'Staff and administrator accounts are created with an invite issued by an administrator.'
    );
  }

  return 'customer';
}

// POST /api/auth/register
// Rate limited per IP and JSON-only, so a script cannot enumerate invite codes
// or create accounts in bulk.
router.post(
  '/register',
  registerLimiter,
  rejectFormBody,
  asyncHandler(async (req, res) => {
    const { name, email, password } = readCredentials(req.body);

    if (!name || !email || !password) {
      throw httpError(400, 'name, email and password are all required');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw httpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }

    const role = resolveRegistrationRole(req.body);

    const existing = await User.findOne({ email });
    if (existing) {
      throw httpError(409, 'An account with this email already exists');
    }

    const user = new User({ name, email, role });
    await user.setPassword(password);
    await user.save();

    // Sign the new account in: short-lived access token + long-lived refresh
    // session in an httpOnly cookie.
    const { token, expiresAt } = await createSession(user, req);
    setRefreshCookie(res, token, expiresAt);

    await recordAudit({
      req,
      actor: user,
      action: 'auth.register',
      targetType: 'user',
      targetId: user._id,
      after: { email: user.email, role: user.role },
    });

    return res.status(201).json({
      token: signToken(user),
      user,
      refreshExpiresAt: expiresAt,
    });
  })
);

// POST /api/auth/login
// Only failed attempts count towards the limit, keyed by IP + email.
router.post(
  '/login',
  loginLimiter,
  rejectFormBody,
  asyncHandler(async (req, res) => {
    const { email, password } = readCredentials(req.body);
    if (!email || !password) {
      throw httpError(400, 'email and password are required');
    }

    const user = await User.findOne({ email }).select('+passwordHash');
    // Same message for "no such user" and "wrong password" on purpose.
    if (!user || !(await user.verifyPassword(password))) {
      throw httpError(401, 'Invalid email or password');
    }

    const { token, expiresAt } = await createSession(user, req);
    setRefreshCookie(res, token, expiresAt);

    await recordAudit({
      req,
      actor: user,
      action: 'auth.login',
      targetType: 'user',
      targetId: user._id,
    });

    return res.json({
      token: signToken(user),
      user,
      refreshExpiresAt: expiresAt,
    });
  })
);

// POST /api/auth/refresh — rotate the refresh cookie and mint a new access token.
// The refresh cookie alone authenticates this route, so it still works after the
// 15-minute access token has expired.
router.post(
  '/refresh',
  rejectFormBody,
  asyncHandler(async (req, res) => {
    const rotated = await rotateSession(readRefreshToken(req), req);

    if (rotated.error === 'race') {
      // A concurrent tab already rotated this cookie; the browser will have the
      // new value shortly. The SPA retries automatically.
      res.set('Retry-After', '1');
      throw httpError(409, 'Session refresh already in progress. Please retry.');
    }

    if (!rotated.user) {
      clearRefreshCookie(res);
      throw httpError(401, 'Your session has expired or was revoked. Please sign in again.');
    }

    setRefreshCookie(res, rotated.token, rotated.expiresAt);
    res.json({
      token: signToken(rotated.user),
      user: rotated.user,
      refreshExpiresAt: rotated.expiresAt,
    });
  })
);

// POST /api/auth/logout — revoke this browser's refresh session.
router.post(
  '/logout',
  rejectFormBody,
  asyncHandler(async (req, res) => {
    await revokeSessionByToken(readRefreshToken(req), 'logout');
    clearRefreshCookie(res);
    res.json({ success: true });
  })
);

// PATCH /api/auth/password — change the password and sign out everywhere.
router.patch(
  '/password',
  requireAuth,
  rejectFormBody,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      throw httpError(400, 'currentPassword and newPassword are required');
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw httpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }

    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user || !(await user.verifyPassword(currentPassword))) {
      // 400 (not 401) so the SPA does not try to refresh the session for a
      // simple form mistake.
      throw httpError(400, 'Current password is incorrect');
    }

    await user.setPassword(newPassword);
    user.passwordChangedAt = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // Every device must sign in again with the new password.
    await revokeAllSessions(user._id, 'password_changed');
    clearRefreshCookie(res);

    await recordAudit({
      req,
      actor: user,
      action: 'auth.password_change',
      targetType: 'user',
      targetId: user._id,
    });

    res.json({ success: true });
  })
);

// GET /api/auth/sessions — the caller's active sessions.
router.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listSessions(req.user._id, readRefreshToken(req)));
  })
);

// DELETE /api/auth/sessions — sign out everywhere.
router.delete(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await revokeAllSessions(req.user._id, 'revoked_by_user');
    // Invalidate outstanding access tokens immediately as well.
    await bumpTokenVersion(req.user._id);
    clearRefreshCookie(res);
    res.json({ success: true, revoked: result.modifiedCount });
  })
);

// DELETE /api/auth/sessions/:id — revoke one other browser.
router.delete(
  '/sessions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw httpError(404, 'Session not found');
    }

    const outcome = await revokeSessionById(
      req.user._id,
      req.params.id,
      readRefreshToken(req)
    );
    if (!outcome) {
      throw httpError(404, 'Session not found');
    }

    if (outcome.isCurrent) {
      clearRefreshCookie(res);
    }

    res.json({
      success: true,
      id: outcome.session._id.toString(),
      current: outcome.isCurrent,
    });
  })
);

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/users — who exists, and who is allowed to update stock.
router.get(
  '/users',
  requireAuth,
  requirePermission('users:manage'),
  asyncHandler(async (_req, res) => {
    const users = await User.find().sort({ created_at: 1 });
    res.json(users);
  })
);

// PATCH /api/auth/users/:id/role — promote/demote an account (admin only).
router.patch(
  '/users/:id/role',
  requireAuth,
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const { role } = req.body || {};
    if (!User.ROLES.includes(role)) {
      throw httpError(400, `role must be one of: ${User.ROLES.join(', ')}`);
    }
    if (req.params.id === req.user._id.toString() && role !== 'admin') {
      throw httpError(400, 'You cannot remove your own admin access');
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      throw httpError(404, 'User not found');
    }

    // Defence in depth: never allow the system to be left without an
    // administrator. (Self-demotion is already rejected above; this also
    // covers future account-deletion / transfer flows.)
    if (user.role === 'admin' && role !== 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        throw httpError(
          400,
          'You cannot remove the last administrator. Promote another account first.'
        );
      }
    }

    const previousRole = user.role;
    user.role = role;
    await user.save();

    await recordAudit({
      req,
      action: 'user.role',
      targetType: 'user',
      targetId: user._id,
      before: { email: user.email, role: previousRole },
      after: { email: user.email, role: user.role },
    });

    res.json(user);
  })
);

module.exports = router;
