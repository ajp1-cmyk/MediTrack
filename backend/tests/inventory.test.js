// Tests for inventory replenishment (SRS FR-1.1) and the new Rx / refill
// fields on a medicine (used by FR-1.4 and FR-2.5).
//
//   cd backend && npm test
//
// The background sweep is switched off for this file so every assertion is
// deterministic; the sweeper itself is exercised by calling the same function
// the timer calls (`replenishLowStock`).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-inventory';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-inventory';
process.env.PAYMENT_MOCK_DELAY_MS = '0';
process.env.INVENTORY_AUTO_REPLENISH = 'off';
delete process.env.LOW_STOCK_WATERMARK;
delete process.env.REPLENISH_TO;

const { MongoMemoryServer } = require('mongodb-memory-server');
const { createUser } = require('./support');

let mongo;
let server;
let baseUrl;

async function api(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  let payload;

  if (form) {
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
  name: 'Paracetamol 500mg',
  mfd: '2025-01-15',
  exp: '2028-01-15',
  price: '25',
  stock: '50',
  ...overrides,
});

const ADMIN = { name: 'Ada Admin', email: 'inv-admin@meditrack.test', password: 'admin-pass-123' };
const STAFF = { name: 'Sam Staff', email: 'inv-staff@meditrack.test', password: 'staff-pass-123' };
const CUSTOMER = {
  name: 'Cara Customer',
  email: 'inv-customer@meditrack.test',
  password: 'customer-pass-123',
};

let adminToken;
let staffToken;
let customerToken;

/** Create a medicine through the API and return its JSON body. */
async function addMedicine(overrides = {}) {
  const res = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields(overrides),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

/** Current stock of a medicine, read through the public API. */
async function stockOf(id) {
  const res = await api(`/api/medicines/${id}`);
  assert.equal(res.status, 200);
  return res.body.stock;
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_inventory_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createUser({ ...ADMIN, role: 'admin' });
  await createUser({ ...STAFF, role: 'staff' });
  await createUser({ ...CUSTOMER, role: 'customer' });

  const login = async (account) => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: account.email, password: account.password },
    });
    assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
    return res.body.token;
  };

  adminToken = await login(ADMIN);
  staffToken = await login(STAFF);
  customerToken = await login(CUSTOMER);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

// ------------------------------------------------------------ replenishment

test('a medicine at the watermark is restocked to the target level', async () => {
  const medicine = await addMedicine({ name: 'Watermark Tablet', stock: '10' });

  const res = await api('/api/admin/inventory/replenish', {
    method: 'POST',
    token: staffToken,
    body: {},
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.watermark, 10);
  assert.equal(res.body.target, 100);

  const restocked = res.body.restocked.find((row) => row.id === medicine.id);
  assert.ok(restocked, 'the medicine should appear in the restock report');
  assert.equal(restocked.from, 10);
  assert.equal(restocked.to, 100);
  assert.equal(await stockOf(medicine.id), 100);
});

test('medicine above the watermark is left alone', async () => {
  const medicine = await addMedicine({ name: 'Healthy Stock', stock: '25' });

  const res = await api('/api/admin/inventory/replenish', {
    method: 'POST',
    token: adminToken,
    body: {},
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.restocked.some((row) => row.id === medicine.id), false);
  assert.equal(await stockOf(medicine.id), 25);
});

test('an out-of-stock medicine is restocked too', async () => {
  const medicine = await addMedicine({ name: 'Sold Out Syrup', stock: '0' });

  await api('/api/admin/inventory/replenish', { method: 'POST', token: adminToken, body: {} });

  assert.equal(await stockOf(medicine.id), 100);
});

test('expired medicine is never restocked', async () => {
  const medicine = await addMedicine({
    name: 'Expired Drops',
    mfd: '2019-01-01',
    exp: '2020-01-01',
    stock: '3',
  });

  const res = await api('/api/admin/inventory/replenish', {
    method: 'POST',
    token: adminToken,
    body: {},
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.restocked.some((row) => row.id === medicine.id), false);
  assert.equal(await stockOf(medicine.id), 3, 'expired stock must stay visible to staff');
});

test('the watermark and target are configurable', async () => {
  process.env.LOW_STOCK_WATERMARK = '5';
  process.env.REPLENISH_TO = '50';
  try {
    const atWatermark = await addMedicine({ name: 'Config Low', stock: '5' });
    const above = await addMedicine({ name: 'Config Fine', stock: '6' });

    const res = await api('/api/admin/inventory/replenish', {
      method: 'POST',
      token: adminToken,
      body: {},
    });

    assert.equal(res.body.watermark, 5);
    assert.equal(res.body.target, 50);
    assert.equal(await stockOf(atWatermark.id), 50);
    assert.equal(await stockOf(above.id), 6);
  } finally {
    delete process.env.LOW_STOCK_WATERMARK;
    delete process.env.REPLENISH_TO;
  }
});

test('running the sweep twice does not restock the same row twice', async () => {
  const { replenishLowStock } = require('../lib/inventory');
  const medicine = await addMedicine({ name: 'Idempotent Capsule', stock: '2' });

  const [first, second] = await Promise.all([replenishLowStock(), replenishLowStock()]);
  const hits = [...first.restocked, ...second.restocked].filter((row) => row.id === medicine.id);

  assert.equal(hits.length, 1, 'the conditional update must win exactly once');
  assert.equal(await stockOf(medicine.id), 100, 'a second pass must not add stock again');
});

test('only staff and admins may trigger a replenishment', async () => {
  const anonymous = await api('/api/admin/inventory/replenish', { method: 'POST', body: {} });
  assert.equal(anonymous.status, 401);

  const customer = await api('/api/admin/inventory/replenish', {
    method: 'POST',
    token: customerToken,
    body: {},
  });
  assert.equal(customer.status, 403);
});

test('replenishment is written to the audit log', async () => {
  await addMedicine({ name: 'Audited Ampoule', stock: '1' });
  await api('/api/admin/inventory/replenish', { method: 'POST', token: adminToken, body: {} });

  const res = await api('/api/admin/audit?action=medicine.replenish&limit=50', {
    token: adminToken,
  });

  assert.equal(res.status, 200);
  const entry = res.body.entries.find((row) => row.targetType === 'medicine');
  assert.ok(entry, 'a medicine.replenish entry should exist');
  assert.equal(entry.action, 'medicine.replenish');
  assert.ok(entry.after && entry.after.stock, 'the new stock level is recorded');
});

test('the dashboard reports the configured watermark and low-stock count', async () => {
  const Medicine = require('../models/Medicine');
  const summary = await api('/api/admin/summary', { token: adminToken });

  assert.equal(summary.status, 200);
  assert.equal(summary.body.inventory.lowStockWatermark, 10);
  assert.equal(summary.body.inventory.replenishTo, 100);

  // The counter must match what is actually at/below the watermark. The expired
  // medicine is included on purpose: staff still has to act on that row.
  const expected = await Medicine.countDocuments({ stock: { $lte: 10 } });
  assert.equal(summary.body.lowStock, expected);
});

// ------------------------------------------------- prescription / refill data

test('a medicine records whether it needs a prescription and its refill cycle', async () => {
  const created = await addMedicine({
    name: 'Amoxicillin 500mg',
    prescriptionRequired: 'true',
    refillDays: '21',
  });

  assert.equal(created.prescriptionRequired, true);
  assert.equal(created.refillDays, 21);

  const plain = await addMedicine({ name: 'Vitamin C' });
  assert.equal(plain.prescriptionRequired, false, 'over-the-counter by default');
  assert.equal(plain.refillDays, 30, 'default refill cycle');
});

test('the prescription flag and refill cycle can be changed later', async () => {
  const created = await addMedicine({ name: 'Insulin Pen', prescriptionRequired: 'true' });

  const res = await api(`/api/medicines/${created.id}`, {
    method: 'PATCH',
    token: staffToken,
    body: { prescriptionRequired: false, refillDays: 90 },
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.prescriptionRequired, false);
  assert.equal(res.body.refillDays, 90);
});

test('an impossible refill cycle is rejected', async () => {
  const res = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields({ name: 'Bad Refill', refillDays: '0' }),
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /refillDays/i);
});

