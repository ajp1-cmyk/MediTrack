// One-time sign-in codes (emailed).
//
// One document per issued code, deleted by MongoDB once `expires_at` passes. The
// code itself is never stored: `codeHash` is an HMAC of `<email>:<code>` keyed
// with OTP_SECRET (or JWT_SECRET), so a database leak cannot be replayed against
// the API — the same reasoning as the refresh-session `tokenHash`.
const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    // HMAC-SHA256 of `<email>:<code>`. `select: false` keeps it out of ordinary
    // queries; the verifier asks for it explicitly.
    codeHash: {
      type: String,
      required: true,
      select: false,
    },
    expires_at: {
      type: Date,
      required: true,
    },
    // Wrong guesses against this code. At OTP_MAX_ATTEMPTS the code is thrown
    // away, so a 6-digit space cannot be walked through.
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Set the moment the code is accepted. A code is single-use: the update that
    // sets this is atomic, so two parallel verifications cannot both win.
    consumed_at: {
      type: Date,
      default: null,
    },
    request_ip: {
      type: String,
      default: '',
      maxlength: 64,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

// Expired codes are removed by MongoDB itself (TTL index).
otpSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
// "the newest live code for this address" — the query the verifier runs.
otpSchema.index({ email: 1, consumed_at: 1, created_at: -1 });

module.exports = mongoose.model('OtpCode', otpSchema);
