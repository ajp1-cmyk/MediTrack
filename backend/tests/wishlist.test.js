// Tests for the wishlist (SRS FR-1.5): save, list, remove, clear and the
// move-to-cart action.
//
//   cd backend && npm test
//
// Runs against a real Express app and an in-memory MongoDB, exactly like the
// other suites. The background inventory sweep is disabled so the stock levels
// used by the out-of-stock assertions stay stable.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-wishlist';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-wishlist';
process.env.PAYMENT_MOCK_DELAY_MS = '0';
process.env.INVENTORY_AUTO_REPLENISH = 'off';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { createUser } = require('./support');

let mongo;
let server;
let baseUrl;
let Medicine;
let Wishlist;

/** fetch helper with JSON bodies and a Bearer token. */
async function api(path, { method = 'GET', token, body, contentType } = {}) {
  const headers = {};
  let payload;

  if (body !== undefined) {
    headers['Content-Type'] = contentType || 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function login(email, password) {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

const ALICE = {
  name: 'Alice Customer',
  email: 'wishlist-alice@meditrack.test',
  password: 'alice-pass-123',
};
const BOB = {
  name: 'Bob Customer',
  email: 'wishlist-bob@meditrack.test',
  password: 'bob-pass-123',
};

let alice;
let bob;
let aliceToken;
let bobToken;

/** A medicine document that passes the model's date/price/stock validation. */
function medicineFields(overrides = {}) {
  return {
    name: 'Paracetamol',
    mfd: '2025-01-01',
    exp: '2030-01-01',
    price: 100.25,
    stock: 10,
    ...overrides,
  };
}

let medicine;
let outOfStock;
let expired;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_wishlist_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');
  Medicine = require('../models/Medicine');
  Wishlist = require('../models/Wishlist');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Public sign-up only creates customers, so seeded accounts are created
  // directly and then signed in through the real login endpoint.
  alice = await createUser(ALICE);
  bob = await createUser(BOB);
  aliceToken = await login(ALICE.email, ALICE.password);
  bobToken = await login(BOB.email, BOB.password);

  medicine = await Medicine.create(medicineFields({ name: 'Paracetamol', stock: 10 }));
  outOfStock = await Medicine.create(medicineFields({ name: 'Cough Syrup', price: 80, stock: 0 }));
  expired = await Medicine.create(
    medicineFields({
      name: 'Old Drops',
      mfd: '2019-01-01',
      exp: '2020-01-01',
      price: 30,
      stock: 5,
    })
  );
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

// ------------------------------------------------------------------- access

test('the wishlist requires a signed-in account', async () => {
  const read = await api('/api/wishlist');
  assert.equal(read.status, 401);

  const save = await api('/api/wishlist/items', {
    method: 'POST',
    body: { medicineId: String(medicine._id) },
  });
  assert.equal(save.status, 401);
});

test('wishlist mutations reject form-encoded bodies', async () => {
  const res = await api('/api/wishlist/items', {
    method: 'POST',
    token: aliceToken,
    body: 'medicineId=abc',
    contentType: 'application/x-www-form-urlencoded',
  });
  assert.equal(res.status, 415);
});

test('a new account starts with an empty wishlist', async () => {
  const res = await api('/api/wishlist', { token: aliceToken });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
  assert.equal(res.body.itemCount, 0);
  assert.equal(res.body.availableCount, 0);
  assert.equal(res.body.hasIssues, false);
});

// -------------------------------------------------------------- save / list

test('saving a medicine returns live price, stock and availability', async () => {
  const res = await api('/api/wishlist/items', {
    method: 'POST',
    token: aliceToken,
    body: { medicineId: String(medicine._id) },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.itemCount, 1);
  assert.equal(res.body.availableCount, 1);
  assert.equal(res.body.hasIssues, false);

  const [item] = res.body.items;
  assert.equal(item.medicineId, String(medicine._id));
  assert.equal(item.name, 'Paracetamol');
  assert.equal(item.price, 100.25);
  assert.equal(item.stock, 10);
  assert.equal(item.available, true);
  assert.equal(item.expired, false);
  assert.equal(item.issue, null);
  assert.ok(res.body.updatedAt, 'expected an updatedAt timestamp');
});

test('saving the same medicine twice does not duplicate it', async () => {
  const res = await api('/api/wishlist/items', {
    method: 'POST',
    token: aliceToken,
    body: { medicineId: String(medicine._id) },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.itemCount, 1);

  // Prove the stored array itself has no duplicate entry.
  const stored = await Wishlist.findOne({ user: alice._id });
  assert.equal(stored.items.length, 1);
});

test('saving an unknown or malformed medicine is rejected', async () => {
  const malformed = await api('/api/wishlist/items', {
    method: 'POST',
    token: aliceToken,
    body: { medicineId: 'not-an-object-id' },
  });
  assert.equal(malformed.status, 400);

  const missing = await api('/api/wishlist/items', {
    method: 'POST',
    token: aliceToken,
    body: { medicineId: new mongoose.Types.ObjectId().toString() },
  });
  assert.equal(missing.status, 404);

  const unchanged = await api('/api/wishlist', { token: aliceToken });
  assert.equal(unchanged.body.itemCount, 1);
});

test('out-of-stock and expired medicines can be saved and are flagged', async () => {
  const stockRes = await api('/api/wishlist/items', {
    method: 'POST',
    token: aliceToken,
    body: { medicineId: String(outOfStock._id) },
  });
  assert.equal(stockRes.status, 201, JSON.stringify(stockRes.body));

  const stockItem = stockRes.body.items.find(
    (item) => item.medicineId === String(outOfStock._id)
  );
  assert.equal(stockItem.available, false);
  assert.equal(stockItem.issue, 'Out of stock.');

  const expiredRes = await api('/api/wishlist/items', {
    method: 'POST',
    token: aliceToken,
    body: { medicineId: String(expired._id) },
  });
  assert.equal(expiredRes.status, 201, JSON.stringify(expiredRes.body));

  const expiredItem = expiredRes.body.items.find(
    (item) => item.medicineId === String(expired._id)
  );
  assert.equal(expiredItem.available, false);
  assert.equal(expiredItem.expired, true);
  assert.match(expiredItem.issue, /expired/i);

  assert.equal(expiredRes.body.itemCount, 3);
  assert.equal(expiredRes.body.availableCount, 1, 'only Paracetamol is sellable');
  assert.equal(expiredRes.body.hasIssues, true);
});

test('one account cannot see or change another account’s wishlist', async () => {
  const bobView = await api('/api/wishlist', { token: bobToken });
  assert.equal(bobView.status, 200);
  assert.deepEqual(bobView.body.items, []);

  // Bob removing Alice's medicine id is a no-op on his own (empty) list.
  const bobDelete = await api(`/api/wishlist/items/${medicine._id}`, {
    method: 'DELETE',
    token: bobToken,
  });
  assert.equal(bobDelete.status, 200);
  assert.deepEqual(bobDelete.body.items, []);

  const aliceView = await api('/api/wishlist', { token: aliceToken });
  assert.equal(aliceView.body.itemCount, 3, 'Alice still has all three items');
});

// -------------------------------------------------------------- move to cart

test('moving an item adds it to the cart and removes it from the wishlist', async () => {
  const res = await api(`/api/wishlist/items/${medicine._id}/move-to-cart`, {
    method: 'POST',
    token: aliceToken,
    body: {},
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.wishlist.itemCount, 2);
  assert.equal(
    res.body.wishlist.items.some((item) => item.medicineId === String(medicine._id)),
    false
  );

  assert.equal(res.body.cart.items.length, 1);
  assert.equal(res.body.cart.items[0].medicineId, String(medicine._id));
  assert.equal(res.body.cart.items[0].quantity, 1);

  // The cart endpoint agrees with the move response.
  const cart = await api('/api/cart', { token: aliceToken });
  assert.equal(cart.status, 200);
  assert.equal(cart.body.itemCount, 1);
});

test('moving an item that is not on the wishlist is rejected', async () => {
  const res = await api(`/api/wishlist/items/${medicine._id}/move-to-cart`, {
    method: 'POST',
    token: aliceToken,
    body: {},
  });

  assert.equal(res.status, 404);
  const cart = await api('/api/cart', { token: aliceToken });
  assert.equal(cart.body.itemCount, 1, 'the cart must be unchanged');
});

test('moving a medicine already in the cart increases its quantity', async () => {
  const save = await api('/api/wishlist/items', {
    method: 'POST',
    token: aliceToken,
    body: { medicineId: String(medicine._id) },
  });
  assert.equal(save.status, 201);

  const res = await api(`/api/wishlist/items/${medicine._id}/move-to-cart`, {
    method: 'POST',
    token: aliceToken,
    body: {},
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const line = res.body.cart.items.find(
    (item) => item.medicineId === String(medicine._id)
  );
  assert.equal(line.quantity, 2, 'the existing cart line is incremented');
});

test('move-to-cart respects the stock limit and leaves the wishlist intact', async () => {
  const scarce = await Medicine.create(
    medicineFields({ name: 'Scarce Antibiotic', price: 200, stock: 3 })
  );

  // Fill the cart to the stock limit first.
  const filled = await api('/api/cart/items', {
    method: 'POST',
    token: aliceToken,
    body: { medicineId: String(scarce._id), quantity: 3 },
  });
  assert.equal(filled.status, 201, JSON.stringify(filled.body));

  const save = await api('/api/wishlist/items', {
    method: 'POST',
    token: aliceToken,
    body: { medicineId: String(scarce._id) },
  });
  assert.equal(save.status, 201);

  const res = await api(`/api/wishlist/items/${scarce._id}/move-to-cart`, {
    method: 'POST',
    token: aliceToken,
    body: {},
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Only 3 units/i);

  const wishlist = await api('/api/wishlist', { token: aliceToken });
  assert.ok(
    wishlist.body.items.some((item) => item.medicineId === String(scarce._id)),
    'a rejected move must not remove the item'
  );

  const cart = await api('/api/cart', { token: aliceToken });
  const line = cart.body.items.find((item) => item.medicineId === String(scarce._id));
  assert.equal(line.quantity, 3, 'the cart keeps the quantity it already had');
});

test('moving an out-of-stock item fails without touching the wishlist', async () => {
  const before = await api('/api/wishlist', { token: aliceToken });

  const res = await api(`/api/wishlist/items/${outOfStock._id}/move-to-cart`, {
    method: 'POST',
    token: aliceToken,
    body: {},
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /out of stock/i);

  const afterView = await api('/api/wishlist', { token: aliceToken });
  assert.deepEqual(
    afterView.body.items.map((item) => item.medicineId),
    before.body.items.map((item) => item.medicineId)
  );
});

test('move-to-cart rejects a malformed medicine id', async () => {
  const res = await api('/api/wishlist/items/not-an-object-id/move-to-cart', {
    method: 'POST',
    token: aliceToken,
    body: {},
  });
  assert.equal(res.status, 400);
});

// ------------------------------------------------------------ remove / clear

test('removing one medicine is idempotent', async () => {
  const res = await api(`/api/wishlist/items/${expired._id}`, {
    method: 'DELETE',
    token: aliceToken,
  });
  assert.equal(res.status, 200);
  assert.equal(
    res.body.items.some((item) => item.medicineId === String(expired._id)),
    false
  );

  const again = await api(`/api/wishlist/items/${expired._id}`, {
    method: 'DELETE',
    token: aliceToken,
  });
  assert.equal(again.status, 200, 'removing an absent item is a no-op');
});

test('removing with a malformed id is rejected', async () => {
  const res = await api('/api/wishlist/items/not-an-object-id', {
    method: 'DELETE',
    token: aliceToken,
  });
  assert.equal(res.status, 400);
});

test('a deleted medicine stays visible and is flagged unavailable', async () => {
  const withdrawn = await Medicine.create(
    medicineFields({ name: 'Withdrawn Tablets', price: 60, stock: 4 })
  );

  const saved = await api('/api/wishlist/items', {
    method: 'POST',
    token: bobToken,
    body: { medicineId: String(withdrawn._id) },
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));

  await Medicine.deleteOne({ _id: withdrawn._id });

  const view = await api('/api/wishlist', { token: bobToken });
  const item = view.body.items.find(
    (entry) => entry.medicineId === String(withdrawn._id)
  );
  assert.equal(item.available, false);
  assert.equal(item.name, 'Unavailable medicine');
  assert.match(item.issue, /no longer available/i);

  // It cannot be moved to the cart, and the wishlist keeps it so the customer
  // can remove it manually.
  const move = await api(`/api/wishlist/items/${withdrawn._id}/move-to-cart`, {
    method: 'POST',
    token: bobToken,
    body: {},
  });
  assert.equal(move.status, 404);

  const stillSaved = await api('/api/wishlist', { token: bobToken });
  assert.equal(stillSaved.body.itemCount, 1);
});

test('clearing empties the whole wishlist', async () => {
  const cleared = await api('/api/wishlist', { method: 'DELETE', token: aliceToken });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.items, []);
  assert.equal(cleared.body.itemCount, 0);
  assert.equal(cleared.body.availableCount, 0);
  assert.equal(cleared.body.hasIssues, false);

  const view = await api('/api/wishlist', { token: aliceToken });
  assert.deepEqual(view.body.items, []);
});
