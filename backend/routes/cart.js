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
const { isExpired } = require('../lib/availability');
const {
  MAX_LINE_QUANTITY,
  loadLiveCart,
  addItemToCart,
  setLineQuantity,
  removeCartLine,
  clearCart,
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

/**
 * Refuse an expired medicine. Stock is decided per line instead of here: a line
 * that already holds units may still see `stock` at zero (FR-1.2).
 */
function assertNotExpired(medicine) {
  if (isExpired(medicine)) {
    throw httpError(409, `"${medicine.name}" has expired and cannot be sold.`);
  }
}

// GET /api/cart — the current cart with live prices, stock, holds and totals.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Lapsed holds are released here as well as by the background sweeper, so a
    // stale hold is never presented as active (FR-1.3).
    const cart = await loadLiveCart(req);

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
    // Stock, expiry and the per-line limit are enforced inside addItemToCart(),
    // which the wishlist "move to cart" action shares.
    const { cart } = await addItemToCart(req, res, {
      medicineId: body.medicineId,
      quantity: body.quantity === undefined ? 1 : body.quantity,
    });

    res.status(201).json(await serializeCart(cart));
  })
);

// PATCH /api/cart/items/:medicineId — set an exact quantity (0 removes).
router.patch(
  '/items/:medicineId',
  asyncHandler(async (req, res) => {
    const quantity = readQuantity((req.body || {}).quantity, { min: 0 });
    const cart = await loadLiveCart(req);

    if (!cart) {
      throw httpError(404, 'This medicine is not in your cart');
    }

    const line = cart.items.find((item) => String(item.medicine) === req.params.medicineId);
    if (!line) {
      throw httpError(404, 'This medicine is not in your cart');
    }

    if (quantity === 0) {
      // Removing the line hands its held units back (FR-1.3).
      await removeCartLine(cart, req.params.medicineId);
    } else {
      const medicine = await loadMedicine(line.medicine);
      assertNotExpired(medicine);
      // Takes or releases the difference, and re-clocks this line's hold.
      await setLineQuantity(cart, medicine, quantity);
    }

    res.json(await serializeCart(cart));
  })
);

// DELETE /api/cart/items/:medicineId — remove one medicine and release its hold.
router.delete(
  '/items/:medicineId',
  asyncHandler(async (req, res) => {
    const cart = await loadLiveCart(req);
    if (!cart) {
      res.json(await serializeCart(null));
      return;
    }

    await removeCartLine(cart, req.params.medicineId);

    res.json(await serializeCart(cart));
  })
);

// DELETE /api/cart — empty the cart and release every hold it owns. For guests
// the cart document is removed too, so the cookie can be cleared safely.
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    await clearCart(req, res);
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
