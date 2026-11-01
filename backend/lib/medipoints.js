// MediPoints rules (SRS FR-2.4).
//
// Points are credited **only** after the payment provider has confirmed the
// payment: a declined card, a cancelled order or a cash-on-delivery order whose
// money has not been collected yet earns nothing. Crediting is idempotent —
// the ledger has a unique index on `order`, so replaying a payment request is
// harmless.
//
// Rule (configurable): 1 point per ₹100 spent on medicines — the subtotal, so
// delivery and tax do not earn points.
//   MEDIPOINTS_PER_100=1
const MediPointsEntry = require('../models/MediPointsEntry');
const { toPaise } = require('./pricing');

const DEFAULT_PER_100 = 1;
const PAISE_PER_BLOCK = 100 * 100; // ₹100 in paise

function pointsPer100() {
  const value = Number(process.env.MEDIPOINTS_PER_100);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_PER_100;
}

/**
 * How many points a spend of `amount` rupees earns.
 * Whole ₹100 blocks only — ₹199.90 earns the same as ₹100.
 */
function pointsForAmount(amount) {
  return Math.floor(toPaise(amount) / PAISE_PER_BLOCK) * pointsPer100();
}

/**
 * Credit the points for a paid order. Safe to call more than once.
 *
 * @param {import('../models/Order')} order
 * @returns {Promise<import('../models/MediPointsEntry')|null>} the new entry,
 *   or null when nothing was credited (not paid yet / too small / already credited)
 */
async function creditOrderPoints(order) {
  if (!order || !order.payment || order.payment.status !== 'succeeded') return null;

  const points = pointsForAmount(order.totals ? order.totals.subtotal : 0);
  if (points <= 0) return null;

  try {
    return await MediPointsEntry.create({
      user: order.user,
      order: order._id,
      type: 'earn',
      points,
      reason: `Order ${order.orderNumber}`,
    });
  } catch (err) {
    // Duplicate key on `order` = this order already earned its points.
    if (err.code === 11000) return null;
    throw err;
  }
}

/** Balance, lifetime earnings and the most recent ledger entries for a customer. */
async function pointsSummary(userId, { limit = 20 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

  const [totals, entries] = await Promise.all([
    MediPointsEntry.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          balance: { $sum: '$points' },
          totalEarned: { $sum: { $cond: [{ $gt: ['$points', 0] }, '$points', 0] } },
        },
      },
    ]),
    MediPointsEntry.find({ user: userId }).sort({ created_at: -1 }).limit(safeLimit),
  ]);

  return {
    balance: totals[0] ? totals[0].balance : 0,
    totalEarned: totals[0] ? totals[0].totalEarned : 0,
    pointsPer100: pointsPer100(),
    entries,
  };
}

module.exports = { pointsPer100, pointsForAmount, creditOrderPoints, pointsSummary };
