// Medicine stock routes (MongoDB / Mongoose).
//
// Reading stock is public (the landing page lists it for everyone).
// Creating / updating / deleting stock requires a signed-in admin.
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const Medicine = require('../models/Medicine');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { recordAudit } = require('../lib/audit');
const { httpError, asyncHandler } = require('../lib/errors');

const router = express.Router();

// Where uploaded medicine images are stored (disk locally, Blobs on Netlify).
const { UPLOADS_DIR, persistUpload, removeUpload } = require('../lib/imageStore');

// Configure multer to save files to disk with a unique name.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `medicine-${uniqueSuffix}${ext}`);
  },
});

// Only allow image files.
const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    return cb(null, true);
  }
  const err = new Error('Only image files (JPEG, PNG, GIF, WEBP) are allowed');
  err.status = 400;
  return cb(err);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});

// Fields a client may change after creation.
const UPDATABLE_FIELDS = ['name', 'mfd', 'exp', 'price', 'stock', 'category', 'description'];
// Every field PATCH /api/medicines/:id understands (used in the error message).
const PATCHABLE_FIELDS = [...UPDATABLE_FIELDS, 'prescriptionRequired', 'refillDays', 'image'];

/** Escape a user-supplied string before it is used inside a RegExp. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Read a boolean sent in a multipart/form-data body. Form fields are always
 * strings, and Mongoose would cast the string "false" to `true`, so parse it
 * explicitly.
 */
function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'on', 'yes'].includes(String(value).trim().toLowerCase());
}

/** Optional whole number; returns undefined when the client left the field out. */
function parseOptionalInteger(value, field, { min, max }) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw httpError(400, `${field} must be a whole number between ${min} and ${max}`);
  }
  return parsed;
}

/** The stock fields we copy into the audit log (never credentials). */
function medicineSnapshot(medicine) {
  return {
    name: medicine.name,
    mfd: medicine.mfd,
    exp: medicine.exp,
    price: medicine.price,
    stock: medicine.stock,
    prescriptionRequired: medicine.prescriptionRequired,
    refillDays: medicine.refillDays,
    category: medicine.category,
    description: medicine.description,
    image: medicine.image,
  };
}

// Authentication + the catalog:write permission (admin and staff), required by
// every write operation. Customers get 403.
const canEditStock = [requireAuth, requirePermission('catalog:write')];

// GET /api/medicines?q=&category= — public stock list (newest first).
//
// `q` matches the name, category or description (case-insensitive substring);
// `category` is an exact, case-insensitive match. Both are optional, so the
// storefront can use the same endpoint for browsing and searching.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};

    const q = String(req.query.q || '').trim();
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: pattern }, { category: pattern }, { description: pattern }];
    }

    const category = String(req.query.category || '').trim();
    if (category) {
      filter.category = new RegExp(`^${escapeRegex(category)}$`, 'i');
    }

    const medicines = await Medicine.find(filter).sort({ created_at: -1 });
    res.json(medicines);
  })
);

// GET /api/medicines/categories — distinct categories for the filter dropdown.
// Declared before `/:id` so "categories" is not treated as an object id.
router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await Medicine.distinct('category');
    res.json(
      categories
        .filter((category) => typeof category === 'string' && category.trim())
        .sort((a, b) => a.localeCompare(b))
    );
  })
);

// GET /api/medicines/:id — one product for the detail page.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw httpError(404, 'Medicine not found');
    }

    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) {
      throw httpError(404, 'Medicine not found');
    }
    res.json(medicine);
  })
);

// POST /api/medicines - add a new medicine (multipart/form-data, admin only)
router.post(
  '/',
  canEditStock,
  upload.single('image'),
  persistUpload,
  asyncHandler(async (req, res) => {
    const { name, mfd, exp, price, stock } = req.body;

    if (!name || !mfd || !exp || price === undefined || stock === undefined) {
      throw httpError(400, 'All fields (name, mfd, exp, price, stock) are required');
    }

    const priceNum = Number(price);
    const stockNum = Number(stock);

    if (String(price).trim() === '' || !Number.isFinite(priceNum) || priceNum < 0) {
      throw httpError(400, 'Price must be a valid non-negative number');
    }
    if (String(stock).trim() === '' || !Number.isInteger(stockNum) || stockNum < 0) {
      throw httpError(400, 'Stock must be a valid non-negative whole number');
    }

    const refillDays = parseOptionalInteger(req.body.refillDays, 'refillDays', {
      min: 1,
      max: 365,
    });

    const medicine = await Medicine.create({
      name: name.trim(),
      mfd,
      exp,
      price: priceNum,
      stock: stockNum,
      prescriptionRequired: parseBoolean(req.body.prescriptionRequired),
      ...(refillDays === undefined ? {} : { refillDays }),
      category: String(req.body.category || '').trim(),
      description: String(req.body.description || '').trim(),
      image: req.file ? req.file.filename : null,
      createdBy: req.user._id,
    });

    await recordAudit({
      req,
      action: 'medicine.create',
      targetType: 'medicine',
      targetId: medicine._id,
      after: medicineSnapshot(medicine),
    });

    res.status(201).json(medicine);
  })
);

// PATCH /api/medicines/:id - update details and/or the stock quantity (admin/staff)
router.patch(
  '/:id',
  canEditStock,
  upload.single('image'),
  persistUpload,
  asyncHandler(async (req, res) => {
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) {
      throw httpError(404, 'Medicine not found');
    }

    const before = medicineSnapshot(medicine);

    let changed = false;
    for (const field of UPDATABLE_FIELDS) {
      const value = req.body[field];
      if (value === undefined) continue;
      // Mongoose casts strings to Number and runs the schema validators on save.
      medicine.set(field, typeof value === 'string' ? value.trim() : value);
      changed = true;
    }

    // "Is this prescription-only?" and the refill cycle are edited from the same
    // forms, so parse them here instead of letting Mongoose guess.
    if (req.body.prescriptionRequired !== undefined) {
      medicine.prescriptionRequired = parseBoolean(req.body.prescriptionRequired);
      changed = true;
    }
    const refillDays = parseOptionalInteger(req.body.refillDays, 'refillDays', {
      min: 1,
      max: 365,
    });
    if (refillDays !== undefined) {
      medicine.refillDays = refillDays;
      changed = true;
    }

    let replacedImage = null;
    if (req.file) {
      replacedImage = medicine.image;
      medicine.image = req.file.filename;
      changed = true;
    }

    if (!changed) {
      throw httpError(
        400,
        `Provide at least one field to update (${PATCHABLE_FIELDS.join(', ')})`
      );
    }

    await medicine.save();
    removeUpload(replacedImage);

    await recordAudit({
      req,
      action: 'medicine.update',
      targetType: 'medicine',
      targetId: medicine._id,
      before,
      after: medicineSnapshot(medicine),
    });

    res.json(medicine);
  })
);

// DELETE /api/medicines/:id - remove a medicine from stock (admin/staff)
router.delete(
  '/:id',
  canEditStock,
  asyncHandler(async (req, res) => {
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) {
      throw httpError(404, 'Medicine not found');
    }

    const before = medicineSnapshot(medicine);

    await medicine.deleteOne();
    removeUpload(medicine.image);

    await recordAudit({
      req,
      action: 'medicine.delete',
      targetType: 'medicine',
      targetId: medicine._id,
      before,
    });

    res.json({ success: true, id: medicine._id.toString() });
  })
);

module.exports = router;
