// Admin/staff invite helpers.
const crypto = require('crypto');
const AdminInvite = require('../models/AdminInvite');

function positiveInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const INVITE_TTL_HOURS = positiveInteger(process.env.ADMIN_INVITE_TTL_HOURS, 72);

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Create an invite and return the raw token (shown to the admin exactly once). */
async function createInvite({ email, role, createdBy }) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

  const invite = await AdminInvite.create({
    email: String(email).toLowerCase().trim(),
    role,
    createdBy,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return { invite, token, expiresAt };
}

/** Find an invite that can still be accepted. */
async function findValidInvite(token) {
  if (!token || typeof token !== 'string') return null;
  return AdminInvite.findOne({
    tokenHash: hashToken(token),
    acceptedAt: null,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
}

/** Find any invite for a token (including expired / accepted) for better errors. */
async function findInviteByToken(token) {
  if (!token || typeof token !== 'string') return null;
  return AdminInvite.findOne({ tokenHash: hashToken(token) });
}

async function markAccepted(invite, userId) {
  invite.acceptedAt = new Date();
  invite.acceptedBy = userId;
  await invite.save();
  return invite;
}

function inviteStatus(invite) {
  if (invite.acceptedAt) return 'accepted';
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt <= new Date()) return 'expired';
  return 'pending';
}

async function listInvites({ includeClosed = false } = {}) {
  const filter = includeClosed
    ? {}
    : { acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } };

  const invites = await AdminInvite.find(filter).sort({ created_at: -1 }).limit(100);
  return invites.map((invite) => ({ ...invite.toJSON(), status: inviteStatus(invite) }));
}

async function revokeInviteById(id) {
  const invite = await AdminInvite.findOne({
    _id: id,
    acceptedAt: null,
    revokedAt: null,
  });
  if (!invite) return null;

  invite.revokedAt = new Date();
  await invite.save();
  return invite;
}

module.exports = {
  INVITE_TTL_HOURS,
  generateToken,
  hashToken,
  createInvite,
  findValidInvite,
  findInviteByToken,
  markAccepted,
  inviteStatus,
  listInvites,
  revokeInviteById,
};
