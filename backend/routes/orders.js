// Order and payment routes (all require a signed-in user).
//
//   POST   /api/orders             → create an order from the cart
//   GET    /api/orders             → the user's order history
//   GET    /api/orders/:id         → one order (owner only)
//   POST   /api/orders/:id/pay     → charge the order (idempotent)
//   POST   /api/orders/:id/cancel  → cancel while still awaiting payment
const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { requireAuth } = require('../middleware/auth');
const { rejectFormBody } = require('../middleware/requestGuards');
const { httpError, asyncHandler } = require('../lib/errors');
const { findCart } = require('../lib/cartSession');
const {
  createOrderFromCart,
  expireStaleOrders,
  expireOrderById,
  restoreStock,
} = require('../lib/orderService');
const paymentGateway = require('../lib/paymentGateway');

const router = express.Router();

router.use(requireAuth);
router.use(rejectFormBody);

/** Validate `:id` and load an order that belongs to the caller. */
async function loadOwnOrder(req) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw httpError(404, 'Order not found');
  }
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) {
    // Deliberately 404 (not 403) so other users' order ids stay private.
    throw httpError(404, 'Order not found');
  }
  return order;
}

/**
 * Expire this user's lapsed reservations. Doing it per user keeps the work
 * bounded and means a stale order is correct as soon as it is looked at.
 */
async function releaseExpiredForUser(userId, extraFilter = {}) {
  await expireStaleOrders({ user: userId, ...extraFilter });
}

// POST /api/orders — turn the server-side cart into an order.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const cart = await findCart(req);
    const order = await createOrderFromCart({
      cart,
      user: req.user,
      shippingAddress: (req.body || {}).shippingAddress,
    });
    res.status(201).json(order);
  })
);

// GET /api/orders — newest first.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    await releaseExpiredForUser(req.user._id);
    const orders = await Order.find({ user: req.user._id }).sort({ created_at: -1 });
    res.json(orders);
  })
);

// GET /api/orders/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw httpError(404, 'Order not found');
    }
    await releaseExpiredForUser(req.user._id, { _id: req.params.id });
    const order = await loadOwnOrder(req);
    res.json(order);
  })
);

// POST /api/orders/:id/pay — run the configured payment provider.
router.post(
  '/:id/pay',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const method = String(body.method || '').toLowerCase();

    if (!Order.PAYMENT_METHODS.includes(method)) {
      throw httpError(400, `Payment method must be one of: ${Order.PAYMENT_METHODS.join(', ')}`);
    }

    const order = await loadOwnOrder(req);

    // Paying again after success is a no-op (safe against double submits).
    if (order.status === 'paid' || order.status === 'processing') {
      res.json(order);
      return;
    }

    if (order.status === 'pending_payment' && order.expiresAt && order.expiresAt <= new Date()) {
      await expireOrderById(order._id);
      throw httpError(409, 'This order expired before payment. Please place the order again.');
    }

    if (order.status !== 'pending_payment') {
      throw httpError(409, `This order is ${order.status.replace('_', ' ')} and cannot be paid.`);
    }

    let result;
    try {
      result = await paymentGateway.charge({
        order,
        method,
        details: body.details || {},
      });
    } catch (err) {
      // A provider outage should not mark the order failed.
      throw httpError(502, `Payment could not be started: ${err.message}`);
    }

    order.payment.provider = paymentGateway.getProviderName();
    order.payment.method = method;

    // A real provider may need a redirect; the frontend handles this shape.
    if (result.status === 'redirect' && result.redirectUrl) {
      await order.save();
      res.json({ order, redirectUrl: result.redirectUrl });
      return;
    }

    if (result.status !== 'succeeded') {
      order.payment.status = 'failed';
      order.payment.failureReason = result.failureReason || 'Payment failed.';
      order.payment.transactionId = null;
      await order.save();
      res.status(402).json({ error: order.payment.failureReason, order });
      return;
    }

    const isCod = method === 'cod';
    order.payment.status = isCod ? 'pending' : 'succeeded';
    order.payment.transactionId = result.transactionId;
    order.payment.last4 = result.last4;
    order.payment.brand = result.brand;
    order.payment.failureReason = null;
    order.payment.paidAt = isCod ? null : new Date();
    order.status = isCod ? 'processing' : 'paid';
    order.expiresAt = null;
    await order.save();

    res.json(order);
  })
);

// POST /api/orders/:id/cancel — release the reserved stock.
router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw httpError(404, 'Order not found');
    }

    // Atomic claim so a concurrent expiry cannot restore stock twice.
    const cancelled = await Order.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id, status: 'pending_payment' },
      {
        $set: {
          status: 'cancelled',
          'payment.status': 'cancelled',
          'payment.failureReason': 'Cancelled by the customer.',
          expiresAt: null,
        },
      },
      { new: true }
    );

    if (!cancelled) {
      const current = await loadOwnOrder(req);
      if (current.status === 'cancelled') {
        res.json(current);
        return;
      }
      throw httpError(409, 'Only orders awaiting payment can be cancelled.');
    }

    await restoreStock(cancelled.items);
    res.json(cancelled);
  })
);

module.exports = router;
