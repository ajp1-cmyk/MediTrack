// Daily purchase cap (fair-use limit).
//
// A customer may buy at most DAILY_PURCHASE_LIMIT units of medicines per UTC
// calendar day, across every order. The cap is checked when an order is created
// (the moment stock is reserved), so it cannot be bypassed by adding to the cart
// from several tabs:
//
//   units ordered today  +  units in this cart  >  limit   →  409
//
// Orders in `pending_payment` count, because they already hold stock. Cancelled
// and expired orders do not count, so a customer who abandons a checkout can
// order again later the same day.
//
// Configuration (backend/.env):
//   DAILY_PURCHASE_LIMIT=10    (0 disables the cap)
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { httpError } = require('./errors');

const DEFAULT_DAILY_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
// Orders that still represent a purchase. `cancelled` and `expired` released
// their stock and therefore do not count towards the cap.
const COUNTED_STATUSES = ['pending_payment', 'paid', 'processing', 'shipped', 'delivered'];

/**
 * The configured cap. `0` disables the limit; an invalid value falls back to the
 * default so a typo cannot silently remove the protection.
 */
function dailyPurchaseLimit() {
  const raw = process.env.DAILY_PURCHASE_LIMIT;
  if (raw === undefined || raw === '') return DEFAULT_DAILY_LIMIT;
  // Only plain digits are accepted; a typo (or a stray space) must not silently
  // remove the protection by parsing as 0.
  const digits = String(raw).trim();
  if (!/^\d+$/.test(digits)) return DEFAULT_DAILY_LIMIT;
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value < 0) return DEFAULT_DAILY_LIMIT;
  return value;
}

/** Midnight UTC at the start of the day containing `now`. */
function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Midnight UTC at the end of the day containing `now` (when the cap resets). */
function endOfUtcDay(now = new Date()) {
  return new Date(startOfUtcDay(now).getTime() + DAY_MS);
}

/** Units the customer has already ordered today (whole units). */
async function unitsOrderedToday(userId, now = new Date()) {
  if (!userId) return 0;

  // Aggregation pipelines are not cast by Mongoose, so normalise the id.
  const id = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const [row] = await Order.aggregate([
    {
      $match: {
        user: id,
        status: { $in: COUNTED_STATUSES },
        created_at: { $gte: startOfUtcDay(now), $lt: endOfUtcDay(now) },
      },
    },
    { $unwind: '$items' },
    { $group: { _id: null, units: { $sum: '$items.quantity' } } },
  ]);

  return row ? row.units : 0;
}

/**
 * The allowance shown in the cart / checkout (NFR-2.2).
 *
 * `remaining` is what is left *before* the current cart, so the UI can compare
 * it with the number of items in the cart.
 */
async function purchaseLimitSummary(userId, now = new Date()) {
  const limit = dailyPurchaseLimit();
  const resetsAt = endOfUtcDay(now);

  if (!userId) {
    return { enabled: false, limit, used: 0, remaining: limit, resetsAt };
  }
  if (limit === 0) {
    return { enabled: false, limit: 0, used: await unitsOrderedToday(userId, now), remaining: null, resetsAt };
  }

  const used = await unitsOrderedToday(userId, now);
  return {
    enabled: true,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetsAt,
  };
}

/**
 * Enforce the cap for a checkout, before any stock counter moves.
 *
 * @param {object} params
 * @param {import('../models/User')} params.user
 * @param {import('../models/Cart')} params.cart
 * @param {Date} [params.now] injectable clock (used by tests)
 * @returns {Promise<{ limit: number, used: number, requested: number }|null>}
 */
async function assertWithinDailyLimit({ user, cart, now = new Date() }) {
  const limit = dailyPurchaseLimit();
  if (!limit || !user) return null;

  const used = await unitsOrderedToday(user._id, now);
  const requested = (cart.items || []).reduce((sum, item) => sum + item.quantity, 0);

  if (used + requested > limit) {
    throw httpError(
      409,
      `Daily purchase limit reached: each customer can buy at most ${limit} unit(s) per day. ` +
        `You have already ordered ${used} today, and this order has ${requested}. ` +
        'The allowance resets at midnight UTC.'
    );
  }

  return { limit, used, requested };
}

module.exports = {
  DEFAULT_DAILY_LIMIT,
  COUNTED_STATUSES,
  dailyPurchaseLimit,
  startOfUtcDay,
  endOfUtcDay,
  unitsOrderedToday,
  purchaseLimitSummary,
  assertWithinDailyLimit,
};
