const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');

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
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, GIF, WEBP) are allowed'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});

// GET /api/medicines - list all medicines (newest first)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM medicines ORDER BY created_at DESC').all();
  res.json(rows);
});

// GET /api/medicines/:id - get a single medicine
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM medicines WHERE id = ?').get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: 'Medicine not found' });
  }
  res.json(row);
});

// POST /api/medicines - add a new medicine (multipart/form-data)
router.post('/', upload.single('image'), (req, res) => {
  try {
    const { name, mfd, exp, price, stock } = req.body;

    if (!name || !mfd || !exp || price === undefined || stock === undefined) {
      return res
        .status(400)
        .json({ error: 'All fields (name, mfd, exp, price, stock) are required' });
    }

    const priceNum = parseFloat(price);
    const stockNum = parseInt(stock, 10);

    if (isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'Price must be a valid non-negative number' });
    }
    if (isNaN(stockNum) || stockNum < 0) {
      return res.status(400).json({ error: 'Stock must be a valid non-negative integer' });
    }

    const image = req.file ? req.file.filename : null;

    const result = db
      .prepare(
        'INSERT INTO medicines (name, mfd, exp, price, stock, image) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(name.trim(), mfd, exp, priceNum, stockNum, image);

    const created = db
      .prepare('SELECT * FROM medicines WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json(created);
  } catch (err) {
    // If anything fails after the file was saved, clean up the orphan file.
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
