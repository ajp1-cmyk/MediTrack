// End-to-end tests for the MediTrack stock API, auth and authorisation.
//
// Runs real HTTP requests against a real Express server backed by a real
// MongoDB instance started in-memory by mongodb-memory-server:
//
//   cd backend && npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
process.env.JWT_EXPIRES_IN = '1h';

const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;
let server;
let baseUrl;

/** fetch helper that understands JSON, multipart bodies and Bearer tokens. */
async function api(path, { method = 'GET', token, body, form, formData } = {}) {
  const headers = {};
  let payload;

  if (formData) {
    payload = formData;
  } else if (form) {
    payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (value !== undefined && value !== null) payload.append(key, value);
    });
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const medicineFields = (overrides = {}) => ({
  name: 'Dettol Liquid',
  mfd: '2025-01-15',
  exp: '2027-01-15',
  price: '120.50',
  stock: '50',
  ...overrides,
});

const ADMIN = { name: 'Ada Admin', email: 'admin@meditrack.test', password: 'admin-pass-123' };
const STAFF = { name: 'Sam Staff', email: 'staff@meditrack.test', password: 'staff-pass-123' };

let adminToken;
let staffToken;
let createdId;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

// ---------------------------------------------------------------- health

test('GET /api/health reports a connected database', async () => {
  const res = await api('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.database, 'connected');
});

// ------------------------------------------------------- public read access

test('GET /api/medicines is public and starts empty', async () => {
  const res = await api('/api/medicines');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

// ------------------------------------------------------------- auth: setup

test('first registered account becomes the admin (bootstrap)', async () => {
  const res = await api('/api/auth/register', { method: 'POST', body: ADMIN });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.user.role, 'admin');
  assert.ok(res.body.token, 'expected a JWT');
  assert.equal(res.body.user.passwordHash, undefined, 'hash must never be returned');
  adminToken = res.body.token;
});

test('short passwords are rejected', async () => {
  const res = await api('/api/auth/register', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Weak', email: 'weak@meditrack.test', password: 'short' },
  });
  assert.equal(res.status, 400);
});

test('an admin can create a staff account', async () => {
  const res = await api('/api/auth/register', { method: 'POST', token: adminToken, body: STAFF });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.user.role, 'staff');
  staffToken = res.body.token;
});

test('anonymous users cannot register once an account exists', async () => {
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Mallory', email: 'mallory@meditrack.test', password: 'mallory-pass-1' },
  });
  assert.equal(res.status, 401);
});

test('duplicate emails are rejected with 409', async () => {
  const res = await api('/api/auth/register', { method: 'POST', token: adminToken, body: ADMIN });
  assert.equal(res.status, 409);
});

// -------------------------------------------------------------- auth: login

test('login returns a token and /api/auth/me returns the user', async () => {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN.email, password: ADMIN.password },
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));

  const me = await api('/api/auth/me', { token: login.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, ADMIN.email);
  assert.equal(me.body.user.role, 'admin');
});

test('login with a wrong password is rejected', async () => {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN.email, password: 'not-the-password' },
  });
  assert.equal(res.status, 401);
});

test('a garbage token is rejected', async () => {
  const res = await api('/api/auth/me', { token: 'not.a.real.token' });
  assert.equal(res.status, 401);
});

// ---------------------------------------------------- stock writes: authz

test('POST /api/medicines without a token is 401', async () => {
  const res = await api('/api/medicines', { method: 'POST', form: medicineFields() });
  assert.equal(res.status, 401);
});

test('POST /api/medicines as staff is 403 (only admins may update stock)', async () => {
  const res = await api('/api/medicines', {
    method: 'POST',
    token: staffToken,
    form: medicineFields(),
  });
  assert.equal(res.status, 403);
});

test('admin can add a medicine', async () => {
  const res = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields(),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.id, 'expected an id mapped from _id');
  assert.equal(res.body._id, undefined, '_id must be mapped to id');
  assert.equal(res.body.name, 'Dettol Liquid');
  assert.equal(res.body.price, 120.5);
  assert.equal(res.body.stock, 50);
  assert.equal(res.body.image, null);
  createdId = res.body.id;
});

test('invalid stock and price values are rejected', async () => {
  const badStock = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields({ stock: '12.5' }),
  });
  assert.equal(badStock.status, 400);

  const negativePrice = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields({ price: '-1' }),
  });
  assert.equal(negativePrice.status, 400);
});

test('exp earlier than mfd is rejected by the schema', async () => {
  const res = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields({ mfd: '2026-05-01', exp: '2026-04-01' }),
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /exp cannot be earlier than mfd/);
});

test('image upload stores the file, non-images are rejected', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
  );

  const formData = new FormData();
  Object.entries(medicineFields({ name: 'With Image' })).forEach(([k, v]) => formData.append(k, v));
  formData.append('image', new Blob([png], { type: 'image/png' }), 'pill.png');

  const ok = await api('/api/medicines', { method: 'POST', token: adminToken, formData });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.match(ok.body.image, /^medicine-\d+-\d+\.png$/);

  const served = await fetch(`${baseUrl}/uploads/${ok.body.image}`);
  assert.equal(served.status, 200);

  const badForm = new FormData();
  Object.entries(medicineFields({ name: 'Bad Upload' })).forEach(([k, v]) => badForm.append(k, v));
  badForm.append('image', new Blob(['not an image'], { type: 'text/plain' }), 'notes.txt');

  const rejected = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    formData: badForm,
  });
  assert.equal(rejected.status, 400, JSON.stringify(rejected.body));

  // Leave only the original medicine behind so later counts stay predictable.
  const list = await api('/api/medicines');
  for (const row of list.body.filter((m) => m.name !== 'Dettol Liquid')) {
    const removed = await api(`/api/medicines/${row.id}`, { method: 'DELETE', token: adminToken });
    assert.equal(removed.status, 200);
  }
});

// ------------------------------------------------- stock read + update

test('GET /api/medicines/:id returns one medicine, unknown ids are 404', async () => {
  const found = await api(`/api/medicines/${createdId}`);
  assert.equal(found.status, 200);
  assert.equal(found.body.id, createdId);

  const missing = await api(`/api/medicines/${new mongoose.Types.ObjectId()}`);
  assert.equal(missing.status, 404);
});

test('staff cannot update stock, admin can', async () => {
  const denied = await api(`/api/medicines/${createdId}`, {
    method: 'PATCH',
    token: staffToken,
    body: { stock: 10 },
  });
  assert.equal(denied.status, 403);

  const updated = await api(`/api/medicines/${createdId}`, {
    method: 'PATCH',
    token: adminToken,
    body: { stock: 10, price: 99.99 },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.stock, 10);
  assert.equal(updated.body.price, 99.99);
  assert.ok(updated.body.updated_at, 'expected an updated_at timestamp');
});

test('PATCH with no fields is a 400', async () => {
  const res = await api(`/api/medicines/${createdId}`, {
    method: 'PATCH',
    token: adminToken,
    body: {},
  });
  assert.equal(res.status, 400);
});

test('the stock list is sorted newest first', async () => {
  await new Promise((resolve) => setTimeout(resolve, 15)); // distinct created_at
  const added = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields({ name: 'Newest' }),
  });
  assert.equal(added.status, 201);

  const res = await api('/api/medicines');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.body[0].name, 'Newest');
});

test('stored documents keep integer stock and a createdBy reference', async () => {
  const Medicine = require('../models/Medicine');
  const rows = await Medicine.find().lean();
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(Number.isInteger(row.stock), true);
    assert.ok(row.createdBy instanceof mongoose.Types.ObjectId);
  }
});

// ------------------------------------------------------------- user admin

test('only admins can list users', async () => {
  const denied = await api('/api/auth/users', { token: staffToken });
  assert.equal(denied.status, 403);

  const users = await api('/api/auth/users', { token: adminToken });
  assert.equal(users.status, 200);
  assert.equal(users.body.length, 2);
  assert.deepEqual(
    users.body.map((u) => u.role).sort(),
    ['admin', 'staff']
  );
  assert.equal(users.body[0].passwordHash, undefined);
});

test('an admin can promote a staff member to admin, and demote them again', async () => {
  const users = await api('/api/auth/users', { token: adminToken });
  const sam = users.body.find((u) => u.email === STAFF.email);

  const promoted = await api(`/api/auth/users/${sam.id}/role`, {
    method: 'PATCH',
    token: adminToken,
    body: { role: 'admin' },
  });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.equal(promoted.body.role, 'admin');

  // The new role applies immediately (the user is re-read from the DB per request).
  const canNowWrite = await api('/api/medicines', {
    method: 'POST',
    token: staffToken,
    form: medicineFields({ name: 'Promoted Staff Item' }),
  });
  assert.equal(canNowWrite.status, 201);
  await api(`/api/medicines/${canNowWrite.body.id}`, { method: 'DELETE', token: adminToken });

  const demoted = await api(`/api/auth/users/${sam.id}/role`, {
    method: 'PATCH',
    token: adminToken,
    body: { role: 'staff' },
  });
  assert.equal(demoted.body.role, 'staff');
});

test('an admin cannot demote themselves', async () => {
  const users = await api('/api/auth/users', { token: adminToken });
  const admin = users.body.find((u) => u.email === ADMIN.email);

  const res = await api(`/api/auth/users/${admin.id}/role`, {
    method: 'PATCH',
    token: adminToken,
    body: { role: 'staff' },
  });
  assert.equal(res.status, 400);
});

test('invalid roles are rejected', async () => {
  const users = await api('/api/auth/users', { token: adminToken });
  const sam = users.body.find((u) => u.email === STAFF.email);

  const res = await api(`/api/auth/users/${sam.id}/role`, {
    method: 'PATCH',
    token: adminToken,
    body: { role: 'superuser' },
  });
  assert.equal(res.status, 400);
});

// ------------------------------------------------------------------ delete

test('staff cannot delete stock, admin can', async () => {
  const denied = await api(`/api/medicines/${createdId}`, { method: 'DELETE', token: staffToken });
  assert.equal(denied.status, 403);

  const removed = await api(`/api/medicines/${createdId}`, { method: 'DELETE', token: adminToken });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.success, true);

  const gone = await api(`/api/medicines/${createdId}`);
  assert.equal(gone.status, 404);
});

test('unknown API routes return a JSON 404', async () => {
  const res = await api('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'API route not found');
});
