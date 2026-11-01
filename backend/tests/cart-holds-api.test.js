// Route-level tests for cart soft holds (SRS FR-1.2 / FR-1.3): taking a hold
// when an item is added, releasing it when the quantity drops or the line goes
// away, lazy release of a lapsed hold, checkout converting a hold into a sale,
// and the sign-in merge.
//
//   cd backend && npm test
//
// Runs against a real Express app and an in-memory MongoDB, like the other
// suites. The background sweeps are kept out of the way (replenishment off, hold
// sweep interval an hour) so every assertion is deterministic; the sweeper
// itself is covered by tests/cart-holds.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-cart-holds-api';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-cart-holds-api';
process.env.PAYMENT_MOCK_DELAY_MS = '0';
process.env.INVENTORY_AUTO_REPLENISH = 'off';
process.env.CART_HOLD_MINUTES = '15';
process.env.CART_HOLD_SWEEP_INTERVAL_MS = '3600000';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { createUser } = require('./support');

let mongo;
let server;
let baseUrl;
let Cart;

// A tiny cookie jar: the browser does this for us in the real app.
const cookieJar = new Map();

function captureCookies(res) {
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const raw of cookies) {
    const [pair] = raw.split(';');
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1);
    const expired = /expires=thu, 01 jan 1970/i.test(raw) || value === '';
    if (expired) cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
}

function resetJar() {
  cookieJar.clear();
}

/** fetch helper with a JSON body, Bearer token and the shared cookie jar. */
async function api(path, { method = 'GET', token, body, form, useJar = true } = {}) {
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
  if (useJar && cookieJar.size > 0) {
    headers.Cookie = [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  if (useJar) captureCookies(res);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const ADMIN = { name: 'Ada Admin', email: 'holds-admin@meditrack.test', password: 'admin-pass-123' };
const CUSTOMER = {
  name: 'Cara Customer',
  email: 'holds-customer@meditrack.test',
  password: 'customer-pass-123',
};

let adminToken;
let customerToken;

const SHIPPING = {
  fullName: 'Cara Customer',
  phone: '9876543210',
  email: CUSTOMER.email,
  line1: '1 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

/** Create a medicine through the API and return its JSON body. */
async function addMedicine(overrides = {}) {
  const res = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: {
      name: 'Paracetamol 500mg',
      mfd: '2025-01-15',
      exp: '2028-01-15',
      price: '25',
      stock: '10',
      ...overrides,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

/** The two inventory counters of a medicine, read back from the API. */
async function countersOf(id) {
  const res = await api(`/api/medicines/${id}`);
  assert.equal(res.status, 200);
  return { stock: res.body.stock, held: res.body.held };
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_cart_holds_api_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  Cart = require('../models/Cart');

  await createUser({ ...ADMIN, role: 'admin' });
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
  customerToken = await login(CUSTOMER);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});


/** Move a cart line's hold deadline into the past, as CART_HOLD_MINUTES would. */
async function expireHold(medicineId) {
  const id = new mongoose.Types.ObjectId(medicineId);
  const res = await Cart.updateOne(
    { 'items.medicine': id },
    { $set: { 'items.$[line].holdExpiresAt': new Date(Date.now() - 60_000) } },
    { arrayFilters: [{ 'line.medicine': id }] }
  );
  assert.equal(res.modifiedCount, 1, 'a cart line should have been expired');
}

test('adding a medicine to the cart takes a soft hold (FR-1.2)', async () => {
  resetJar();
  const medicine = await addMedicine({ name: 'Held Paracetamol', stock: 10 });

  const res = await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 2 },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));

  const [line] = res.body.items;
  assert.equal(line.quantity, 2);
  assert.equal(line.held, 2);
  assert.equal(line.holdActive, true);
  assert.equal(line.holdExpired, false);
  assert.equal(line.issue, null);
  assert.ok(line.heldUntil, 'the line reports when its hold ends');
  assert.ok(line.holdSecondsLeft > 14 * 60, `unexpected hold: ${line.holdSecondsLeft}s`);
  assert.ok(res.body.holdExpiresAt, 'the cart reports its earliest hold');
  assert.equal(res.body.hasExpiredHolds, false);

  // The units left the shelf and are promised to this cart.
  assert.deepEqual(await countersOf(medicine.id), { stock: 8, held: 2 });
});

test('adding the same medicine again holds only the extra units', async () => {
  resetJar();
  const medicine = await addMedicine({ name: 'Repeated Paracetamol', stock: 10 });

  await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 2 },
  });
  const res = await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 1 },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.items[0].quantity, 3);
  assert.equal(res.body.items[0].held, 3);
  assert.deepEqual(await countersOf(medicine.id), { stock: 7, held: 3 });
});

test('raising the quantity holds the difference and lowering it releases it', async () => {
  resetJar();
  const medicine = await addMedicine({ name: 'Adjustable Tablets', stock: 10 });

  await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 2 },
  });

  const raised = await api(`/api/cart/items/${medicine.id}`, {
    method: 'PATCH',
    body: { quantity: 5 },
  });
  assert.equal(raised.status, 200, JSON.stringify(raised.body));
  assert.equal(raised.body.items[0].quantity, 5);
  assert.equal(raised.body.items[0].held, 5);
  assert.deepEqual(await countersOf(medicine.id), { stock: 5, held: 5 });

  const lowered = await api(`/api/cart/items/${medicine.id}`, {
    method: 'PATCH',
    body: { quantity: 3 },
  });
  assert.equal(lowered.status, 200);
  assert.deepEqual(await countersOf(medicine.id), { stock: 7, held: 3 });

  // A zero quantity is a removal: the line and its hold both go.
  const removed = await api(`/api/cart/items/${medicine.id}`, {
    method: 'PATCH',
    body: { quantity: 0 },
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.items, []);
  assert.deepEqual(await countersOf(medicine.id), { stock: 10, held: 0 });
});

test('removing a line releases its hold', async () => {
  resetJar();
  const medicine = await addMedicine({ name: 'Removed Drops', stock: 6 });

  await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 4 },
  });
  assert.deepEqual(await countersOf(medicine.id), { stock: 2, held: 4 });

  const res = await api(`/api/cart/items/${medicine.id}`, { method: 'DELETE' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
  assert.deepEqual(await countersOf(medicine.id), { stock: 6, held: 0 });
});

test('emptying the cart releases every hold it owns', async () => {
  resetJar();
  const first = await addMedicine({ name: 'Clear Cart A', stock: 5 });
  const second = await addMedicine({ name: 'Clear Cart B', stock: 5 });

  await api('/api/cart/items', { method: 'POST', body: { medicineId: first.id, quantity: 2 } });
  await api('/api/cart/items', { method: 'POST', body: { medicineId: second.id, quantity: 3 } });
  assert.deepEqual(await countersOf(first.id), { stock: 3, held: 2 });
  assert.deepEqual(await countersOf(second.id), { stock: 2, held: 3 });

  const res = await api('/api/cart', { method: 'DELETE' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
  assert.deepEqual(await countersOf(first.id), { stock: 5, held: 0 });
  assert.deepEqual(await countersOf(second.id), { stock: 5, held: 0 });
});

test('the stock limit counts the units the line already holds', async () => {
  resetJar();
  const medicine = await addMedicine({ name: 'Scarce Syrup', stock: 3 });

  const filled = await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 3 },
  });
  assert.equal(filled.status, 201, JSON.stringify(filled.body));

  const res = await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 1 },
  });

  assert.equal(res.status, 409);
  assert.match(res.body.error, /Only 3 units/i);
  assert.deepEqual(await countersOf(medicine.id), { stock: 0, held: 3 });
});


test('a hold keeps a second shopper from buying the same units', async () => {
  resetJar();
  const medicine = await addMedicine({ name: 'Single Shopper Tablets', stock: 2 });

  const first = await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 2 },
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));

  // A second visitor gets a new guest cart.
  const firstJar = [...cookieJar];
  resetJar();

  const second = await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 1 },
  });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /out of stock/i);

  // The catalogue shows nothing on the shelf: the units are already promised.
  assert.equal((await api(`/api/medicines/${medicine.id}`)).body.stock, 0);

  // ...while the first shopper still owns them.
  cookieJar.clear();
  for (const [name, value] of firstJar) cookieJar.set(name, value);
  const cart = await api('/api/cart');
  assert.equal(cart.body.items[0].quantity, 2);
  assert.equal(cart.body.items[0].holdActive, true);
});

test('a lapsed hold is released on read and the line stays put (FR-1.3)', async () => {
  resetJar();
  const medicine = await addMedicine({ name: 'Expiring Hold Drops', stock: 5 });

  await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 2 },
  });
  assert.deepEqual(await countersOf(medicine.id), { stock: 3, held: 2 });

  await expireHold(medicine.id);

  const res = await api('/api/cart');
  assert.equal(res.status, 200);

  const [line] = res.body.items;
  assert.equal(line.quantity, 2, 'the item is not removed from the cart');
  assert.equal(line.holdActive, false);
  assert.equal(line.held, 0);
  assert.equal(line.holdExpired, true);
  assert.equal(line.holdSecondsLeft, 0);
  assert.equal(line.issue, null, 'the units are back on the shelf, so nothing is wrong');
  assert.equal(res.body.hasExpiredHolds, true);

  assert.deepEqual(await countersOf(medicine.id), { stock: 5, held: 0 });
});

test('sending the same quantity again renews a lapsed hold', async () => {
  resetJar();
  const medicine = await addMedicine({ name: 'Renewable Capsules', stock: 4 });

  await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 2 },
  });
  await expireHold(medicine.id);

  const released = await api('/api/cart');
  assert.equal(released.body.items[0].holdActive, false);
  assert.deepEqual(await countersOf(medicine.id), { stock: 4, held: 0 });

  // The "refresh hold" action: PATCH with the quantity the cart already has.
  const renewed = await api(`/api/cart/items/${medicine.id}`, {
    method: 'PATCH',
    body: { quantity: 2 },
  });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.equal(renewed.body.items[0].holdActive, true);
  assert.equal(renewed.body.items[0].quantity, 2);
  assert.deepEqual(await countersOf(medicine.id), { stock: 2, held: 2 });
});

test('signing in moves the guest hold onto the account cart', async () => {
  resetJar();
  const medicine = await addMedicine({ name: 'Merged Tablets', stock: 10 });
  await api('/api/cart', { method: 'DELETE', token: customerToken, useJar: false });

  const guest = await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: medicine.id, quantity: 2 },
  });
  assert.equal(guest.status, 201, JSON.stringify(guest.body));
  assert.deepEqual(await countersOf(medicine.id), { stock: 8, held: 2 });

  const merged = await api('/api/cart/merge', { method: 'POST', token: customerToken, body: {} });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  assert.equal(merged.body.items.length, 1);
  assert.equal(merged.body.items[0].quantity, 2);
  assert.equal(merged.body.items[0].holdActive, true);

  // The guest's promise ended and the account cart took its own, so the
  // counters are unchanged: two units are still promised, exactly once.
  assert.deepEqual(await countersOf(medicine.id), { stock: 8, held: 2 });

  // The guest cart is gone, so the old cookie cannot hold the same units twice.
  const withoutToken = await api('/api/cart');
  assert.deepEqual(withoutToken.body.items, []);

  await api('/api/cart', { method: 'DELETE', token: customerToken, useJar: false });
  assert.deepEqual(await countersOf(medicine.id), { stock: 10, held: 0 });
});


test('checkout converts the hold into a sale and a cancel returns the units', async () => {
  const medicine = await addMedicine({ name: 'Checkout Hold Tablets', stock: 6 });

  await api('/api/cart', { method: 'DELETE', token: customerToken, useJar: false });
  const added = await api('/api/cart/items', {
    method: 'POST',
    token: customerToken,
    body: { medicineId: medicine.id, quantity: 2 },
  });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.deepEqual(await countersOf(medicine.id), { stock: 4, held: 2 });

  const order = await api('/api/orders', {
    method: 'POST',
    token: customerToken,
    body: { shippingAddress: SHIPPING },
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));

  // The shelf is not decremented a second time: only the promise is discharged.
  assert.deepEqual(await countersOf(medicine.id), { stock: 4, held: 0 });

  const cancelled = await api(`/api/orders/${order.body.id}/cancel`, {
    method: 'POST',
    token: customerToken,
    body: {},
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));

  // A cancelled sale puts the physical units back on the shelf.
  assert.deepEqual(await countersOf(medicine.id), { stock: 6, held: 0 });
});

test('a checkout that cannot convert every line puts the earlier holds back', async () => {
  const first = await addMedicine({ name: 'Rollback Alpha', stock: 5 });
  const second = await addMedicine({ name: 'Rollback Beta', stock: 5 });

  await api('/api/cart', { method: 'DELETE', token: customerToken, useJar: false });
  await api('/api/cart/items', {
    method: 'POST',
    token: customerToken,
    body: { medicineId: first.id, quantity: 2 },
  });
  await api('/api/cart/items', {
    method: 'POST',
    token: customerToken,
    body: { medicineId: second.id, quantity: 2 },
  });

  // Simulate the second line's hold being spent between the cart read and the
  // conversion (a sweeper or another tab): the marker still looks live, so the
  // checkout plans the line as satisfied by a hold, but there is nothing left
  // in `held` to convert. The first line must then be rolled back.
  await mongoose.connection.db
    .collection('medicines')
    .updateOne(
      { _id: new mongoose.Types.ObjectId(second.id) },
      { $set: { held: 0 } }
    );

  const res = await api('/api/orders', {
    method: 'POST',
    token: customerToken,
    body: { shippingAddress: SHIPPING },
  });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(res.body.error, /Rollback Beta|held/i);

  // The first line converted and was then put back exactly as it was.
  assert.deepEqual(await countersOf(first.id), { stock: 3, held: 2 });

  await api('/api/cart', { method: 'DELETE', token: customerToken, useJar: false });
  assert.deepEqual(await countersOf(first.id), { stock: 5, held: 0 });
});

