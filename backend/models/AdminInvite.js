// Administrator/staff invites.
//
// An admin creates an invite for a specific email and role. The raw token is
// returned once (the console shows a one-time registration link); only its
// SHA-256 hash is stored. Invites expire, are single-use and can be revoked.
const mongoose = require('mongoose');

const INVITE_ROLES = ['admin', 'staff'];

const adminInviteSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    role: {
      type: String,
      enum: { values: INVITE_ROLES, message: `Invite role must be one of: ${INVITE_ROLES.join(', ')}` },
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    revokedAt: { type: Date, default: null },
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

adminInviteSchema.index({ email: 1, created_at: -1 });
adminInviteSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('AdminInvite', adminInviteSchema);
module.exports.INVITE_ROLES = INVITE_ROLES;
