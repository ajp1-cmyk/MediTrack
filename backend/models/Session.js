// Sessions collection — one document per signed-in browser.
//
// The browser holds an opaque refresh token in a signed, httpOnly cookie; only
// the SHA-256 hash of that token is stored here. Access tokens are short-lived
// JWTs kept in memory by the SPA, so a value stolen from storage is useless.
//
// Refresh tokens rotate on every use: the old row is revoked with
// `revokedReason: 'rotated'` and linked to its replacement. If a rotated token
// is presented again, the cookie was copied — the API then revokes every
// session for that user.
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // SHA-256 hash of the random token kept in the signed cookie.
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    userAgent: {
      type: String,
      default: '',
      maxlength: [300, 'User agent cannot be longer than 300 characters'],
    },
    ip: {
      type: String,
      default: '',
      maxlength: [64, 'IP address cannot be longer than 64 characters'],
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    // The TTL index below deletes the row once the refresh token expires.
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedReason: {
      type: String,
      default: null,
    },
    // Set when this session was rotated into a newer one.
    replacedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.tokenHash;
        return ret;
      },
    },
  }
);

sessionSchema.index({ user: 1, revokedAt: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', sessionSchema);
