// Medicine stock routes (MongoDB / Mongoose).
//
// Reading stock is public (the landing page lists it for everyone).
// Creating / updating / deleting stock requires a signed-in admin.
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Medicine = require('../models/Medicine');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { recordAudit } = require('../lib/audit');
const { httpError, asyncHandler } = require('../lib/errors');

const router = express.Router();

// Where uploaded medicine images are stored.
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

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
const UPDATABLE_FIELDS = ['name', 'mfd', 'exp', 'price', 'stock'];

// Authentication + the catalog:write permission (admin and staff), required by
// every write operation. Customers get 403.
const canEditStock = [requireAuth, requirePermission('catalog:write')];

/** Delete an uploaded file from disk, ignoring "already gone" errors. */
function removeUpload(filename) {
  if (!filename) return;
  fs.unlink(path.join(UPLOADS_DIR, filename), () => {});
}

// GET /api/medicines - list all medicines (newest first)
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const medicines = await Medicine.find().sort({ created_at: -1 });
    res.json(medicines);
  })
);

// GET /api/medicines/:id - get a single medicine
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
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

    const medicine = await Medicine.create({
      name: name.trim(),
      mfd,
      exp,
      price: priceNum,
      stock: stockNum,
      image: req.file ? req.file.filename : null,
      createdBy: req.user._id,
    });

    await recordAudit({
      req,
      action: 'medicine.create',
      targetType: 'medicine',
      targetId: medicine._id,
      after: {
        name: medicine.name,
        mfd: medicine.mfd,
        exp: medicine.exp,
        price: medicine.price,
        stock: medicine.stock,
        image: medicine.image,
      },
    });

    res.status(201).json(medicine);
  })
);

// PATCH /api/medicines/:id - update details and/or the stock quantity (admin/staff)
router.patch(
  '/:id',
  canEditStock,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) {
      throw httpError(404, 'Medicine not found');
    }

    const before = {
      name: medicine.name,
      mfd: medicine.mfd,
      exp: medicine.exp,
      price: medicine.price,
      stock: medicine.stock,
      image: medicine.image,
    };

    let changed = false;
    for (const field of UPDATABLE_FIELDS) {
      const value = req.body[field];
      if (value === undefined) continue;
      // Mongoose casts strings to Number and runs the schema validators on save.
      medicine.set(field, typeof value === 'string' ? value.trim() : value);
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
        `Provide at least one field to update (${UPDATABLE_FIELDS.join(', ')}, image)`
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
      after: {
        name: medicine.name,
        mfd: medicine.mfd,
        exp: medicine.exp,
        price: medicine.price,
        stock: medicine.stock,
        image: medicine.image,
      },
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

    const before = {
      name: medicine.name,
      mfd: medicine.mfd,
      exp: medicine.exp,
      price: medicine.price,
      stock: medicine.stock,
      image: medicine.image,
    };

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
