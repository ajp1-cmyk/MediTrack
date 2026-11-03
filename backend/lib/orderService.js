// Order lifecycle helpers: create an order from a cart, reserve stock, and
// release it again when an order is cancelled or expires.
const crypto = require('crypto');
const Order = require('../models/Order');
const Medicine = require('../models/Medicine');
const { httpError } = require('./errors');
const { isExpired } = require('./availability');
const { computeTotals } = require('./pricing');
const { getProviderName } = require('./paymentGateway');
const {
  convertHoldToSale,
  restoreHold,
  heldQuantity,
} = require('./cartHolds');
const { prescriptionForCheckout } = require('./prescriptions');
const { assertWithinDailyLimit } = require('./purchaseLimit');

const DEFAULT_RESERVATION_MINUTES = 30;

function reservationMinutes() {
  const value = Number(process.env.ORDER_RESERVATION_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RESERVATION_MINUTES;
}

/** A short, human-readable order number (unique index enforces uniqueness). */
function generateOrderNumber(now = new Date()) {
  return `MT-${now.getUTCFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * Put stock back for a set of order lines. Medicines that were deleted in the
 * meantime are skipped silently.
 */
async function restoreStock(items = []) {
  if (!items.length) return;
  await Promise.all(
    items.map((item) =>
      Medicine.updateOne({ _id: item.medicine }, { $inc: { stock: item.quantity } })
    )
  );
}

/**
 * Undo the counter moves of a failed checkout: units reserved from the shelf go
 * back on sale, and units converted from a hold become holds again, so the
 * customer keeps the reservation they had before the attempt (FR-2.2).
 */
async function rollbackMoves(moves = []) {
  for (const move of moves) {
    if (move.stock > 0) {
      await Medicine.updateOne({ _id: move.medicine }, { $inc: { stock: move.stock } });
    }
    if (move.held > 0) {
      // Put the promise back without touching `stock`, which never moved.
      await restoreHold(move.medicine, move.held);
    }
  }
}

/**
 * Validate a cart, turn its holds into sales and persist an order snapshot.
 *
 * Each line is one conditional update: a live hold is discharged from `held`
 * (the units left `stock` when the hold was taken), and anything the line does
 * not hold — a lapsed hold, or a cart created before Phase C — is reserved from
 * `stock` in the same pass. If any line cannot be satisfied, every earlier
 * counter move in this call is rolled back before the error is re-thrown, so a
 * cart is never half-ordered.
 *
 * @param {object} params
 * @param {import('../models/Cart')|null} params.cart
 * @param {import('../models/User')} params.user
 * @param {object} params.shippingAddress
 * @param {Date} [params.now] injectable clock (used by tests)
 * @returns {Promise<import('../models/Order')>}
 */
async function createOrderFromCart({ cart, user, shippingAddress, now = new Date() }) {
  if (!cart || cart.items.length === 0) {
    throw httpError(400, 'Your cart is empty. Add a medicine before checking out.');
  }

  const medicines = await Medicine.find({
    _id: { $in: cart.items.map((item) => item.medicine) },
  });
  const byId = new Map(medicines.map((medicine) => [String(medicine._id), medicine]));

  // Validate the whole cart before touching any counter.
  const problems = [];
  const plans = [];
  for (const item of cart.items) {
    const medicine = byId.get(String(item.medicine));
    if (!medicine) {
      problems.push('One of the medicines is no longer available.');
      continue;
    }
    if (isExpired(medicine, now)) {
      problems.push(`"${medicine.name}" has expired.`);
      continue;
    }

    const held = heldQuantity(item, now);
    const available = medicine.stock + held;
    if (available < item.quantity) {
      problems.push(`Only ${available} unit(s) of "${medicine.name}" left in stock.`);
      continue;
    }

    plans.push({ item, medicine, held });
  }
  if (problems.length > 0) {
    throw httpError(409, `Your cart needs attention: ${problems.join(' ')}`);
  }

  // FR-2.1: prescription-only lines need one verified, still-valid prescription.
  // Checked before any counter moves, so a blocked checkout changes nothing.
  const prescription = await prescriptionForCheckout({ plans, user, now });

  // Fair-use cap: at most DAILY_PURCHASE_LIMIT units per customer per day.
  await assertWithinDailyLimit({ user, cart, now });

  // Convert each hold, or reserve from the shelf when the hold has lapsed. One
  // conditional update per line; compensated below if a later line fails.
  const moves = [];
  try {
    for (const { item, medicine, held } of plans) {
      const fromHold = Math.min(held, item.quantity);
      const fromStock = item.quantity - fromHold;

      if (fromHold > 0) {
        const sold = await convertHoldToSale(medicine._id, fromHold);
        if (!sold) {
          throw httpError(
            409,
            `"${medicine.name}" is no longer being held for you. Please refresh your cart.`
          );
        }
        moves.push({ medicine: medicine._id, held: fromHold, stock: 0 });
      }

      if (fromStock > 0) {
        const reserved = await Medicine.findOneAndUpdate(
          { _id: medicine._id, stock: { $gte: fromStock } },
          { $inc: { stock: -fromStock } },
          { new: true }
        );

        if (!reserved) {
          throw httpError(
            409,
            `"${medicine.name}" no longer has ${fromStock} unit(s) in stock.`
          );
        }
        moves.push({ medicine: medicine._id, held: 0, stock: fromStock });
      }
    }
  } catch (err) {
    await rollbackMoves(moves);
    throw err;
  }

  const items = cart.items.map((item) => {
    const medicine = byId.get(String(item.medicine));
    return {
      medicine: medicine._id,
      name: medicine.name,
      image: medicine.image,
      unitPrice: medicine.price,
      quantity: item.quantity,
      lineTotal: Math.round(Math.round(medicine.price * 100) * item.quantity) / 100,
    };
  });

  const totals = computeTotals(items);
  const expiresAt = new Date(Date.now() + reservationMinutes() * 60 * 1000);
  const provider = getProviderName();

  // The order number is random; retry once or twice on the astronomically
  // unlikely collision instead of failing the checkout.
  let order;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      order = await Order.create({
        orderNumber: generateOrderNumber(),
        user: user._id,
        items,
        shippingAddress,
        totals,
        status: 'pending_payment',
        payment: { provider, method: null, status: 'pending' },
        expiresAt,
        // Snapshot of the prescription that unlocked the Rx-only lines.
        prescription: prescription ? prescription._id : null,
        prescriptionValidUntil: prescription ? prescription.validUntil : null,
      });
      break;
    } catch (err) {
      const isDuplicate = err.code === 11000 && err.keyPattern && err.keyPattern.orderNumber;
      if (!isDuplicate || attempt === 2) {
        await rollbackMoves(moves);
        throw err;
      }
    }
  }

  // The order now owns the stock; the cart is no longer needed.
  cart.items = [];
  try {
    await cart.save();
  } catch (err) {
    // The order and its reservation are already committed — a failed cart
    // cleanup must not turn a successful checkout into an error.
    console.error('Failed to clear the cart after checkout:', err.message);
  }

  return order;
}

/**
 * Mark one pending order as expired and release its stock. Uses an atomic
 * status transition so two concurrent requests cannot restore stock twice.
 */
async function expireOrderById(orderId, now = new Date()) {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, status: 'pending_payment', expiresAt: { $lte: now } },
    { $set: { status: 'expired', 'payment.status': 'cancelled', expiresAt: null } },
    { new: true }
  );

  if (order) {
    await restoreStock(order.items);
  }
  return order;
}

/**
 * Release every pending order in `filter` whose reservation has lapsed.
 * Called before listing/reading orders and before paying.
 */
async function expireStaleOrders(filter = {}, now = new Date()) {
  const stale = await Order.find({
    status: 'pending_payment',
    expiresAt: { $lte: now },
    ...filter,
  }).select('_id');

  for (const order of stale) {
    await expireOrderById(order._id, now);
  }
  return stale.length;
}

module.exports = {
  reservationMinutes,
  generateOrderNumber,
  restoreStock,
  rollbackMoves,
  createOrderFromCart,
  expireOrderById,
  expireStaleOrders,
};
