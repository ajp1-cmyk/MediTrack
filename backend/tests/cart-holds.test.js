// Tests for cart-level soft holds (SRS FR-1.2 / FR-1.3): the atomic
// stock → held move, the compensating release, converting a hold into a sale at
// checkout, and the sweeper that releases lapsed holds.
//
//   cd backend && npm test
//
// These are service-level tests against a real in-memory MongoDB. The HTTP
// routes built on these primitives are covered by the route tests that land
// with the next step of Phase C and by tests/cart-orders.test.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../db is loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-cart-holds';
process.env.COOKIE_SECRET = 'test-cookie-secret-cart-holds';
process.env.INVENTORY_AUTO_REPLENISH = 'off';
delete process.env.CART_HOLD_MINUTES;
delete process.env.CART_HOLD_SWEEP_INTERVAL_MS;

const { MongoMemoryServer } = require('mongodb-memory-server');

const MINUTE = 60 * 1000;

let mongo;
let Medicine;
let Cart;
let holds;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_cart_holds_test');

  const { connectDB } = require('../db');
  await connectDB();

  Medicine = require('../models/Medicine');
  Cart = require('../models/Cart');
  holds = require('../lib/cartHolds');
});

after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([Medicine.deleteMany({}), Cart.deleteMany({})]);
});

/** A medicine with `stock` available units and nothing held. */
async function makeMedicine({ stock = 10, name = 'Paracetamol 500mg' } = {}) {
  return Medicine.create({ name, mfd: '2025-01-01', exp: '2028-01-01', price: 25, stock });
}

/** Re-read a medicine so assertions never use a stale in-memory document. */
function readMedicine(id) {
  return Medicine.findById(id);
}

/** A one-line cart, optionally already holding `quantity` units. */
function makeCart(medicineId, { quantity = 1, holdExpiresAt = null } = {}) {
  return Cart.create({
    user: new mongoose.Types.ObjectId(), // one cart per user
    items: [{ medicine: medicineId, quantity, holdExpiresAt }],
  });
}

test('a hold lasts 15 minutes by default', () => {
  assert.equal(holds.cartHoldMinutes(), 15);
  assert.equal(holds.holdDurationMs(), 15 * MINUTE);

  const now = new Date('2026-01-01T10:00:00Z');
  assert.equal(holds.holdExpiry(now).toISOString(), '2026-01-01T10:15:00.000Z');
});

test('CART_HOLD_MINUTES overrides the duration and an unusable value falls back', () => {
  process.env.CART_HOLD_MINUTES = '2';
  assert.equal(holds.cartHoldMinutes(), 2);

  process.env.CART_HOLD_MINUTES = 'soon';
  assert.equal(holds.cartHoldMinutes(), 15);

  process.env.CART_HOLD_MINUTES = '0';
  assert.equal(holds.cartHoldMinutes(), 15);

  delete process.env.CART_HOLD_MINUTES;
});

test('a new medicine has nothing held and cannot store a negative count', async () => {
  const medicine = await makeMedicine();
  assert.equal(medicine.held, 0);

  medicine.held = -1;
  await assert.rejects(() => medicine.save(), /held quantity cannot be negative/i);
});


test('taking a hold moves units from stock to held atomically', async () => {
  const medicine = await makeMedicine({ stock: 10 });

  const updated = await holds.acquireHold(medicine._id, 3);

  assert.equal(updated.stock, 7);
  assert.equal(updated.held, 3);
  // The physical quantity on hand is unchanged by a hold.
  assert.equal(updated.stock + updated.held, 10);
});

test('a hold cannot overdraw the available stock', async () => {
  const medicine = await makeMedicine({ stock: 4 });

  assert.equal(await holds.acquireHold(medicine._id, 5), null);

  const after = await readMedicine(medicine._id);
  assert.equal(after.stock, 4);
  assert.equal(after.held, 0);
});

test('a malformed hold quantity is rejected with a 400', async () => {
  const medicine = await makeMedicine();

  await assert.rejects(() => holds.acquireHold(medicine._id, 0), /whole number/);
  await assert.rejects(() => holds.acquireHold(medicine._id, 1.5), /whole number/);
  await assert.rejects(() => holds.acquireHold(medicine._id, 'two'), /whole number/);
});

test('only one of two concurrent carts can hold the last units', async () => {
  const medicine = await makeMedicine({ stock: 5 });

  const results = await Promise.all([
    holds.acquireHold(medicine._id, 5),
    holds.acquireHold(medicine._id, 5),
  ]);

  assert.equal(results.filter(Boolean).length, 1, 'exactly one hold may win');

  const after = await readMedicine(medicine._id);
  assert.equal(after.stock, 0);
  assert.equal(after.held, 5);
});

test('releasing a hold puts the units back on sale', async () => {
  const medicine = await makeMedicine({ stock: 10 });
  await holds.acquireHold(medicine._id, 4);

  const updated = await holds.releaseHold(medicine._id, 4);

  assert.equal(updated.stock, 10);
  assert.equal(updated.held, 0);
});

test('releasing more than is held changes nothing', async () => {
  const medicine = await makeMedicine({ stock: 10 });
  await holds.acquireHold(medicine._id, 2);

  assert.equal(await holds.releaseHold(medicine._id, 3), null);

  const after = await readMedicine(medicine._id);
  assert.equal(after.stock, 8);
  assert.equal(after.held, 2);
});

test('a hold for a medicine deleted in the meantime is skipped', async () => {
  const medicine = await makeMedicine({ stock: 3 });
  await holds.acquireHold(medicine._id, 1);
  await Medicine.deleteOne({ _id: medicine._id });

  assert.equal(await holds.releaseHold(medicine._id, 1), null);
});

test('checkout converts a hold into a sale without touching stock again', async () => {
  const medicine = await makeMedicine({ stock: 10 });
  await holds.acquireHold(medicine._id, 2); // stock 8, held 2

  const sold = await holds.convertHoldToSale(medicine._id, 2);

  assert.equal(sold.stock, 8, 'stock was already decremented when the hold was taken');
  assert.equal(sold.held, 0);
  assert.equal(sold.stock + sold.held, 8, 'only the sale reduces the physical count');
});

test('a sale cannot convert units that are not held', async () => {
  const medicine = await makeMedicine({ stock: 10 });

  assert.equal(await holds.convertHoldToSale(medicine._id, 1), null);

  const after = await readMedicine(medicine._id);
  assert.equal(after.stock, 10);
  assert.equal(after.held, 0);
});

test('the sweeper releases a lapsed hold and clears its marker (FR-1.3)', async () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const medicine = await makeMedicine({ stock: 10 });
  await holds.acquireHold(medicine._id, 3); // stock 7, held 3

  const cart = await makeCart(medicine._id, {
    quantity: 3,
    holdExpiresAt: new Date(now.getTime() - MINUTE),
  });

  const result = await holds.releaseExpiredHolds({ now });

  assert.equal(result.scanned, 1);
  assert.equal(result.released.length, 1);
  assert.equal(result.released[0].quantity, 3);

  const after = await readMedicine(medicine._id);
  assert.equal(after.stock, 10, 'the units are available to other carts again');
  assert.equal(after.held, 0);

  const cartAfter = await Cart.findById(cart._id);
  assert.equal(cartAfter.items[0].holdExpiresAt, null, 'the line is marked as not holding');
  assert.equal(cartAfter.items[0].quantity, 3, 'the item stays in the cart');
});

test('the sweeper leaves a live hold and an expired-but-already-released line alone', async () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const medicine = await makeMedicine({ stock: 10 });
  await holds.acquireHold(medicine._id, 2);

  const live = await makeCart(medicine._id, {
    quantity: 2,
    holdExpiresAt: new Date(now.getTime() + 5 * MINUTE),
  });
  // A line whose hold was already released carries no marker at all.
  await Cart.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ medicine: medicine._id, quantity: 1, holdExpiresAt: null }],
  });

  const result = await holds.releaseExpiredHolds({ now });

  assert.equal(result.released.length, 0);

  const after = await readMedicine(medicine._id);
  assert.equal(after.stock, 8);
  assert.equal(after.held, 2);

  const liveAfter = await Cart.findById(live._id);
  assert.equal(liveAfter.items[0].holdExpiresAt.getTime(), now.getTime() + 5 * MINUTE);
});

test('a repeated sweep is a no-op (units are released exactly once)', async () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const medicine = await makeMedicine({ stock: 5 });
  await holds.acquireHold(medicine._id, 2);
  await makeCart(medicine._id, {
    quantity: 2,
    holdExpiresAt: new Date(now.getTime() - MINUTE),
  });

  const first = await holds.releaseExpiredHolds({ now });
  const second = await holds.releaseExpiredHolds({ now });

  assert.equal(first.released.length, 1);
  assert.equal(second.released.length, 0);

  const after = await readMedicine(medicine._id);
  assert.equal(after.stock, 5);
  assert.equal(after.held, 0);
});

test('two concurrent sweeps cannot release the same hold twice', async () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const medicine = await makeMedicine({ stock: 8 });
  await holds.acquireHold(medicine._id, 3);
  await makeCart(medicine._id, {
    quantity: 3,
    holdExpiresAt: new Date(now.getTime() - MINUTE),
  });

  const [a, b] = await Promise.all([
    holds.releaseExpiredHolds({ now }),
    holds.releaseExpiredHolds({ now }),
  ]);

  assert.equal(a.released.length + b.released.length, 1);

  const after = await readMedicine(medicine._id);
  assert.equal(after.stock, 8);
  assert.equal(after.held, 0);
});

test('emptying a cart releases its live holds exactly once', async () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const medicine = await makeMedicine({ stock: 10 });
  await holds.acquireHold(medicine._id, 4);

  const cart = await makeCart(medicine._id, {
    quantity: 4,
    holdExpiresAt: new Date(now.getTime() + 10 * MINUTE),
  });

  const released = await holds.releaseCartHolds(cart, { now });
  assert.equal(released.length, 1);
  assert.equal(released[0].quantity, 4);

  const after = await readMedicine(medicine._id);
  assert.equal(after.stock, 10);
  assert.equal(after.held, 0);

  // The local document still says "held", but the marker is gone in the
  // database, so a second call must not release anything.
  assert.deepEqual(await holds.releaseCartHolds(cart, { now }), []);
  assert.equal((await readMedicine(medicine._id)).stock, 10);
});

test('releaseCartHolds ignores lapsed lines and an empty cart', async () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const medicine = await makeMedicine({ stock: 10 });
  await holds.acquireHold(medicine._id, 2);

  const cart = await makeCart(medicine._id, {
    quantity: 2,
    holdExpiresAt: new Date(now.getTime() - MINUTE),
  });

  assert.deepEqual(await holds.releaseCartHolds(cart, { now }), []);
  assert.deepEqual(await holds.releaseCartHolds(null, { now }), []);

  // The lapsed hold is the sweeper's job, and it still releases it.
  const swept = await holds.releaseExpiredHolds({ now });
  assert.equal(swept.released.length, 1);
  assert.equal((await readMedicine(medicine._id)).stock, 10);
});

test('the background sweeper timer does not keep the process alive', () => {
  const timer = holds.startHoldSweeper({ intervalMs: 60 * 1000 });
  assert.equal(typeof timer.unref, 'function');
  clearInterval(timer);
});


test('the Phase C migration pins a pre-existing medicine to held = 0', async () => {
  const medicine = await makeMedicine({ stock: 5 });

  // Simulate a row created before Phase C: the field is absent in MongoDB even
  // though the Mongoose schema now has a default for it.
  await Medicine.collection.updateOne({ _id: medicine._id }, { $unset: { held: '' } });
  const raw = await Medicine.collection.findOne({ _id: medicine._id });
  assert.equal(raw.held, undefined);

  const { MIGRATIONS } = require('../lib/migrations');
  const migration = MIGRATIONS.find((step) => step.id === '002-medicine-held-counter');
  const detail = await migration.run();

  assert.match(detail, /held=0/);
  assert.equal((await Medicine.collection.findOne({ _id: medicine._id })).held, 0);

  // A hold now increments a real zero instead of starting from "missing", which
  // `$inc` would have turned into a negative counter.
  await holds.acquireHold(medicine._id, 1);
  const held = await readMedicine(medicine._id);
  assert.equal(held.stock, 4);
  assert.equal(held.held, 1);
});

test('restoring a converted hold puts the promise back without touching stock', async () => {
  const medicine = await makeMedicine({ stock: 10 });
  await holds.acquireHold(medicine._id, 2); // stock 8, held 2
  await holds.convertHoldToSale(medicine._id, 2); // stock 8, held 0

  const restored = await holds.restoreHold(medicine._id, 2);

  assert.equal(restored.stock, 8, 'stock never moves for a hold');
  assert.equal(restored.held, 2);
  assert.equal(restored.stock + restored.held, 10, 'the physical count is intact again');
});

