// Public back-office authentication.
//
//   POST /api/admin/auth/login          → staff/admin only
//   POST /api/admin/auth/accept-invite  → redeem a single-use invite
//
// Mounted before the protected /api/admin router in server.js.
const express = require('express');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');
const { rejectFormBody } = require('../middleware/requestGuards');
const { httpError, asyncHandler } = require('../lib/errors');
const { recordAudit } = require('../lib/audit');
const { setRefreshCookie, createSession } = require('../lib/sessions');
const { findValidInvite, findInviteByToken, markAccepted } = require('../lib/invites');
const { isBackOffice } = require('../lib/permissions');

const router = express.Router();
const MIN_PASSWORD_LENGTH = 8;

// POST /api/admin/auth/login — a separate entry point from the storefront.
router.post(
  '/login',
  loginLimiter,
  rejectFormBody,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      throw httpError(400, 'email and password are required');
    }

    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await user.verifyPassword(password))) {
      throw httpError(401, 'Invalid email or password');
    }

    if (!isBackOffice(user.role)) {
      throw httpError(
        403,
        'This account does not have back-office access. Use the customer sign-in page.'
      );
    }

    const { token, expiresAt } = await createSession(user, req);
    setRefreshCookie(res, token, expiresAt);

    await recordAudit({
      req,
      actor: user,
      action: 'auth.admin_login',
      targetType: 'user',
      targetId: user._id,
    });

    res.json({ token: signToken(user), user, refreshExpiresAt: expiresAt });
  })
);

// POST /api/admin/auth/accept-invite — create the invited account.
router.post(
  '/accept-invite',
  registerLimiter,
  rejectFormBody,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const suppliedEmail =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!token) {
      throw httpError(400, 'An invite token is required');
    }
    if (!name || !password) {
      throw httpError(400, 'name and password are required');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw httpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }

    const invite = await findValidInvite(token);
    if (!invite) {
      const existing = await findInviteByToken(token);
      if (!existing) throw httpError(400, 'This invite token is not valid.');
      if (existing.acceptedAt) throw httpError(410, 'This invite has already been used.');
      if (existing.revokedAt) throw httpError(410, 'This invite was revoked.');
      throw httpError(410, 'This invite has expired.');
    }

    if (suppliedEmail && suppliedEmail !== invite.email) {
      throw httpError(400, 'This invite was issued for a different email address.');
    }

    const existingUser = await User.findOne({ email: invite.email });
    if (existingUser) {
      throw httpError(409, 'An account with this email already exists');
    }

    const user = new User({ name, email: invite.email, role: invite.role });
    await user.setPassword(password);
    await user.save();
    await markAccepted(invite, user._id);

    const { token: refreshToken, expiresAt } = await createSession(user, req);
    setRefreshCookie(res, refreshToken, expiresAt);

    await recordAudit({
      req,
      actor: user,
      action: 'invite.accept',
      targetType: 'invite',
      targetId: invite._id,
      after: { email: user.email, role: user.role },
    });

    res.status(201).json({
      token: signToken(user),
      user,
      refreshExpiresAt: expiresAt,
    });
  })
);

module.exports = router;
