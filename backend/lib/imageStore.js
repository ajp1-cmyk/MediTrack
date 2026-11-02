// Storage for uploaded medicine images.
//
// Locally (`node server.js`) images live in backend/uploads and are served by
// express.static. On Netlify the API runs as a serverless function whose disk
// is read-only and short-lived, so multer writes to the temp directory and the
// file is then moved into the "medicine-images" Netlify Blobs store.
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVERLESS = process.env.MEDITRACK_SERVERLESS === '1';
const STORE_NAME = 'medicine-images';

const UPLOADS_DIR = SERVERLESS
  ? path.join(os.tmpdir(), 'meditrack-uploads')
  : path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function blobStore() {
  // Loaded lazily so local development and tests never need @netlify/blobs.
  const { getStore } = require('@netlify/blobs');
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

/** Middleware: after multer, move the uploaded file into Blobs (serverless only). */
async function persistUpload(req, res, next) {
  if (!SERVERLESS || !req.file) return next();
  try {
    const data = await fs.promises.readFile(req.file.path);
    await blobStore().set(req.file.filename, data, {
      metadata: { contentType: req.file.mimetype },
    });
    fs.unlink(req.file.path, () => {});
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Delete a stored image, ignoring "already gone" errors. */
function removeUpload(filename) {
  if (!filename) return;
  if (SERVERLESS) {
    blobStore()
      .delete(filename)
      .catch(() => {});
    return;
  }
  fs.unlink(path.join(UPLOADS_DIR, filename), () => {});
}

/** Router that serves stored images under /uploads. */
function serveUploads() {
  if (!SERVERLESS) return express.static(UPLOADS_DIR);

  const router = express.Router();
  router.get('/:name', async (req, res, next) => {
    try {
      const entry = await blobStore().getWithMetadata(req.params.name, { type: 'arrayBuffer' });
      if (!entry) return res.status(404).end();
      res.set('Content-Type', entry.metadata?.contentType || 'application/octet-stream');
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(Buffer.from(entry.data));
    } catch (err) {
      return next(err);
    }
  });
  return router;
}

module.exports = { UPLOADS_DIR, persistUpload, removeUpload, serveUploads };
