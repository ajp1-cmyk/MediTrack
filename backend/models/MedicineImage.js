// Medicine image bytes, stored in MongoDB.
//
// On a long-running server (`node server.js`) uploaded images live on disk in
// backend/uploads and are served by express.static. A Netlify Function has no
// permanent, writable disk — and its deployment bundle does not always contain
// backend/uploads — so the bytes are written here instead and served by
// GET /uploads/:name (see lib/imageStore.js).
//
// `Medicine.image` still holds the file *name* (e.g. "medicine-1725-123.png"), so
// the storefront keeps building the same /uploads/<name> URL whichever host runs
// the API. Keeping the bytes in MongoDB also means they survive redeploys
// without a separate Blob service.
const mongoose = require('mongoose');

const medicineImageSchema = new mongoose.Schema(
  {
    // The value stored in Medicine.image, e.g. "medicine-1725000000000-123.png"
    // or "seed-paracetamol-500mg.svg".
    filename: {
      type: String,
      required: [true, 'Image file name is required'],
      unique: true,
      trim: true,
      maxlength: [200, 'Image file name cannot be longer than 200 characters'],
    },
    contentType: {
      type: String,
      required: true,
      default: 'application/octet-stream',
    },
    sizeBytes: {
      type: Number,
      required: true,
      min: [1, 'The uploaded image is empty'],
      max: [5 * 1024 * 1024, 'Images cannot be larger than 5 MB'],
    },
    // The image bytes. `select: false` keeps them out of ordinary queries (and
    // out of JSON responses); the /uploads route asks for them explicitly.
    data: {
      type: Buffer,
      required: true,
      select: false,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.data;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model('MedicineImage', medicineImageSchema);
