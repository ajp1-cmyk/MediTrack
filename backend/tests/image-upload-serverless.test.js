// End-to-end test of the Netlify image pipeline.
//
// The whole app is started in serverless mode (`MEDITRACK_SERVERLESS=1`), which
// is what a Netlify Function sets: multer writes the upload to the temp
// directory, `persistUpload` moves the bytes into MongoDB and `/uploads/:name`
// serves them from there. This is the same chain `/admin/stock` uses on the
// deployed site, so it catches regressions that unit tests would miss.
//
//   cd backend && npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.MEDITRACK_SERVERLESS = '1';
process.env.JWT_SECRET = 'test-secret-serverless-upload';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-serverless-upload';
process.env.INVENTORY_AUTO_REPLENISH = 'off';
process.env.PAYMENT_MOCK_DELAY_MS = '0';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createUser } = require('./support');

let mongo;
let server;
let baseUrl;
let adminToken;
let MedicineImage;

/** fetch helper that understands JSON bodies, multipart bodies and Bearer tokens. */
async function api(path, { method = 'GET', token, body, formData } = {}) {
  const headers = {};
  let payload;

  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const ADMIN = { name: 'Ada Admin', email: 'admin@upload.test', password: 'admin-pass-123' };

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_upload_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  MedicineImage = require('../models/MedicineImage');

  await createUser({ ...ADMIN, role: 'admin' });
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN.email, password: ADMIN.password },
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  adminToken = login.body.token;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.close();
  if (mongo) await mongo.stop();
});

test('an admin image upload lands in MongoDB and /uploads serves the exact bytes', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
  );

  const formData = new FormData();
  formData.append('name', 'Serverless Image Test');
  formData.append('mfd', '2025-01-01');
  formData.append('exp', '2027-01-01');
  formData.append('price', '10');
  formData.append('stock', '5');
  formData.append('image', new Blob([png], { type: 'image/png' }), 'pill.png');

  const created = await api('/api/medicines', { method: 'POST', token: adminToken, formData });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.match(created.body.image, /^medicine-\d+-\d+\.png$/);

  // The bytes (not just the name) must be in the collection the function reads.
  const stored = await MedicineImage.findOne({ filename: created.body.image }).select('+data');
  assert.ok(stored, 'the upload must be persisted to medicineimages');
  assert.equal(stored.contentType, 'image/png');
  assert.deepEqual(Buffer.from(stored.data), png);

  const served = await fetch(`${baseUrl}/uploads/${created.body.image}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
});

test('deleting the medicine removes its stored image', async () => {
  const list = await api('/api/medicines');
  const row = list.body.find((m) => m.name === 'Serverless Image Test');
  assert.ok(row, 'the upload test row should still exist');

  const removed = await api(`/api/medicines/${row.id}`, { method: 'DELETE', token: adminToken });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  // removeUpload() is fire-and-forget, so give the delete a moment to land.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await MedicineImage.countDocuments({ filename: row.image })) === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await MedicineImage.countDocuments({ filename: row.image }), 0);
  assert.equal((await fetch(`${baseUrl}/uploads/${row.image}`)).status, 404);
});
