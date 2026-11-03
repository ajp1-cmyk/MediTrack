// Users collection — used for authentication and role-based authorisation.
//
// Roles
//   customer → storefront: browse, cart, checkout, own orders
//   staff    → back office: add/update stock and fulfil orders
//   admin    → everything, including roles, invites and the audit log
//
// The permission list for a role lives in lib/permissions.js and is included in
// the JSON returned to the SPA, so the frontend never duplicates role logic.
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { permissionsFor } = require('../lib/permissions');

const ROLES = ['customer', 'staff', 'admin'];
const SALT_ROUNDS = 10;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [80, 'Name cannot be longer than 80 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    // Never store plain passwords. `select: false` keeps the hash out of
    // query results unless it is explicitly asked for with .select('+passwordHash').
    //
    // Accounts created through emailed one-time codes (see lib/otp.js) have no
    // local password, so the field is only required for
    // `authProvider: 'password'` (enforced by the pre-validate hook below).
    passwordHash: {
      type: String,
      select: false,
    },
    // How this account signs in.
    //   password → MediTrack's own email + password form
    //   otp      → created by the emailed-code sign-in; there is no local password
    // An existing password account that also signs in with a code keeps
    // `password`, so both methods keep working.
    authProvider: {
      type: String,
      enum: {
        values: ['password', 'otp'],
        message: 'authProvider must be one of: password, otp',
      },
      default: 'password',
    },
    role: {
      type: String,
      enum: { values: ROLES, message: `Role must be one of: ${ROLES.join(', ')}` },
      default: 'customer',
    },
    // Bumped whenever every outstanding token must stop working (password
    // change, "sign out everywhere"). Included in the JWT as `ver` and checked
    // on every authenticated request.
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    passwordChangedAt: {
      type: Date,
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
        delete ret.passwordHash;
        // The SPA uses this list to show/hide back-office actions. The API
        // still enforces everything server-side.
        ret.permissions = permissionsFor(ret.role);
        return ret;
      },
    },
  }
);

// Password accounts must have a hash; code-only accounts never do.
//
// Only check when the hash is being written: `passwordHash` is `select: false`,
// so an existing document loaded with `User.findById(...)` has no hash in memory
// and must still be able to save unrelated changes (role, name, …).
userSchema.pre('validate', function requirePassword(next) {
  const writingPassword = this.isNew || this.isModified('passwordHash');
  if (this.authProvider !== 'otp' && !this.passwordHash && writingPassword) {
    this.invalidate('passwordHash', 'Password is required');
  }
  return next();
});

/** Hash and store a plain-text password. */
userSchema.methods.setPassword = async function setPassword(plainPassword) {
  this.passwordHash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
};

/** Compare a plain-text password against the stored hash. */
userSchema.methods.verifyPassword = function verifyPassword(plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash || '');
};

userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
