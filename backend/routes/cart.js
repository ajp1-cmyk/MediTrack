// Cart routes.
//
// The cart works for anonymous visitors (identified by the signed `mt_cart`
// cookie) and for signed-in users (identified by their JWT). It stores only
// medicine references and quantities; prices and stock always come from the
// medicines collection when the cart is read.
//
//   GET    /api/cart                       → current cart + live totals
//   POST   /api/cart/items                 → add / increment a line
//   PATCH  /api/cart/items/:medicineId     → set quantity (0 removes)
//   DELETE /api/cart/items/:medicineId     → remove a line
//   DELETE /api/cart                       → empty the cart
//   POST   /api/cart/merge                 → fold the guest cart into the account
const express = require('express');
const mongoose = require('mongoose');
const Medicine = require('../models/Medicine');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { rejectFormBody } = require('../middleware/requestGuards');
const { httpError, asyncHandler } = require('../lib/errors');
const { sellabilityIssue } = require('../lib/availability');
const {
  MAX_LINE_QUANTITY,
  findCart,
  getOrCreateCart,
  touchCart,
  mergeGuestCart,
  serializeCart,
  hasCartCookie,
  clearCartCookie,
} = require('../lib/cartSession');

const router = express.Router();

// Every cart request resolves the caller (or leaves them anonymous) and refuses
// form-encoded bodies.
router.use(optionalAuth);
router.use(rejectFormBody);

/** Parse and validate a quantity coming from the client. */
function readQuantity(value, { min = 0, max = MAX_LINE_QUANTITY } = {}) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < min || quantity > max) {
    throw httpError(400, `Quantity must be a whole number between ${min} and ${max}`);
  }
  return quantity;
}

/** Load a medicine or fail with a useful status code. */
async function loadMedicine(medicineId) {
  if (!medicineId || !mongoose.isValidObjectId(medicineId)) {
    throw httpError(400, 'A valid medicineId is required');
  }
  const medicine = await Medicine.findById(medicineId);
  if (!medicine) {
    throw httpError(404, 'Medicine not found');
  }
  return medicine;
}

/** Refuse expired or out-of-stock medicines before they reach a cart. */
function assertSellable(medicine) {
  const issue = sellabilityIssue(medicine);
  if (issue) {
    throw httpError(409, issue);
  }
}

// GET /api/cart — the current cart with live prices, stock and totals.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const cart = await findCart(req);

    // A stale cookie (cart deleted by the TTL index) should not linger.
    if (!cart && !req.user && hasCartCookie(req)) {
      clearCartCookie(res);
    }

    res.json(await serializeCart(cart));
  })
);

// POST /api/cart/items — add a medicine, or increase its quantity.
router.post(
  '/items',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const quantity = body.quantity === undefined ? 1 : readQuantity(body.quantity, { min: 1 });
    const medicine = await loadMedicine(body.medicineId);
    assertSellable(medicine);

    const cart = await getOrCreateCart(req, res);
    const line = cart.items.find((item) => item.medicine.equals(medicine._id));
    const nextQuantity = (line ? line.quantity : 0) + quantity;

    if (nextQuantity > medicine.stock) {
      throw httpError(
        409,
        `Only ${medicine.stock} unit${medicine.stock === 1 ? '' : 's'} of "${medicine.name}" left in stock`
      );
    }

    if (line) {
      line.quantity = nextQuantity;
    } else {
      cart.items.push({ medicine: medicine._id, quantity });
    }

    touchCart(cart);
    await cart.save();

    res.status(201).json(await serializeCart(cart));
  })
);

// PATCH /api/cart/items/:medicineId — set an exact quantity (0 removes).
router.patch(
  '/items/:medicineId',
  asyncHandler(async (req, res) => {
    const quantity = readQuantity((req.body || {}).quantity, { min: 0 });
    const cart = await findCart(req);

    if (!cart) {
      throw httpError(404, 'This medicine is not in your cart');
    }

    const line = cart.items.find((item) => String(item.medicine) === req.params.medicineId);
    if (!line) {
      throw httpError(404, 'This medicine is not in your cart');
    }

    if (quantity === 0) {
      cart.items = cart.items.filter((item) => !item.medicine.equals(line.medicine));
    } else {
      const medicine = await loadMedicine(line.medicine);
      assertSellable(medicine);
      if (quantity > medicine.stock) {
        throw httpError(
          409,
          `Only ${medicine.stock} unit${medicine.stock === 1 ? '' : 's'} of "${medicine.name}" left in stock`
        );
      }
      line.quantity = quantity;
    }

    touchCart(cart);
    await cart.save();

    res.json(await serializeCart(cart));
  })
);

// DELETE /api/cart/items/:medicineId — remove one medicine.
router.delete(
  '/items/:medicineId',
  asyncHandler(async (req, res) => {
    const cart = await findCart(req);
    if (!cart) {
      res.json(await serializeCart(null));
      return;
    }

    cart.items = cart.items.filter(
      (item) => String(item.medicine) !== req.params.medicineId
    );
    touchCart(cart);
    await cart.save();

    res.json(await serializeCart(cart));
  })
);

// DELETE /api/cart — empty the cart. For guests the cart document is removed
// too, so the cookie can be cleared safely.
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const cart = await findCart(req);

    if (cart && cart.user) {
      cart.items = [];
      await cart.save();
    } else if (cart) {
      await cart.deleteOne();
      clearCartCookie(res);
    } else {
      clearCartCookie(res);
    }

    res.json(await serializeCart(null));
  })
);

// POST /api/cart/merge — after signing in, move the guest cart into the account.
router.post(
  '/merge',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cart = await mergeGuestCart(req, res);
    res.json(await serializeCart(cart));
  })
);

module.exports = router;
