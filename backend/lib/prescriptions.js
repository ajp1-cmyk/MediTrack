// Prescription encryption, status and verification helpers (SRS FR-1.4 /
// FR-2.1, NFR-1.4).
//
// Files are encrypted with AES-256-GCM before they are written to MongoDB:
//
//   key      RX_ENCRYPTION_KEY (64 hex characters = 32 bytes, or any passphrase,
//            which is hashed to 32 bytes). When the variable is missing the key
//            is derived from JWT_SECRET, so an existing deployment keeps working
//            without a new secret — set RX_ENCRYPTION_KEY to decouple the two.
//   iv       12 random bytes per file (GCM nonce)
//   tag      GCM authentication tag, so tampering is detected on read
//
// One verified prescription per customer is active at a time, valid for
// PRESCRIPTION_VALID_DAYS (default 365). Verifying a newer upload supersedes the
// previous verified one.
const crypto = require('crypto');
const Prescription = require('../models/Prescription');
const { roleHasPermission } = require('./permissions');
const { httpError } = require('./errors');

const DEFAULT_VALID_DAYS = 365;
const MAX_VALID_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;
// Only used when neither RX_ENCRYPTION_KEY nor JWT_SECRET is configured (local
// development); production refuses to start without JWT_SECRET.
const DEV_SECRET = 'meditrack-insecure-dev-secret-change-me';

/** Read a whole-number environment variable, falling back when it is unusable. */
function readWholeNumber(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** How long a verified prescription stays valid (SRS FR-2.1). */
function prescriptionValidDays() {
  return readWholeNumber('PRESCRIPTION_VALID_DAYS', DEFAULT_VALID_DAYS, {
    min: 1,
    max: MAX_VALID_DAYS,
  });
}

/** The 32-byte AES key used for prescription files. */
function encryptionKey() {
  const raw = process.env.RX_ENCRYPTION_KEY;
  if (typeof raw === 'string' && raw.trim()) {
    const value = raw.trim();
    if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
    // Any other passphrase is stretched to exactly 32 bytes.
    return crypto.createHash('sha256').update(value).digest();
  }
  return crypto
    .createHash('sha256')
    .update(`meditrack-rx:${process.env.JWT_SECRET || DEV_SECRET}`)
    .digest();
}

/**
 * Encrypt one uploaded file.
 * @param {Buffer} buffer
 * @returns {{ fileData: Buffer, fileIv: string, fileAuthTag: string }}
 */
function encryptFile(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const fileData = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return {
    fileData,
    fileIv: iv.toString('hex'),
    fileAuthTag: cipher.getAuthTag().toString('hex'),
  };
}

/**
 * Decrypt a prescription document loaded with `+fileData +fileIv +fileAuthTag`.
 * @param {import('../models/Prescription')} prescription
 * @returns {Buffer}
 */
function decryptFile(prescription) {
  if (
    !prescription ||
    !prescription.fileData ||
    !prescription.fileIv ||
    !prescription.fileAuthTag
  ) {
    throw httpError(410, 'This prescription file is no longer available.');
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(prescription.fileIv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(prescription.fileAuthTag, 'hex'));
    return Buffer.concat([decipher.update(prescription.fileData), decipher.final()]);
  } catch {
    // Wrong key (JWT_SECRET rotated without RX_ENCRYPTION_KEY) or tampered data.
    throw httpError(500, 'This prescription file could not be decrypted.');
  }
}

/** The customer's active (verified and unexpired) prescription, or null. */
async function activePrescriptionFor(userId, now = new Date()) {
  if (!userId) return null;
  return Prescription.findOne({
    user: userId,
    status: 'verified',
    validUntil: { $gt: now },
  }).sort({ validUntil: -1 });
}

/** The most recent upload of any status, or null. */
async function latestPrescriptionFor(userId) {
  if (!userId) return null;
  return Prescription.findOne({ user: userId }).sort({ created_at: -1 });
}


/**
 * What the storefront needs to know about a customer's prescription.
 *
 * @returns {Promise<{
 *   status: 'none'|'pending'|'verified'|'rejected'|'expired'|'superseded',
 *   verified: boolean, pending: boolean, validUntil: Date|null,
 *   rejectionReason: string|null, prescriptionId: string|null,
 *   uploadedAt: Date|null
 * }>}
 */
async function prescriptionStateFor(userId, now = new Date()) {
  const empty = {
    status: 'none',
    verified: false,
    pending: false,
    validUntil: null,
    rejectionReason: null,
    prescriptionId: null,
    uploadedAt: null,
  };
  if (!userId) return empty;

  const [active, latest] = await Promise.all([
    activePrescriptionFor(userId, now),
    latestPrescriptionFor(userId),
  ]);

  if (active) {
    return {
      status: 'verified',
      verified: true,
      pending: false,
      validUntil: active.validUntil,
      rejectionReason: null,
      prescriptionId: active._id.toString(),
      uploadedAt: active.created_at,
    };
  }

  if (!latest) return empty;

  return {
    // A verified upload whose `validUntil` has passed reads as "expired", which
    // tells the customer to upload a fresh one rather than "verified".
    status: latest.status === 'verified' ? 'expired' : latest.status,
    verified: false,
    pending: latest.status === 'pending',
    validUntil: latest.validUntil,
    rejectionReason: latest.rejectionReason,
    prescriptionId: latest._id.toString(),
    uploadedAt: latest.created_at,
  };
}

/** True when at least one planned cart line is prescription-only (FR-1.4). */
function requiresPrescription(plans = []) {
  return plans.some((plan) => Boolean(plan.medicine && plan.medicine.prescriptionRequired));
}

/**
 * Gate a checkout (FR-2.1): prescription-only lines need one verified, still
 * valid prescription on file. Called before any stock counter moves.
 *
 * @returns {Promise<import('../models/Prescription')|null>} null when the cart
 *   contains no prescription-only medicine
 */
async function prescriptionForCheckout({ plans = [], user, now = new Date() }) {
  if (!requiresPrescription(plans)) return null;

  const active = await activePrescriptionFor(user._id, now);
  if (!active) {
    throw httpError(
      409,
      'A verified prescription is required for the prescription-only medicines in your cart. ' +
        'Upload one from "My prescriptions" and wait for staff verification before checking out.'
    );
  }
  return active;
}

/**
 * Approve or reject a pending prescription. Uses an atomic status transition so
 * two verifiers cannot both decide the same upload.
 *
 * @param {object} params
 * @param {unknown} params.id
 * @param {import('../models/User')} params.verifier
 * @param {boolean} params.approved
 * @param {string} [params.reason] required when rejecting
 * @param {Date} [params.now] injectable clock (used by tests)
 * @returns {Promise<import('../models/Prescription')>}
 */
async function verifyPrescription({ id, verifier, approved, reason, now = new Date() }) {
  const validUntil = new Date(now.getTime() + prescriptionValidDays() * DAY_MS);
  const rejectionReason = String(reason || '').trim();

  if (!approved && !rejectionReason) {
    throw httpError(400, 'A rejection reason is required');
  }

  const update = approved
    ? {
        status: 'verified',
        verifiedAt: now,
        verifiedBy: verifier._id,
        validUntil,
        rejectionReason: null,
      }
    : {
        status: 'rejected',
        verifiedAt: now,
        verifiedBy: verifier._id,
        validUntil: null,
        rejectionReason,
      };

  const prescription = await Prescription.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: update },
    { new: true }
  );

  if (!prescription) {
    const existing = await Prescription.findById(id);
    if (!existing) throw httpError(404, 'Prescription not found');
    throw httpError(409, `This prescription is already ${existing.status}.`);
  }

  // "One verified prescription per customer": a newly verified upload replaces
  // the older one, so the checkout gate always uses the latest approval.
  if (approved) {
    await Prescription.updateMany(
      { user: prescription.user, _id: { $ne: prescription._id }, status: 'verified' },
      { $set: { status: 'superseded' } }
    );
  }

  return prescription;
}

/**
 * Load a prescription *with* its encrypted bytes and authorise the viewer.
 * Only the owner or a verifier may read it; everybody else gets a 404 so the
 * existence of another customer's prescription is not leaked.
 *
 * @param {object} params
 * @param {unknown} params.id
 * @param {import('../models/User')} params.viewer
 * @returns {Promise<{ prescription: import('../models/Prescription'), data: Buffer }>}
 */
async function loadPrescriptionFile({ id, viewer }) {
  const prescription = await Prescription.findById(id).select(
    '+fileData +fileIv +fileAuthTag'
  );
  if (!prescription) throw httpError(404, 'Prescription not found');

  const isOwner = String(prescription.user) === String(viewer._id);
  const isVerifier = roleHasPermission(viewer.role, 'prescriptions:verify');
  if (!isOwner && !isVerifier) throw httpError(404, 'Prescription not found');

  return { prescription, data: decryptFile(prescription) };
}

/** Stream a decrypted prescription with headers that forbid caching. */
function sendPrescriptionFile(res, { prescription, data }) {
  // Keep the customer's file name but strip anything that could break the
  // header (quotes, separators, control characters).
  const safeName = String(prescription.originalName || 'prescription')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 120);

  res.set({
    'Content-Type': prescription.mimeType,
    'Content-Disposition': `inline; filename="${safeName}"`,
    'Content-Length': String(data.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(data);
}

module.exports = {
  DEFAULT_VALID_DAYS,
  MAX_VALID_DAYS,
  prescriptionValidDays,
  encryptionKey,
  encryptFile,
  decryptFile,
  activePrescriptionFor,
  latestPrescriptionFor,
  prescriptionStateFor,
  requiresPrescription,
  prescriptionForCheckout,
  verifyPrescription,
  loadPrescriptionFile,
  sendPrescriptionFile,
};

