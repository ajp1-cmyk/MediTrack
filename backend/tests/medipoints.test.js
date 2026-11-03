// Tests for MediPoints (SRS FR-2.4): points are credited only after a payment
// is confirmed, exactly once per order, and never for a failed or
// cash-on-delivery order whose money has not been collected yet.
//
//   cd backend && npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-medipoints';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-medipoints';
process.env.PAYMENT_MOCK_DELAY_MS = '0';
process.env.INVENTORY_AUTO_REPLENISH = 'off';
// Keep the daily purchase cap out of these assertions.
process.env.DAILY_PURCHASE_LIMIT = '0';
delete process.env.MEDIPOINTS_PER_100;

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

const ADMIN = { name: 'Ada Admin', email: 'mp-admin@meditrack.test', password: 'admin-pass-123' };
const BUYER = { name: 'Bea Buyer', email: 'mp-buyer@meditrack.test', password: 'buyer-pass-123' };
const OTHER = { name: 'Oli Other', email: 'mp-other@meditrack.test', password: 'other-pass-123' };

const SHIPPING = {
  fullName: 'Bea Buyer',
  phone: '9876543210',
  email: 'mp-buyer@meditrack.test',
  line1: '1 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

let adminToken;
let buyerToken;
let otherToken;
let medicine;

/** Put one unit of `medicine` in the buyer's cart and check out. */
async function placeOrder(quantity = 1) {
  const added = await api('/api/cart/items', {
    method: 'POST',
    token: buyerToken,
    body: { medicineId: medicine.id, quantity },
  });
  assert.equal(added.status, 201, JSON.stringify(added.body));

  const order = await api('/api/orders', {
    method: 'POST',
    token: buyerToken,
    body: { shippingAddress: SHIPPING },
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  return order.body;
}

async function balanceOf(token) {
  const res = await api('/api/me/medipoints', { token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_medipoints_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createUser({ ...ADMIN, role: 'admin' });
  await createUser({ ...BUYER, role: 'customer' });
  await createUser({ ...OTHER, role: 'customer' });

  const login = async (account) => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: account.email, password: account.password },
    });
    assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
    return res.body.token;
  };

  adminToken = await login(ADMIN);
  buyerToken = await login(BUYER);
  otherToken = await login(OTHER);

  const created = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: {
      name: 'MediPoints Paracetamol',
      mfd: '2025-01-15',
      exp: '2028-01-15',
      price: '250',
      stock: '100',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  medicine = created.body;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
// ------------------------------------------------------------------- rules

test('points are earned in whole ₹100 blocks', () => {
  const { pointsForAmount } = require('../lib/medipoints');

  assert.equal(pointsForAmount(0), 0);
  assert.equal(pointsForAmount(99.99), 0);
  assert.equal(pointsForAmount(100), 1);
  assert.equal(pointsForAmount(250), 2);
  assert.equal(pointsForAmount(1999), 19);
});

test('the points rate is configurable', () => {
  const { pointsForAmount } = require('../lib/medipoints');
  process.env.MEDIPOINTS_PER_100 = '2';
  try {
    assert.equal(pointsForAmount(250), 4);
  } finally {
    delete process.env.MEDIPOINTS_PER_100;
  }
});

// --------------------------------------------------------------- the ledger

test('the points balance requires a signed-in customer', async () => {
  const res = await api('/api/me/medipoints');
  assert.equal(res.status, 401);
});

test('a new customer starts at zero', async () => {
  const summary = await balanceOf(buyerToken);
  assert.equal(summary.balance, 0);
  assert.equal(summary.totalEarned, 0);
  assert.deepEqual(summary.entries, []);
  assert.equal(summary.pointsPer100, 1);
});

test('a confirmed payment credits points for the medicine subtotal', async () => {
  const order = await placeOrder(1);
  assert.equal(order.totals.subtotal, 250);

  const paid = await api(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    token: buyerToken,
    body: {
      method: 'card',
      details: { number: '4242 4242 4242 4242', expiry: '12/35', cvv: '123' },
    },
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.payment.status, 'succeeded');

  const summary = await balanceOf(buyerToken);
  assert.equal(summary.balance, 2, '₹250 of medicine earns 2 points');
  assert.equal(summary.totalEarned, 2);
  assert.equal(summary.entries.length, 1);
  assert.equal(summary.entries[0].type, 'earn');
  assert.equal(summary.entries[0].points, 2);
  assert.equal(summary.entries[0].order, order.id);
  assert.match(summary.entries[0].reason, /MT-\d{4}-/);
});

test('paying the same order again does not credit points twice', async () => {
  const before = await balanceOf(buyerToken);

  // The order paid in the previous test is already paid; paying again is a
  // no-op that returns the order.
  const orders = await api('/api/orders', { token: buyerToken });
  const paidOrder = orders.body.find((order) => order.status === 'paid');

  const again = await api(`/api/orders/${paidOrder.id}/pay`, {
    method: 'POST',
    token: buyerToken,
    body: { method: 'card', details: { number: '4242 4242 4242 4242', expiry: '12/35', cvv: '123' } },
  });
  assert.equal(again.status, 200);

  const after = await balanceOf(buyerToken);
  assert.equal(after.balance, before.balance);
  assert.equal(after.entries.length, before.entries.length);
});

test('a declined payment earns nothing until it is retried successfully', async () => {
  const order = await placeOrder(1);
  const before = await balanceOf(buyerToken);

  const declined = await api(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    token: buyerToken,
    body: {
      method: 'card',
      details: { number: '4000 0000 0000 0002', expiry: '12/35', cvv: '123' },
    },
  });
  assert.equal(declined.status, 402);

  const afterFailure = await balanceOf(buyerToken);
  assert.equal(afterFailure.balance, before.balance, 'a failed payment must not earn points');

  const retry = await api(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    token: buyerToken,
    body: { method: 'upi', details: { vpa: 'bea@okbank' } },
  });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));

  const afterSuccess = await balanceOf(buyerToken);
  assert.equal(afterSuccess.balance, before.balance + 2);
});

test('cash on delivery earns points only when the money is collected', async () => {
  const order = await placeOrder(1);
  const before = await balanceOf(buyerToken);

  const cod = await api(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    token: buyerToken,
    body: { method: 'cod' },
  });
  assert.equal(cod.status, 200, JSON.stringify(cod.body));
  assert.equal(cod.body.status, 'processing');
  assert.equal(cod.body.payment.status, 'pending');

  const after = await balanceOf(buyerToken);
  assert.equal(after.balance, before.balance, 'COD payment is still pending → no points yet');
});

test('points belong to the customer who paid, not to anyone else', async () => {
  const buyer = await balanceOf(buyerToken);
  const other = await balanceOf(otherToken);

  assert.ok(buyer.balance > 0);
  assert.equal(other.balance, 0);
  assert.deepEqual(other.entries, []);
});

