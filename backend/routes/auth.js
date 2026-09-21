// Authentication (login / token issue) and user management routes.
//
//   POST /api/auth/register      → bootstrap the first admin, afterwards admin-only
//   POST /api/auth/login         → { token, user }
//   GET  /api/auth/me            → the signed-in user
//   GET  /api/auth/users         → admin only: list accounts + their roles
//   PATCH /api/auth/users/:id/role → admin only: promote/demote an account
const express = require('express');
const User = require('../models/User');
const { signToken, requireAuth, requireRole } = require('../middleware/auth');
const { httpError, asyncHandler } = require('../lib/errors');

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
 * The very first account created bootstraps the system (and becomes an admin).
 * Once at least one user exists, only a signed-in admin may create accounts.
 * Written as a plain Express middleware so `next(err)` is only ever called once.
 */
function bootstrapOrAdmin(req, res, next) {
  User.estimatedDocumentCount()
    .then((userCount) => {
      if (userCount === 0) {
        req.isBootstrap = true;
        return next();
      }
      // requireAuth / requireRole call next(err) on failure, next() on success.
      return requireAuth(req, res, (err) => {
        if (err) return next(err);
        return requireRole('admin')(req, res, next);
      });
    })
    .catch(next);
}

// POST /api/auth/register
router.post(
  '/register',
  bootstrapOrAdmin,
  asyncHandler(async (req, res) => {
    const { name, email, password } = readCredentials(req.body);

    if (!name || !email || !password) {
      throw httpError(400, 'name, email and password are all required');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw httpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }

    // Only the bootstrap account can self-assign admin; after that an admin
    // explicitly chooses the role when creating an account.
    const role = req.isBootstrap || req.body.role === 'admin' ? 'admin' : 'staff';

    const existing = await User.findOne({ email });
    if (existing) {
      throw httpError(409, 'An account with this email already exists');
    }

    const user = new User({ name, email, role });
    await user.setPassword(password);
    await user.save();

    return res.status(201).json({ token: signToken(user), user });
  })
);

// POST /api/auth/login
router.post(
  '/login',
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

    return res.json({ token: signToken(user), user });
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
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const users = await User.find().sort({ created_at: 1 });
    res.json(users);
  })
);

// PATCH /api/auth/users/:id/role — promote someone to admin or demote to staff.
router.patch(
  '/users/:id/role',
  requireAuth,
  requireRole('admin'),
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

    user.role = role;
    await user.save();
    res.json(user);
  })
);

module.exports = router;
