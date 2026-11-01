// Wishlist routes (SRS FR-1.5).
//
//   GET    /api/wishlist                                → saved items + live availability
//   POST   /api/wishlist/items                          → { medicineId } — save (idempotent)
//   DELETE /api/wishlist/items/:medicineId              → remove one medicine
//   POST   /api/wishlist/items/:medicineId/move-to-cart → add to cart, then drop from wishlist
//   DELETE /api/wishlist                                → empty the wishlist
//
// A wishlist is private to its owner: the user id always comes from the JWT, so
// a customer can never read or change another account's list. Saving does not
// touch inventory — that is the cart's job — so out-of-stock and expired
// medicines can be saved and are flagged in the response.
const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const { rejectFormBody } = require('../middleware/requestGuards');
const { httpError, asyncHandler } = require('../lib/errors');
const {
  findWishlist,
  addWishlistItem,
  removeWishlistItem,
  clearWishlist,
  serializeWishlist,
} = require('../lib/wishlist');
const { addItemToCart, serializeCart } = require('../lib/cartSession');

const router = express.Router();

// Every wishlist request needs a signed-in account and a JSON body.
router.use(requireAuth);
router.use(rejectFormBody);

// GET /api/wishlist — the saved list with live price, stock and expiry.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await serializeWishlist(await findWishlist(req.user._id)));
  })
);

// POST /api/wishlist/items — save a medicine for later.
router.post(
  '/items',
  asyncHandler(async (req, res) => {
    const wishlist = await addWishlistItem(req.user._id, (req.body || {}).medicineId);
    res.status(201).json(await serializeWishlist(wishlist));
  })
);

// DELETE /api/wishlist/items/:medicineId — remove one medicine.
router.delete(
  '/items/:medicineId',
  asyncHandler(async (req, res) => {
    const wishlist = await removeWishlistItem(req.user._id, req.params.medicineId);
    res.json(await serializeWishlist(wishlist));
  })
);

// POST /api/wishlist/items/:medicineId/move-to-cart — the FR-1.5 move action.
router.post(
  '/items/:medicineId/move-to-cart',
  asyncHandler(async (req, res) => {
    const { medicineId } = req.params;

    if (!mongoose.isValidObjectId(medicineId)) {
      throw httpError(400, 'A valid medicineId is required');
    }

    const saved = await findWishlist(req.user._id);
    if (!saved || !saved.items.some((id) => id.equals(medicineId))) {
      throw httpError(404, 'This medicine is not in your wishlist');
    }

    // Move the line first. When stock, expiry or the per-line limit rejects it,
    // the wishlist stays exactly as it was so the customer can retry later.
    // addItemToCart() is the same helper POST /api/cart/items uses.
    const { cart } = await addItemToCart(req, res, { medicineId });
    const wishlist = await removeWishlistItem(req.user._id, medicineId);

    res.json({
      wishlist: await serializeWishlist(wishlist),
      cart: await serializeCart(cart),
    });
  })
);

// DELETE /api/wishlist — empty the wishlist.
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const wishlist = await clearWishlist(req.user._id);
    res.json(await serializeWishlist(wishlist));
  })
);

module.exports = router;
