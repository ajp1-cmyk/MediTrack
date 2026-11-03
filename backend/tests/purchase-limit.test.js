// Tests for the daily purchase cap (SRS FR-1.4 fair-use limit, NFR-2.2).
//
//   cd backend && npm test
//
// The cap lives in `lib/purchaseLimit.js` and is enforced in
// `createOrderFromCart()` before any stock counter moves. Every other suite
// sets DAILY_PURCHASE_LIMIT=0 because a cap would make their order counts
// depend on execution order; this file is the one that exercises it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-purchase-limit';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-purchase-limit';
process.env.PAYMENT_MOCK_DELAY_MS = '0';
process.env.INVENTORY_AUTO_REPLENISH = 'off';
process.env.DAILY_PURCHASE_LIMIT = '5';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { createUser } = require('./support');
const Order = require('../models/Order');
const {
  DEFAULT_DAILY_LIMIT,
  COUNTED_STATUSES,
  dailyPurchaseLimit,
  startOfUtcDay,
  endOfUtcDay,
  unitsOrderedToday,
  purchaseLimitSummary,
} = require('../lib/purchaseLimit');

let mongo;
let server;
let baseUrl;

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  let payload;

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const ADMIN = { name: 'Ada Admin', email: 'limit-admin@meditrack.test', password: 'admin-pass-123' };
const CUSTOMER_A = {
  name: 'Cara Customer',
  email: 'limit-customer-a@meditrack.test',
  password: 'customer-pass-123',
};
const CUSTOMER_B = {
  name: 'Owen Other',
  email: 'limit-customer-b@meditrack.test',
  password: 'customer-pass-123',
};

const SHIPPING = {
  fullName: 'Cara Customer',
  phone: '9876543210',
  email: 'limit-customer-a@meditrack.test',
  line1: '1 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

let adminToken;
let tokenA;
let tokenB;
let medicine;

async function login(account) {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

/** Empty the account's server-side cart (holds are released with it). */
async function clearCart(token) {
  const res = await api('/api/cart', { method: 'DELETE', token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

async function addToCart(token, medicineId, quantity) {
  const res = await api('/api/cart/items', {
    method: 'POST',
    token,
    body: { medicineId, quantity },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function checkout(token) {
  return api('/api/orders', {
    method: 'POST',
    token,
    body: { shippingAddress: SHIPPING },
  });
}

async function stockOf(id) {
  const res = await api(`/api/medicines/${id}`);
  assert.equal(res.status, 200);
  return res.body.stock;
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_purchase_limit_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createUser({ ...ADMIN, role: 'admin' });
  await createUser({ ...CUSTOMER_A, role: 'customer' });
  await createUser({ ...CUSTOMER_B, role: 'customer' });

  adminToken = await login(ADMIN);
  tokenA = await login(CUSTOMER_A);
  tokenB = await login(CUSTOMER_B);

  // The medicine route is multipart-only.
  const form = new FormData();
  form.append('name', 'Paracetamol 500mg');
  form.append('mfd', '2025-01-15');
  form.append('exp', '2028-01-15');
  form.append('price', '100');
  form.append('stock', '200');
  const upload = await fetch(`${baseUrl}/api/medicines`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  });
  const uploadText = await upload.text();
  assert.equal(upload.status, 201, uploadText);
  medicine = JSON.parse(uploadText);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

// ------------------------------------------------------------ configuration

test('the configured cap defaults to 10 and can be disabled with 0', () => {
  const original = process.env.DAILY_PURCHASE_LIMIT;

  try {
    delete process.env.DAILY_PURCHASE_LIMIT;
    assert.equal(dailyPurchaseLimit(), DEFAULT_DAILY_LIMIT);
    assert.equal(DEFAULT_DAILY_LIMIT, 10);

    process.env.DAILY_PURCHASE_LIMIT = '';
    assert.equal(dailyPurchaseLimit(), DEFAULT_DAILY_LIMIT);

    process.env.DAILY_PURCHASE_LIMIT = '0';
    assert.equal(dailyPurchaseLimit(), 0, '0 disables the cap');

    process.env.DAILY_PURCHASE_LIMIT = '25';
    assert.equal(dailyPurchaseLimit(), 25);

    // A typo must not silently remove the protection.
    for (const invalid of ['abc', '-5', '2.5', '10.0', ' ']) {
      process.env.DAILY_PURCHASE_LIMIT = invalid;
      assert.equal(dailyPurchaseLimit(), DEFAULT_DAILY_LIMIT, `invalid value: ${invalid}`);
    }
  } finally {
    process.env.DAILY_PURCHASE_LIMIT = original === undefined ? '5' : original;
  }
});

test('the allowance resets at midnight UTC', () => {
  const now = new Date('2026-03-15T18:45:12.000Z');
  assert.equal(startOfUtcDay(now).toISOString(), '2026-03-15T00:00:00.000Z');
  assert.equal(endOfUtcDay(now).toISOString(), '2026-03-16T00:00:00.000Z');

  // Crossing midnight in UTC, even though it may still be the previous day
  // locally.
  const lateNight = new Date('2026-03-15T23:59:59.999Z');
  assert.equal(startOfUtcDay(lateNight).toISOString(), '2026-03-15T00:00:00.000Z');
  assert.equal(endOfUtcDay(lateNight).toISOString(), '2026-03-16T00:00:00.000Z');

  const nextDay = new Date('2026-03-16T00:00:00.000Z');
  assert.equal(startOfUtcDay(nextDay).toISOString(), '2026-03-16T00:00:00.000Z');
});

// ------------------------------------------------------------- aggregation

const SHIPPING_DOC = {
  fullName: 'Cara Customer',
  phone: '9876543210',
  email: 'limit-customer-a@meditrack.test',
  line1: '1 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

/** Insert a raw order so `created_at` can be pinned to an arbitrary instant. */
async function insertOrder({ user, quantity, status, createdAt }) {
  await Order.collection.insertOne({
    orderNumber: `T-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    user: user._id,
    items: [
      {
        medicine: new mongoose.Types.ObjectId(),
        name: 'Paracetamol 500mg',
        image: null,
        unitPrice: 100,
        quantity,
        lineTotal: 100 * quantity,
      },
    ],
    shippingAddress: SHIPPING_DOC,
    totals: {
      subtotal: 100 * quantity,
      tax: 5 * quantity,
      deliveryFee: 0,
      total: 105 * quantity,
      itemCount: quantity,
      currency: 'INR',
      taxRate: 0.05,
      freeDeliveryOver: 499,
    },
    status,
    payment: { provider: 'mock', method: null, status: 'pending' },
    expiresAt: null,
    prescription: null,
    prescriptionValidUntil: null,
    created_at: createdAt,
    updated_at: createdAt,
    __v: 0,
  });
}

test('units ordered today counts whole units of live orders only', async () => {
  // A dedicated account keeps the count independent of the HTTP tests.
  const user = await createUser({
    name: 'Aggregate User',
    email: 'limit-aggregate@meditrack.test',
    password: 'customer-pass-123',
    role: 'customer',
  });

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  await insertOrder({ user, quantity: 2, status: 'paid', createdAt: now });
  await insertOrder({ user, quantity: 3, status: 'pending_payment', createdAt: now });
  // These must not count: cancelled/expired released their stock, and
  // yesterday's orders belong to a previous allowance.
  await insertOrder({ user, quantity: 100, status: 'cancelled', createdAt: now });
  await insertOrder({ user, quantity: 100, status: 'expired', createdAt: now });
  await insertOrder({ user, quantity: 100, status: 'paid', createdAt: yesterday });

  assert.equal(await unitsOrderedToday(user._id, now), 5);
  assert.deepEqual(
    [...COUNTED_STATUSES].sort(),
    ['delivered', 'paid', 'pending_payment', 'processing', 'shipped']
  );

  const summary = await purchaseLimitSummary(user._id, now);
  assert.equal(summary.enabled, true);
  assert.equal(summary.limit, 5);
  assert.equal(summary.used, 5);
  assert.equal(summary.remaining, 0, 'remaining never goes below zero');
  assert.equal(summary.resetsAt.toISOString(), endOfUtcDay(now).toISOString());
});

test('a guest cart has no allowance to show', async () => {
  const res = await api('/api/cart');
  assert.equal(res.status, 200);
  assert.equal(res.body.purchaseLimit, null);
  assert.equal(res.body.requiresPrescription, false);
});

// ----------------------------------------------------------- cart / checkout

test('the cart shows the allowance before the current cart', async () => {
  await clearCart(tokenA);
  const cart = await addToCart(tokenA, medicine.id, 2);

  assert.equal(cart.purchaseLimit.enabled, true);
  assert.equal(cart.purchaseLimit.limit, 5);
  assert.equal(cart.purchaseLimit.used, 0);
  assert.equal(cart.purchaseLimit.remaining, 5);
  assert.match(cart.purchaseLimit.resetsAt, /T00:00:00\.000Z$/);
});

test('an order consumes allowance for the rest of the UTC day', async () => {
  // Customer A has 2 units in the cart from the previous test.
  const placed = await checkout(tokenA);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  assert.equal(placed.body.status, 'pending_payment');

  const empty = await clearCart(tokenA);
  assert.equal(empty.itemCount, 0);
  assert.equal(empty.purchaseLimit, null, 'an empty cart has no allowance to show');

  // Adding a line brings the allowance back, with today's usage included.
  const refilled = await addToCart(tokenA, medicine.id, 1);
  assert.equal(refilled.purchaseLimit.used, 2);
  assert.equal(refilled.purchaseLimit.remaining, 3);
});

test('checkout is refused above the cap and changes no stock', async () => {
  await clearCart(tokenA);
  await addToCart(tokenA, medicine.id, 4); // 2 already used today → 6 > 5

  const stockBefore = await stockOf(medicine.id);
  const ordersBefore = (await api('/api/orders', { token: tokenA })).body.length;

  const refused = await checkout(tokenA);
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.match(refused.body.error, /Daily purchase limit/i);
  assert.match(refused.body.error, /at most 5 unit/i);
  assert.match(refused.body.error, /already ordered 2/i);

  assert.equal(await stockOf(medicine.id), stockBefore, 'stock must not move');
  assert.equal(
    (await api('/api/orders', { token: tokenA })).body.length,
    ordersBefore,
    'no order may be created'
  );

  const cart = await api('/api/cart', { token: tokenA });
  assert.equal(cart.body.itemCount, 4, 'the refused cart is left intact');
  assert.equal(cart.body.purchaseLimit.remaining, 3, 'the allowance is unchanged');
});

test('ordering exactly the remaining allowance succeeds; one more is refused', async () => {
  await clearCart(tokenB);
  await addToCart(tokenB, medicine.id, 5);

  const atCap = await checkout(tokenB);
  assert.equal(atCap.status, 201, JSON.stringify(atCap.body));
  assert.equal(atCap.body.totals.itemCount, 5);

  await clearCart(tokenB);
  await addToCart(tokenB, medicine.id, 1);

  const overCap = await checkout(tokenB);
  assert.equal(overCap.status, 409, JSON.stringify(overCap.body));
  assert.match(overCap.body.error, /already ordered 5/i);
  assert.match(overCap.body.error, /midnight UTC/i);

  const cart = await api('/api/cart', { token: tokenB });
  assert.equal(cart.body.purchaseLimit.used, 5);
  assert.equal(cart.body.purchaseLimit.remaining, 0);
});

test('a cancelled order stops counting towards the cap', async () => {
  await createUser({
    name: 'Cancel User',
    email: 'limit-cancel@meditrack.test',
    password: 'customer-pass-123',
    role: 'customer',
  });
  const token = await login({
    email: 'limit-cancel@meditrack.test',
    password: 'customer-pass-123',
  });

  await clearCart(token);
  await addToCart(token, medicine.id, 4);
  const first = await checkout(token);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal((await api('/api/orders', { token })).body.length, 1);

  const cancelled = await api(`/api/orders/${first.body.id}/cancel`, {
    method: 'POST',
    token,
    body: {},
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, 'cancelled');

  // 4 cancelled + 4 new is over the cap unless the cancelled order is ignored.
  await clearCart(token);
  await addToCart(token, medicine.id, 4);
  const second = await checkout(token);
  assert.equal(second.status, 201, JSON.stringify(second.body));

  const cart = await addToCart(token, medicine.id, 1);
  assert.equal(cart.purchaseLimit.used, 4);
});

test('DAILY_PURCHASE_LIMIT=0 disables the cap and the summary', async () => {
  process.env.DAILY_PURCHASE_LIMIT = '0';
  try {
    await clearCart(tokenA);

    const cart = await addToCart(tokenA, medicine.id, 5);
    assert.equal(cart.purchaseLimit.enabled, false);
    assert.equal(cart.purchaseLimit.remaining, null);
    assert.equal(cart.purchaseLimit.used, 2, 'usage is still reported');

    // Customer A has 2 units counted; without the cap these 5 go through.
    const placed = await checkout(tokenA);
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.equal(placed.body.totals.itemCount, 5);
  } finally {
    process.env.DAILY_PURCHASE_LIMIT = '5';
  }
});

test('a summary for an unknown user is disabled and empty', async () => {
  const summary = await purchaseLimitSummary(null);
  assert.equal(summary.enabled, false);
  assert.equal(summary.limit, 5);
  assert.equal(summary.used, 0);
  assert.equal(summary.remaining, 5);
  assert.equal(await unitsOrderedToday(null), 0);
});
