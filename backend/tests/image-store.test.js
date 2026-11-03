// Tests for medicine image storage (backend/lib/imageStore.js and the
// `medicineimages` collection).
//
// The Netlify Function path is exercised directly: `serveUploads` is mounted on a
// throw-away Express app in "serverless" mode, so the bytes must come from
// MongoDB (or the committed demo files) rather than from express.static.
//
//   cd backend && npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Must be set before ../db and ../lib/imageStore are loaded.
process.env.JWT_SECRET = 'test-secret-images';
process.env.COOKIE_SECRET = 'test-cookie-secret-images';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const express = require('express');

let mongo;
let server;
let baseUrl;
let store;
let MedicineImage;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_images_test');

  const { connectDB } = require('../db');
  await connectDB();

  MedicineImage = require('../models/MedicineImage');
  store = require('../lib/imageStore');

  const app = express();
  app.use('/uploads', store.serveUploads({ serverless: true }));
  // Local mode: disk first, then the same MongoDB fallback used on Netlify.
  app.use('/local-uploads', store.serveUploads({ serverless: false }));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.close();
  if (mongo) await mongo.stop();
});

test('image bytes round-trip through MongoDB and stay out of plain queries', async () => {
  const bytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  await store.saveImageToDb('medicine-123-456.png', bytes, 'image/png');

  // `data` is select:false so a catalogue query never drags the bytes along.
  const plain = await MedicineImage.findOne({ filename: 'medicine-123-456.png' });
  assert.ok(plain, 'the image row should exist');
  assert.equal(plain.data, undefined);

  const stored = await store.readImageFromDb('medicine-123-456.png');
  assert.equal(stored.contentType, 'image/png');
  assert.equal(stored.sizeBytes, bytes.length);
  assert.deepEqual(Buffer.from(stored.data), bytes);

  // Re-saving the same name replaces the bytes instead of duplicating the row.
  const replacement = Buffer.from('new-bytes');
  await store.saveImageToDb('medicine-123-456.png', replacement, 'image/png');
  assert.equal(await MedicineImage.countDocuments({ filename: 'medicine-123-456.png' }), 1);
  assert.deepEqual(Buffer.from((await store.readImageFromDb('medicine-123-456.png')).data), replacement);
});

test('GET /uploads/:name serves the stored bytes with an image content type', async () => {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await store.saveImageToDb('seed-test-image.svg', bytes, 'image/svg+xml');

  const res = await fetch(`${baseUrl}/uploads/seed-test-image.svg`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
});

test('a committed demo image is served from disk when MongoDB has no copy', async () => {
  const res = await fetch(`${baseUrl}/uploads/seed-paracetamol-500mg.svg`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.subarray(0, 4).toString('utf8'), '<svg');
});

test('deleting an image removes it from the store', async () => {
  await store.saveImageToDb('medicine-delete-me.png', Buffer.from([1, 2, 3]), 'image/png');
  assert.equal((await fetch(`${baseUrl}/uploads/medicine-delete-me.png`)).status, 200);

  await store.deleteImageFromDb('medicine-delete-me.png');
  assert.equal((await fetch(`${baseUrl}/uploads/medicine-delete-me.png`)).status, 404);
});

test('unknown and traversal-style names are 404s', async () => {
  assert.equal((await fetch(`${baseUrl}/uploads/does-not-exist.png`)).status, 404);
  // Express decodes %2F before the handler sees it; basename() must neutralise it.
  assert.equal((await fetch(`${baseUrl}/uploads/..%2F..%2Fpackage.json`)).status, 404);
});

test('local mode serves disk files and falls back to MongoDB', async () => {
  // A file that exists on disk (committed demo artwork).
  const fromDisk = await fetch(`${baseUrl}/local-uploads/seed-paracetamol-500mg.svg`);
  assert.equal(fromDisk.status, 200);
  assert.equal(fromDisk.headers.get('content-type'), 'image/svg+xml');

  // An image that only exists in MongoDB — e.g. uploaded on the deployed site.
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  await store.saveImageToDb('medicine-local-only.png', bytes, 'image/png');

  const fromMongo = await fetch(`${baseUrl}/local-uploads/medicine-local-only.png`);
  assert.equal(fromMongo.status, 200);
  assert.equal(fromMongo.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await fromMongo.arrayBuffer()), bytes);
});

test('the bundled uploads directory is resolved at runtime', () => {
  const dir = store.bundledUploadsDir();
  assert.ok(fs.existsSync(path.join(dir, 'seed-paracetamol-500mg.svg')), `missing demo image in ${dir}`);
});
