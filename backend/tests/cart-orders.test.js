// End-to-end tests for the e-commerce flow: cart cookies, guest carts,
// checkout, stock reservation, payments, cancellation and expiry.
//
//   cd backend && npm test
//
// Runs against a real Express app and a real in-memory MongoDB, exactly like
// api.test.js. No MongoDB installation is required.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-cart-orders';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-cart-orders';
process.env.PAYMENT_MOCK_DELAY_MS = '0';
process.env.ORDER_RESERVATION_MINUTES = '30';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { createUser } = require('./support');

let mongo;
let server;
let baseUrl;

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
  return cookies;
}

function resetJar() {
  cookieJar.clear();
}

/** fetch helper with JSON / multipart bodies, Bearer tokens and a cookie jar. */
async function api(path, { method = 'GET', token, body, form, useJar = true, contentType } = {}) {
  const headers = {};
  let payload;

  if (form) {
    payload = new FormData();
    Object.entries(form).forEach(([key, value]) => payload.append(key, value));
  } else if (body !== undefined) {
    headers['Content-Type'] = contentType || 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  if (useJar && cookieJar.size > 0) {
    headers.Cookie = [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, setCookies: captureCookies(res) };
}

const ADMIN = {
  name: 'Ada Admin',
  email: 'orders-admin@meditrack.test',
  password: 'admin-pass-123',
};
const STAFF = {
  name: 'Sam Staff',
  email: 'orders-staff@meditrack.test',
  password: 'staff-pass-123',
};

const SHIPPING = {
  fullName: 'Ada Admin',
  phone: '9876543210',
  email: 'orders-admin@meditrack.test',
  line1: '1 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

const medicineFields = (overrides = {}) => ({
  name: 'Paracetamol',
  mfd: '2025-01-15',
  exp: '2028-01-15',
  price: '100.25',
  stock: '20',
  ...overrides,
});

let adminToken;
let staffToken;
let cartMedicine;
let lowStockMedicine;
let outOfStockMedicine;
let expiredMedicine;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_cart_orders_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Accounts are seeded directly: public sign-up only creates customers.
  await createUser({ ...ADMIN, role: 'admin' });
  await createUser({ ...STAFF, role: 'staff' });

  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN.email, password: ADMIN.password },
  });
  adminToken = adminLogin.body.token;

  const staffLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: STAFF.email, password: STAFF.password },
  });
  staffToken = staffLogin.body.token;

  cartMedicine = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields({ name: 'Paracetamol', price: '100.25', stock: '20' }),
  });
  lowStockMedicine = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields({ name: 'Ibuprofen', price: '50.50', stock: '3' }),
  });
  outOfStockMedicine = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields({ name: 'Cough Syrup', price: '80', stock: '0' }),
  });
  expiredMedicine = await api('/api/medicines', {
    method: 'POST',
    token: adminToken,
    form: medicineFields({
      name: 'Old Drops',
      mfd: '2019-01-01',
      exp: '2020-01-01',
      price: '30',
      stock: '5',
    }),
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

// ------------------------------------------------------------- cookie basics

test('adding to a guest cart sets a signed, httpOnly cart cookie', async () => {
  resetJar();

  const res = await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: cartMedicine.body.id, quantity: 2 },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.itemCount, 2);

  const cartCookie = res.setCookies.find((cookie) => cookie.startsWith('mt_cart='));
  assert.ok(cartCookie, 'expected an mt_cart cookie');
  assert.match(cartCookie, /HttpOnly/i);
  assert.match(cartCookie, /SameSite=Lax/i);
  assert.match(cartCookie, /Path=\/api/i);
  assert.match(cartCookie, /Max-Age=2592000/i);
  assert.match(cartCookie, /mt_cart=s%3A/i, 'cookie value must be signed');
  assert.ok(cookieJar.has('mt_cart'));
});

test('the cart persists across requests that send the cookie', async () => {
  const res = await api('/api/cart');
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].medicineId, cartMedicine.body.id);
  assert.equal(res.body.items[0].quantity, 2);
});

test('a tampered cookie is rejected and cleared', async () => {
  cookieJar.set('mt_cart', 's%3Atampered.signature');

  const res = await api('/api/cart');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
  assert.ok(
    res.setCookies.some((cookie) => cookie.startsWith('mt_cart=')),
    'the invalid cookie should be cleared'
  );
});

test('cart mutations reject form-encoded bodies', async () => {
  resetJar();
  const res = await api('/api/cart/items', {
    method: 'POST',
    body: 'medicineId=abc&quantity=1',
    contentType: 'application/x-www-form-urlencoded',
  });
  assert.equal(res.status, 415);
});

// --------------------------------------------------------- cart validation

test('quantities, stock and expiry are all validated', async () => {
  resetJar();
  const add = (body) => api('/api/cart/items', { method: 'POST', body });

  assert.equal((await add({ medicineId: cartMedicine.body.id, quantity: 0 })).status, 400);
  assert.equal((await add({ medicineId: cartMedicine.body.id, quantity: 1.5 })).status, 400);
  assert.equal((await add({ medicineId: cartMedicine.body.id, quantity: 99 })).status, 409);
  assert.equal((await add({ medicineId: 'not-an-id', quantity: 1 })).status, 400);

  const outOfStock = await add({ medicineId: outOfStockMedicine.body.id, quantity: 1 });
  assert.equal(outOfStock.status, 409);
  assert.match(outOfStock.body.error, /out of stock/i);

  const expired = await add({ medicineId: expiredMedicine.body.id, quantity: 1 });
  assert.equal(expired.status, 409);
  assert.match(expired.body.error, /expired/i);
});

test('adding the same medicine again increments the line', async () => {
  const first = await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: cartMedicine.body.id, quantity: 2 },
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.items[0].quantity, 2);

  const second = await api('/api/cart/items', {
    method: 'POST',
    body: { medicineId: cartMedicine.body.id, quantity: 1 },
  });

  assert.equal(second.status, 201);
  assert.equal(second.body.items.length, 1);
  assert.equal(second.body.items[0].quantity, 3);
});

test('totals are computed server-side in paise, with GST and delivery', async () => {
  const res = await api('/api/cart');
  const { totals } = res.body;

  // 3 × ₹100.25 = ₹300.75, 5% GST = ₹15.04, delivery ₹40 (below the free limit).
  assert.equal(totals.subtotal, 300.75);
  assert.equal(totals.tax, 15.04);
  assert.equal(totals.deliveryFee, 40);
  assert.equal(totals.total, 355.79);
  assert.equal(totals.itemCount, 3);
  assert.equal(totals.currency, 'INR');
});

test('a guest cart merges into the signed-in account', async () => {
  const res = await api('/api/cart/merge', {
    method: 'POST',
    token: adminToken,
    body: {},
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.itemCount, 3);
  assert.equal(cookieJar.has('mt_cart'), false, 'the guest cookie should be cleared');

  const asUser = await api('/api/cart', { token: adminToken, useJar: false });
  assert.equal(asUser.body.itemCount, 3);
});

// ---------------------------------------------------------------- checkout

/** Add a medicine to the signed-in user's cart and check out. */
async function placeOrder(medicineId, quantity = 1) {
  const added = await api('/api/cart/items', {
    method: 'POST',
    token: adminToken,
    body: { medicineId, quantity },
  });
  assert.equal(added.status, 201, JSON.stringify(added.body));

  const order = await api('/api/orders', {
    method: 'POST',
    token: adminToken,
    body: { shippingAddress: SHIPPING },
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  return order.body;
}

let firstOrder;

test('creating an order requires a signed-in user', async () => {
  const res = await api('/api/orders', {
    method: 'POST',
    body: { shippingAddress: SHIPPING },
    useJar: false,
  });
  assert.equal(res.status, 401);
});

test('checkout snapshots the cart and reserves stock', async () => {
  const before = await api(`/api/medicines/${cartMedicine.body.id}`);

  const res = await api('/api/orders', {
    method: 'POST',
    token: adminToken,
    body: { shippingAddress: SHIPPING },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  firstOrder = res.body;

  assert.equal(firstOrder.status, 'pending_payment');
  assert.equal(firstOrder.payment.status, 'pending');
  assert.equal(firstOrder.payment.method, null);
  assert.equal(firstOrder.items.length, 1);
  assert.equal(firstOrder.items[0].unitPrice, 100.25);
  assert.equal(firstOrder.items[0].quantity, 3);
  assert.equal(firstOrder.items[0].lineTotal, 300.75);
  assert.equal(firstOrder.totals.total, 355.79);
  assert.match(firstOrder.orderNumber, /^MT-\d{4}-[0-9A-F]{6}$/);
  assert.equal(firstOrder.shippingAddress.country, 'India');

  const after = await api(`/api/medicines/${cartMedicine.body.id}`);
  assert.equal(after.body.stock, before.body.stock - 3);

  const cart = await api('/api/cart', { token: adminToken, useJar: false });
  assert.deepEqual(cart.body.items, []);
});

// ---------------------------------------------------------------- payments

test('a successful card payment marks the order paid and is idempotent', async () => {
  const body = {
    method: 'card',
    details: { number: '4242 4242 4242 4242', expiry: '12/35', cvv: '123' },
  };

  const res = await api(`/api/orders/${firstOrder.id}/pay`, {
    method: 'POST',
    token: adminToken,
    body,
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'paid');
  assert.equal(res.body.payment.status, 'succeeded');
  assert.equal(res.body.payment.provider, 'mock');
  assert.equal(res.body.payment.brand, 'visa');
  assert.equal(res.body.payment.last4, '4242');
  assert.ok(res.body.payment.transactionId);
  assert.ok(res.body.payment.paidAt);
  assert.equal(res.body.payment.failureReason, null);

  const transactionId = res.body.payment.transactionId;
  const again = await api(`/api/orders/${firstOrder.id}/pay`, {
    method: 'POST',
    token: adminToken,
    body,
  });

  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'paid');
  assert.equal(again.body.payment.transactionId, transactionId, 'must not charge twice');
});

test('a declined payment leaves the order payable and retryable', async () => {
  const order = await placeOrder(cartMedicine.body.id, 1);

  const declined = await api(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    token: adminToken,
    body: {
      method: 'card',
      details: { number: '4000 0000 0000 0002', expiry: '12/35', cvv: '123' },
    },
  });

  assert.equal(declined.status, 402);
  assert.match(declined.body.error, /declined/i);
  assert.equal(declined.body.order.status, 'pending_payment');
  assert.equal(declined.body.order.payment.status, 'failed');

  const fetched = await api(`/api/orders/${order.id}`, { token: adminToken });
  assert.equal(fetched.body.status, 'pending_payment');
  assert.equal(fetched.body.payment.failureReason, declined.body.error);

  const retry = await api(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    token: adminToken,
    body: { method: 'upi', details: { vpa: 'ada@okbank' } },
  });

  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, 'paid');
  assert.equal(retry.body.payment.brand, 'upi');
});

test('cash on delivery confirms the order with payment still pending', async () => {
  const order = await placeOrder(cartMedicine.body.id, 1);

  const res = await api(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    token: adminToken,
    body: { method: 'cod' },
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'processing');
  assert.equal(res.body.payment.status, 'pending');
  assert.equal(res.body.payment.method, 'cod');
  assert.equal(res.body.payment.paidAt, null);
});

test('only valid payment methods are accepted', async () => {
  const order = await placeOrder(cartMedicine.body.id, 1);
  const res = await api(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    token: adminToken,
    body: { method: 'bitcoin' },
  });
  assert.equal(res.status, 400);
  await api(`/api/orders/${order.id}/cancel`, { method: 'POST', token: adminToken, body: {} });
});

// ------------------------------------------------------- cancel / ownership

test('cancelling an unpaid order restores stock', async () => {
  const before = (await api(`/api/medicines/${cartMedicine.body.id}`)).body.stock;
  const order = await placeOrder(cartMedicine.body.id, 2);
  const reserved = (await api(`/api/medicines/${cartMedicine.body.id}`)).body.stock;
  assert.equal(reserved, before - 2);

  const cancelled = await api(`/api/orders/${order.id}/cancel`, {
    method: 'POST',
    token: adminToken,
    body: {},
  });

  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal(cancelled.body.payment.status, 'cancelled');

  const restored = (await api(`/api/medicines/${cartMedicine.body.id}`)).body.stock;
  assert.equal(restored, before);

  // Cancelling again is a harmless no-op, not a second stock increase.
  const again = await api(`/api/orders/${order.id}/cancel`, {
    method: 'POST',
    token: adminToken,
    body: {},
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'cancelled');
  assert.equal((await api(`/api/medicines/${cartMedicine.body.id}`)).body.stock, before);
});

test("another user cannot read, pay or cancel someone else's order", async () => {
  const read = await api(`/api/orders/${firstOrder.id}`, { token: staffToken });
  assert.equal(read.status, 404);

  const pay = await api(`/api/orders/${firstOrder.id}/pay`, {
    method: 'POST',
    token: staffToken,
    body: { method: 'cod' },
  });
  assert.equal(pay.status, 404);

  const cancel = await api(`/api/orders/${firstOrder.id}/cancel`, {
    method: 'POST',
    token: staffToken,
    body: {},
  });
  assert.equal(cancel.status, 404);
});

// --------------------------------------------------- stock safety / expiry

test('a failed reservation does not decrement any earlier line', async () => {
  await api('/api/cart', { method: 'DELETE', token: adminToken });
  await api('/api/cart/items', {
    method: 'POST',
    token: adminToken,
    body: { medicineId: cartMedicine.body.id, quantity: 1 },
  });
  await api('/api/cart/items', {
    method: 'POST',
    token: adminToken,
    body: { medicineId: lowStockMedicine.body.id, quantity: 2 },
  });

  // Someone else buys the low-stock medicine after it was added to this cart.
  await api(`/api/medicines/${lowStockMedicine.body.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { stock: 1 },
  });

  const stockBefore = (await api(`/api/medicines/${cartMedicine.body.id}`)).body.stock;
  const res = await api('/api/orders', {
    method: 'POST',
    token: adminToken,
    body: { shippingAddress: SHIPPING },
  });

  assert.equal(res.status, 409);
  assert.match(res.body.error, /Ibuprofen/);
  assert.equal(
    (await api(`/api/medicines/${cartMedicine.body.id}`)).body.stock,
    stockBefore,
    'the first line must be rolled back'
  );

  // The cart is untouched so the shopper can fix the quantity.
  const cart = await api('/api/cart', { token: adminToken, useJar: false });
  assert.equal(cart.body.items.length, 2);

  // Restore a usable state for the remaining tests.
  await api(`/api/medicines/${lowStockMedicine.body.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { stock: 3 },
  });
  await api('/api/cart', { method: 'DELETE', token: adminToken });
});

test('an expired reservation releases its stock', async () => {
  const Order = require('../models/Order');

  const before = (await api(`/api/medicines/${cartMedicine.body.id}`)).body.stock;
  const order = await placeOrder(cartMedicine.body.id, 1);
  assert.equal((await api(`/api/medicines/${cartMedicine.body.id}`)).body.stock, before - 1);

  await Order.updateOne({ _id: order.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

  const fetched = await api(`/api/orders/${order.id}`, { token: adminToken });
  assert.equal(fetched.body.status, 'expired');
  assert.equal(fetched.body.payment.status, 'cancelled');
  assert.equal((await api(`/api/medicines/${cartMedicine.body.id}`)).body.stock, before);

  const pay = await api(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    token: adminToken,
    body: { method: 'cod' },
  });
  assert.equal(pay.status, 409);
});

// ------------------------------------------------------------------ history

test('order history is newest first and scoped to the owner', async () => {
  const res = await api('/api/orders', { token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 5);

  const timestamps = res.body.map((order) => new Date(order.created_at).getTime());
  const sorted = [...timestamps].sort((a, b) => b - a);
  assert.deepEqual(timestamps, sorted);

  const staffOrders = await api('/api/orders', { token: staffToken });
  assert.equal(staffOrders.status, 200);
  assert.deepEqual(staffOrders.body, []);
});
