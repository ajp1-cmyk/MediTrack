// Wishlist helpers (SRS FR-1.5).
//
// The wishlist is a "save for later" list that is independent of the cart. It
// never reserves stock — only the cart (and, later, cart-level soft holds) does
// that — so out-of-stock and expired medicines may be saved. They are flagged
// in the serialised response instead, and the UI disables "move to cart".
const mongoose = require('mongoose');
const Wishlist = require('../models/Wishlist');
const Medicine = require('../models/Medicine');
const { isExpired } = require('./availability');
const { httpError } = require('./errors');

/** Shape returned when the account has no wishlist (or an empty one). */
function emptyWishlist(updatedAt = null) {
  return {
    items: [],
    itemCount: 0,
    availableCount: 0,
    hasIssues: false,
    updatedAt,
  };
}

/** The caller's wishlist, or null when they have never saved anything. */
async function findWishlist(userId) {
  return Wishlist.findOne({ user: userId });
}

/**
 * Find or create the caller's wishlist.
 *
 * The unique index on `user` makes the upsert atomic. If two first-time saves
 * race, one of them hits a duplicate-key error; re-reading then returns the
 * wishlist the winner created.
 */
async function getOrCreateWishlist(userId) {
  try {
    return await Wishlist.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: userId, items: [] } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err.code === 11000) {
      return Wishlist.findOne({ user: userId });
    }
    throw err;
  }
}

/**
 * Save a medicine. Idempotent: saving an item that is already on the list is
 * not an error and does not duplicate the entry.
 *
 * @returns {Promise<import('../models/Wishlist')>}
 */
async function addWishlistItem(userId, medicineId) {
  if (!medicineId || !mongoose.isValidObjectId(medicineId)) {
    throw httpError(400, 'A valid medicineId is required');
  }

  const medicine = await Medicine.findById(medicineId);
  if (!medicine) {
    throw httpError(404, 'Medicine not found');
  }

  await getOrCreateWishlist(userId);
  return Wishlist.findOneAndUpdate(
    { user: userId },
    { $addToSet: { items: medicine._id } },
    { new: true }
  );
}

/**
 * Remove one medicine. Removing something that is not on the list is a no-op so
 * a repeated click, or two tabs, cannot fail.
 */
async function removeWishlistItem(userId, medicineId) {
  if (!medicineId || !mongoose.isValidObjectId(medicineId)) {
    throw httpError(400, 'A valid medicineId is required');
  }

  return Wishlist.findOneAndUpdate(
    { user: userId },
    { $pull: { items: medicineId } },
    { new: true }
  );
}

/** Empty the list but keep the wishlist document (and its identity). */
async function clearWishlist(userId) {
  return Wishlist.findOneAndUpdate(
    { user: userId },
    { $set: { items: [] } },
    { new: true }
  );
}

/**
 * Turn a wishlist document into the JSON the frontend consumes.
 *
 * Prices, stock and expiry are read live, exactly like the cart, so a stale
 * wishlist can never show a price the customer would not actually pay.
 *
 * @param {import('../models/Wishlist')|null} wishlist
 * @param {object} [options]
 * @param {Date} [options.now] injectable clock (used by tests)
 */
async function serializeWishlist(wishlist, { now = new Date() } = {}) {
  if (!wishlist || wishlist.items.length === 0) {
    return emptyWishlist(wishlist ? wishlist.updated_at : null);
  }

  const medicines = await Medicine.find({ _id: { $in: wishlist.items } });
  const byId = new Map(medicines.map((medicine) => [String(medicine._id), medicine]));

  const items = wishlist.items.map((medicineId) => {
    const medicine = byId.get(String(medicineId));

    if (!medicine) {
      return {
        medicineId: String(medicineId),
        name: 'Unavailable medicine',
        image: null,
        price: 0,
        stock: 0,
        mfd: null,
        exp: null,
        prescriptionRequired: false,
        available: false,
        expired: false,
        issue: 'This medicine is no longer available.',
      };
    }

    const expired = isExpired(medicine, now);
    const inStock = medicine.stock > 0;

    let issue = null;
    if (expired) {
      issue = 'This medicine has expired.';
    } else if (!inStock) {
      issue = 'Out of stock.';
    }

    return {
      medicineId: medicine._id.toString(),
      name: medicine.name,
      image: medicine.image,
      price: medicine.price,
      stock: medicine.stock,
      mfd: medicine.mfd,
      exp: medicine.exp,
      prescriptionRequired: medicine.prescriptionRequired,
      available: !expired && inStock,
      expired,
      issue,
    };
  });

  return {
    items,
    itemCount: items.length,
    availableCount: items.filter((item) => item.available).length,
    hasIssues: items.some((item) => item.issue !== null),
    updatedAt: wishlist.updated_at,
  };
}

module.exports = {
  emptyWishlist,
  findWishlist,
  getOrCreateWishlist,
  addWishlistItem,
  removeWishlistItem,
  clearWishlist,
  serializeWishlist,
};
