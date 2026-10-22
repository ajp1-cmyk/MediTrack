// Order lifecycle helpers: create an order from a cart, reserve stock, and
// release it again when an order is cancelled or expires.
const crypto = require('crypto');
const Order = require('../models/Order');
const Medicine = require('../models/Medicine');
const { httpError } = require('./errors');
const { isExpired } = require('./availability');
const { computeTotals } = require('./pricing');
const { getProviderName } = require('./paymentGateway');

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
 * Validate a cart, reserve stock atomically and persist an order snapshot.
 *
 * If any line cannot be reserved, every earlier reservation in this call is
 * rolled back before the error is re-thrown, so a cart is never half-ordered.
 *
 * @param {object} params
 * @param {import('../models/Cart')|null} params.cart
 * @param {import('../models/User')} params.user
 * @param {object} params.shippingAddress
 * @returns {Promise<import('../models/Order')>}
 */
async function createOrderFromCart({ cart, user, shippingAddress }) {
  if (!cart || cart.items.length === 0) {
    throw httpError(400, 'Your cart is empty. Add a medicine before checking out.');
  }

  const medicines = await Medicine.find({
    _id: { $in: cart.items.map((item) => item.medicine) },
  });
  const byId = new Map(medicines.map((medicine) => [String(medicine._id), medicine]));

  // Validate the whole cart before touching stock.
  const problems = [];
  for (const item of cart.items) {
    const medicine = byId.get(String(item.medicine));
    if (!medicine) {
      problems.push('One of the medicines is no longer available.');
    } else if (isExpired(medicine)) {
      problems.push(`"${medicine.name}" has expired.`);
    } else if (medicine.stock < item.quantity) {
      problems.push(`Only ${medicine.stock} unit(s) of "${medicine.name}" left in stock.`);
    }
  }
  if (problems.length > 0) {
    throw httpError(409, `Your cart needs attention: ${problems.join(' ')}`);
  }

  // Reserve one line at a time with a conditional update. This works on a
  // standalone MongoDB (no replica-set transactions required).
  const reserved = [];
  try {
    for (const item of cart.items) {
      const medicine = byId.get(String(item.medicine));
      const updated = await Medicine.findOneAndUpdate(
        { _id: medicine._id, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { new: true }
      );

      if (!updated) {
        throw httpError(
          409,
          `"${medicine.name}" no longer has ${item.quantity} unit(s) in stock.`
        );
      }
      reserved.push({ medicine: medicine._id, quantity: item.quantity });
    }
  } catch (err) {
    await restoreStock(reserved);
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
      });
      break;
    } catch (err) {
      const isDuplicate = err.code === 11000 && err.keyPattern && err.keyPattern.orderNumber;
      if (!isDuplicate || attempt === 2) {
        await restoreStock(reserved);
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
  createOrderFromCart,
  expireOrderById,
  expireStaleOrders,
};
