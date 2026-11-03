// Prescriptions collection (SRS FR-1.4 / FR-2.1, NFR-1.4).
//
// A customer uploads a scan or photo of a prescription. The bytes are encrypted
// with AES-256-GCM *before* they are stored, and the key never lives in the
// database (`RX_ENCRYPTION_KEY`, or a key derived from JWT_SECRET when that is
// not configured). Nothing is written to the public `backend/uploads`
// directory, so a prescription can never be fetched by guessing a static file
// name; it is streamed only to its owner or to a verifier.
//
// Lifecycle
//   pending    uploaded, waiting for staff review
//   verified   approved; `validUntil` is set (PRESCRIPTION_VALID_DAYS)
//   rejected   refused with a `rejectionReason`
//   superseded replaced by a newer verified prescription (one active per user)
const mongoose = require('mongoose');

const PRESCRIPTION_STATUSES = ['pending', 'verified', 'rejected', 'superseded'];
const PRESCRIPTION_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_PRESCRIPTION_BYTES = 5 * 1024 * 1024; // 5 MB, like medicine images

const prescriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200, 'File name cannot be longer than 200 characters'],
    },
    mimeType: {
      type: String,
      required: true,
      enum: {
        values: PRESCRIPTION_MIME_TYPES,
        message: `Prescription must be one of: ${PRESCRIPTION_MIME_TYPES.join(', ')}`,
      },
    },
    sizeBytes: {
      type: Number,
      required: true,
      min: [1, 'The uploaded file is empty'],
      max: [MAX_PRESCRIPTION_BYTES, 'Prescription files cannot be larger than 5 MB'],
    },
    status: {
      type: String,
      enum: { values: PRESCRIPTION_STATUSES, message: `Status must be one of: ${PRESCRIPTION_STATUSES.join(', ')}` },
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: [200, 'Rejection reason cannot be longer than 200 characters'],
    },
    verifiedAt: { type: Date, default: null },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Set when a verifier approves the upload: now + PRESCRIPTION_VALID_DAYS.
    validUntil: { type: Date, default: null },
    // AES-256-GCM ciphertext. `select: false` keeps the bytes out of every
    // query unless the file route asks for them explicitly, and toJSON strips
    // them as a second line of defence.
    fileData: { type: Buffer, select: false },
    fileIv: { type: String, select: false },
    fileAuthTag: { type: String, select: false },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.fileData;
        delete ret.fileIv;
        delete ret.fileAuthTag;
        return ret;
      },
    },
  }
);

// The customer's own history (newest first) and the staff verification queue.
prescriptionSchema.index({ user: 1, created_at: -1 });
prescriptionSchema.index({ status: 1, created_at: 1 });
// The checkout gate looks up one verified, still-valid prescription per user.
prescriptionSchema.index({ user: 1, status: 1, validUntil: 1 });

prescriptionSchema.statics.STATUSES = PRESCRIPTION_STATUSES;
prescriptionSchema.statics.MIME_TYPES = PRESCRIPTION_MIME_TYPES;
prescriptionSchema.statics.MAX_BYTES = MAX_PRESCRIPTION_BYTES;

module.exports = mongoose.model('Prescription', prescriptionSchema);
module.exports.PRESCRIPTION_STATUSES = PRESCRIPTION_STATUSES;
module.exports.PRESCRIPTION_MIME_TYPES = PRESCRIPTION_MIME_TYPES;
module.exports.MAX_PRESCRIPTION_BYTES = MAX_PRESCRIPTION_BYTES;
