// Customer prescription routes (SRS FR-1.4 / FR-2.1, NFR-1.4).
//
//   POST /api/prescriptions            → upload a prescription (JPG/PNG/PDF)
//   GET  /api/prescriptions            → the caller's uploads + current status
//   GET  /api/prescriptions/:id/file   → stream the decrypted file (owner only)
//
// Files are held in memory by multer (never written to the public uploads
// directory), encrypted with AES-256-GCM and stored in MongoDB. Only the owner
// or a verifier can read them back.
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const Prescription = require('../models/Prescription');
const { requireAuth } = require('../middleware/auth');
const { httpError, asyncHandler } = require('../lib/errors');
const { recordAudit } = require('../lib/audit');
const {
  encryptFile,
  prescriptionStateFor,
  loadPrescriptionFile,
  sendPrescriptionFile,
} = require('../lib/prescriptions');

const router = express.Router();

// In-memory upload: the file is encrypted before it reaches the database, so
// there is no plaintext copy on disk at any point.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Prescription.MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (!Prescription.MIME_TYPES.includes(file.mimetype)) {
      return cb(
        httpError(
          415,
          `Prescriptions must be one of: ${Prescription.MIME_TYPES.join(', ')}`
        )
      );
    }
    return cb(null, true);
  },
});

/** Turn multer's own errors into the API's JSON error shape. */
function uploadPrescription(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(
        httpError(413, `Prescription files cannot be larger than ${Prescription.MAX_BYTES / (1024 * 1024)} MB`)
      );
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(httpError(400, 'Attach exactly one file in the "file" field'));
    }
    return next(err.status ? err : httpError(400, err.message || 'Upload failed'));
  });
}

router.use(requireAuth);

// POST /api/prescriptions — multipart/form-data with one `file` field.
router.post(
  '/',
  uploadPrescription,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw httpError(400, 'Attach a prescription file (JPG, PNG or PDF) in the "file" field.');
    }

    // Keep the queue short: one upload can wait for review at a time.
    const pending = await Prescription.findOne({ user: req.user._id, status: 'pending' });
    if (pending) {
      throw httpError(409, 'You already have a prescription waiting for verification.');
    }

    const encrypted = encryptFile(req.file.buffer);
    const prescription = await Prescription.create({
      user: req.user._id,
      originalName: String(req.file.originalname || 'prescription').slice(0, 200),
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      status: 'pending',
      ...encrypted,
    });

    await recordAudit({
      req,
      action: 'prescription.upload',
      targetType: 'prescription',
      targetId: prescription._id,
      after: { mimeType: prescription.mimeType, sizeBytes: prescription.sizeBytes },
    });

    res.status(201).json({
      prescription,
      state: await prescriptionStateFor(req.user._id),
    });
  })
);

// GET /api/prescriptions — history (newest first) and the current status.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const prescriptions = await Prescription.find({ user: req.user._id }).sort({
      created_at: -1,
    });
    res.json({
      prescriptions,
      state: await prescriptionStateFor(req.user._id),
    });
  })
);

// GET /api/prescriptions/:id/file — decrypted bytes, owner (or verifier) only.
router.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw httpError(404, 'Prescription not found');
    }

    const file = await loadPrescriptionFile({ id: req.params.id, viewer: req.user });
    sendPrescriptionFile(res, file);
  })
);

module.exports = router;
