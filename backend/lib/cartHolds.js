// Short-lived cart soft holds (SRS FR-1.2 / FR-1.3).
//
// FR-1.2 asks for a hold when an item is added to the cart, with the stock check
// and the reservation done atomically. FR-1.3 asks for an expired hold to be
// released automatically. This module is the only place that moves units
// between the two inventory counters on a medicine:
//
//   stock  units a *new* customer can still buy
//   held   units promised to carts whose hold has not lapsed yet
//
// Taking a hold is one conditional update, so two carts can never reserve the
// same unit (no read-then-write race):
//
//   { _id, stock: { $gte: qty } }  →  $inc { stock: -qty, held: +qty }
//
// The pair (`stock + held`) is the physical quantity on hand. It is unchanged by
// taking or releasing a hold, drops by `qty` when a hold converts into a sale
// (checkout) and rises when a replenishment arrives (FR-1.1).
//
// Expiry is *claimed* before the units are released: the cart line's
// `holdExpiresAt` is atomically cleared, and only the caller that managed to
// clear it puts the units back. A concurrent sweeper, cart read or checkout
// therefore cannot release the same hold twice. If the process dies between the
// claim and the release the units stay in `held` — stock is never oversold,
// which is the safe direction for a pharmacy.
//
// Configuration (backend/.env):
//   CART_HOLD_MINUTES=15
//   CART_HOLD_SWEEP_INTERVAL_MS=60000
const Cart = require('../models/Cart');
const Medicine = require('../models/Medicine');
const { httpError } = require('./errors');

const DEFAULT_CART_HOLD_MINUTES = 15;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

/** Read a whole-number environment variable, falling back when it is unusable. */
function readWholeNumber(name, fallback, { min = 1 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min ? value : fallback;
}

/** How long a cart line keeps its stock reservation (SRS FR-1.2). */
function cartHoldMinutes() {
  return readWholeNumber('CART_HOLD_MINUTES', DEFAULT_CART_HOLD_MINUTES);
}

/** `cartHoldMinutes()` in milliseconds. */
function holdDurationMs() {
  return cartHoldMinutes() * 60 * 1000;
}

/** The moment a hold taken at `now` lapses. Stored on the cart line. */
function holdExpiry(now = new Date()) {
  return new Date(now.getTime() + holdDurationMs());
}

/** True when a line's hold marker is in the past (or exactly due). */
function isHoldExpired(holdExpiresAt, now = new Date()) {
  return Boolean(holdExpiresAt) && new Date(holdExpiresAt).getTime() <= now.getTime();
}

/**
 * Units a cart line is currently holding: 0 when the marker is absent or has
 * lapsed. A lapsed line keeps its quantity in the cart but holds no stock.
 */
function heldQuantity(item, now = new Date()) {
  if (!item || !item.holdExpiresAt) return 0;
  return isHoldExpired(item.holdExpiresAt, now) ? 0 : item.quantity;
}

/** Whole units, or a 400 for anything a route could be handed. */
function readHoldQuantity(quantity) {
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 1) {
    throw httpError(400, 'Hold quantity must be a whole number of at least 1');
  }
  return amount;
}

/**
 * Atomically move `quantity` units from `stock` into `held` (FR-1.2).
 *
 * Nothing changes when there are not enough available units — the conditional
 * filter simply matches no document.
 *
 * @param {import('mongoose').Types.ObjectId|string} medicineId
 * @param {number} quantity
 * @returns {Promise<import('../models/Medicine')|null>} the updated medicine,
 *   or null when the hold could not be taken
 */
async function acquireHold(medicineId, quantity) {
  const amount = readHoldQuantity(quantity);

  return Medicine.findOneAndUpdate(
    { _id: medicineId, stock: { $gte: amount } },
    { $inc: { stock: -amount, held: amount } },
    { new: true }
  );
}

/**
 * Put `quantity` held units back on sale (an expired or abandoned hold, FR-1.3).
 *
 * Guarded by `held >= quantity`, so a stale caller cannot drive the counter
 * negative; a medicine deleted in the meantime is skipped like `restoreStock`.
 *
 * @returns {Promise<import('../models/Medicine')|null>}
 */
async function releaseHold(medicineId, quantity) {
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 1) return null;

  return Medicine.findOneAndUpdate(
    { _id: medicineId, held: { $gte: amount } },
    { $inc: { held: -amount, stock: amount } },
    { new: true }
  );
}

/**
 * Turn a live hold into a sale at checkout.
 *
 * `stock` is deliberately untouched: it was already decremented when the hold
 * was taken, so only the promise has to be discharged. This keeps the sale and
 * the reservation in one conditional update instead of two.
 *
 * @returns {Promise<import('../models/Medicine')|null>} null when the medicine
 *   does not hold that many units (e.g. the hold lapsed and was released)
 */
async function convertHoldToSale(medicineId, quantity) {
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 1) return null;

  return Medicine.findOneAndUpdate(
    { _id: medicineId, held: { $gte: amount } },
    { $inc: { held: -amount } },
    { new: true }
  );
}

/**
 * Put units back into `held` without touching `stock`: the exact inverse of
 * `convertHoldToSale()`. Used to undo a conversion when a later line of the same
 * checkout fails, so the customer keeps the promise they had before.
 *
 * @returns {Promise<import('../models/Medicine')|null>}
 */
async function restoreHold(medicineId, quantity) {
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 1) return null;

  return Medicine.findOneAndUpdate(
    { _id: medicineId },
    { $inc: { held: amount } },
    { new: true }
  );
}

/**
 * Atomically clear the hold marker on one cart line and report what should be
 * released. Clearing the marker is the claim: only one caller can succeed.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.cartId
 * @param {import('mongoose').Types.ObjectId|string} params.medicineId
 * @param {Date} [params.now]
 * @param {boolean} [params.expiredOnly] only claim a marker that has lapsed
 * @returns {Promise<{ medicine: unknown, quantity: number }|null>}
 */
async function claimHoldLine({ cartId, medicineId, now = new Date(), expiredOnly = false }) {
  const expiryMatch = expiredOnly ? { $lte: now } : { $gt: now };

  const claimed = await Cart.findOneAndUpdate(
    {
      _id: cartId,
      items: { $elemMatch: { medicine: medicineId, holdExpiresAt: expiryMatch } },
    },
    { $set: { 'items.$[line].holdExpiresAt': null } },
    {
      arrayFilters: [{ 'line.medicine': medicineId, 'line.holdExpiresAt': expiryMatch }],
      new: true,
    }
  );

  if (!claimed) return null;

  const line = claimed.items.find((item) => String(item.medicine) === String(medicineId));
  if (!line || !(line.quantity > 0)) return null;

  return { medicine: line.medicine, quantity: line.quantity };
}

/**
 * Release the hold of one cart line if it has lapsed (FR-1.3).
 *
 * @returns {Promise<{ medicine: unknown, quantity: number }|null>}
 */
async function releaseExpiredLine(cartId, medicineId, now = new Date()) {
  const line = await claimHoldLine({ cartId, medicineId, now, expiredOnly: true });
  if (!line) return null;

  await releaseHold(line.medicine, line.quantity);
  return line;
}

/**
 * Release every lapsed cart hold (FR-1.3). Called by the background sweeper and
 * lazily before a cart is read, so a stale hold is never shown as active.
 *
 * Safe to run concurrently or repeatedly: each line is claimed exactly once.
 *
 * @param {object} [options]
 * @param {Date} [options.now] injectable clock (used by tests)
 * @param {import('mongoose').Types.ObjectId|string} [options.cartId] limit to one cart
 * @returns {Promise<{ scanned: number, released: Array<{ cartId: unknown, medicine: unknown, quantity: number }> }>}
 */
async function releaseExpiredHolds({ now = new Date(), cartId = null } = {}) {
  const filter = { 'items.holdExpiresAt': { $lte: now } };
  if (cartId) filter._id = cartId;

  const carts = await Cart.find(filter).select('items');

  const released = [];
  for (const cart of carts) {
    for (const item of cart.items) {
      if (!isHoldExpired(item.holdExpiresAt, now)) continue;

      const line = await releaseExpiredLine(cart._id, item.medicine, now);
      if (line) released.push({ cartId: cart._id, ...line });
    }
  }

  return { scanned: carts.length, released };
}

/**
 * Release one line's hold, whether it has lapsed or not. Used when the customer
 * removes the line from the cart or empties the cart.
 *
 * @returns {Promise<{ medicine: unknown, quantity: number }|null>} null when the
 *   line was not holding anything (already released, or the guest cart is gone)
 */
async function releaseLineHold(cartId, medicineId, { now = new Date() } = {}) {
  const line = await claimHoldLine({ cartId, medicineId, now, expiredOnly: false });
  if (!line) return null;

  await releaseHold(line.medicine, line.quantity);
  return line;
}

/**
 * Release every **live** hold on one cart. Used when the cart is emptied or a
 * guest cart is merged into an account cart, where the promises must not be
 * carried across to a different cart document.
 *
 * @param {import('../models/Cart')|null} cart
 * @param {object} [options]
 * @param {Date} [options.now] injectable clock (used by tests)
 * @returns {Promise<Array<{ medicine: unknown, quantity: number }>>}
 */
async function releaseCartHolds(cart, { now = new Date() } = {}) {
  if (!cart) return [];

  const released = [];
  for (const item of cart.items) {
    if (!item.holdExpiresAt || isHoldExpired(item.holdExpiresAt, now)) continue;

    const line = await releaseLineHold(cart._id, item.medicine, { now });
    if (line) released.push(line);
  }

  return released;
}

/**
 * Start the background hold sweep. Returns the timer so it can be cleared on
 * shutdown, mirroring `startReplenishSweeper`.
 *
 * `unref()` means the timer never keeps the Node process (or a test run) alive.
 */
function startHoldSweeper({ intervalMs } = {}) {
  const every =
    intervalMs ??
    readWholeNumber('CART_HOLD_SWEEP_INTERVAL_MS', DEFAULT_SWEEP_INTERVAL_MS, { min: 1000 });

  const timer = setInterval(() => {
    releaseExpiredHolds()
      .then((result) => {
        if (result.released.length > 0) {
          const total = result.released.reduce((sum, line) => sum + line.quantity, 0);
          console.log(
            `[cart-holds] released ${total} unit(s) from ${result.released.length} expired hold(s)`
          );
        }
      })
      .catch((err) => console.error(`[cart-holds] hold sweep failed: ${err.message}`));
  }, every);

  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  DEFAULT_CART_HOLD_MINUTES,
  DEFAULT_SWEEP_INTERVAL_MS,
  cartHoldMinutes,
  holdDurationMs,
  holdExpiry,
  isHoldExpired,
  heldQuantity,
  acquireHold,
  releaseHold,
  convertHoldToSale,
  restoreHold,
  claimHoldLine,
  releaseExpiredLine,
  releaseExpiredHolds,
  releaseLineHold,
  releaseCartHolds,
  startHoldSweeper,
};
