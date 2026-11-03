// Cart session handling.
//
// The cart is identified by a *server-side* document. Guests receive a random
// 32-byte token inside a signed, httpOnly cookie; only the SHA-256 hash of that
// token is stored in MongoDB. The cookie therefore carries no cart contents, is
// unreadable from JavaScript (XSS cannot steal the cart), cannot be forged
// (HMAC signature) and cannot be replayed against another database.
const crypto = require('crypto');
const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Medicine = require('../models/Medicine');
const { computeTotals } = require('./pricing');
const { isExpired } = require('./availability');
const {
  acquireHold,
  releaseHold,
  releaseExpiredHolds,
  releaseCartHolds,
  holdExpiry,
  heldQuantity,
} = require('./cartHolds');
const { httpError } = require('./errors');
const { prescriptionStateFor } = require('./prescriptions');
const { purchaseLimitSummary } = require('./purchaseLimit');

const COOKIE_NAME = 'mt_cart';
const COOKIE_PATH = '/api';
const GUEST_CART_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_LINE_QUANTITY = 99;

// Development fallback so `npm run dev` works before .env exists.
const DEV_COOKIE_SECRET = 'meditrack-insecure-cookie-secret-change-me';

function getCookieSecret() {
  return process.env.COOKIE_SECRET || DEV_COOKIE_SECRET;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // Only sent over HTTPS in production; plain HTTP is needed for local dev.
    secure: process.env.NODE_ENV === 'production',
    signed: true,
    path: COOKIE_PATH,
    maxAge: GUEST_CART_TTL_MS,
  };
}

/** Random token placed in the cookie (never stored as-is). */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Hash used for the `tokenHash` database field. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Read the (already signature-verified) cart token from the request, if any. */
function readCartToken(req) {
  const token = req.signedCookies ? req.signedCookies[COOKIE_NAME] : null;
  return typeof token === 'string' && token ? token : null;
}

/** True when the request carried any mt_cart cookie, valid or not. */
function hasCartCookie(req) {
  if (req.cookies && req.cookies[COOKIE_NAME] !== undefined) return true;
  // cookie-parser drops cookies whose signature failed, so also inspect the
  // raw header — those stale cookies are exactly the ones we want to clear.
  const header = req.headers.cookie || '';
  return header
    .split(';')
    .some((part) => part.trim().startsWith(`${COOKIE_NAME}=`));
}

function setCartCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearCartCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    path: COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

/**
 * Find the caller's cart without creating one.
 * Signed-in users always use their account cart; guests use the cookie token.
 */
async function findCart(req) {
  if (req.user) {
    return Cart.findOne({ user: req.user._id });
  }
  const token = readCartToken(req);
  if (!token) return null;
  return Cart.findOne({ tokenHash: hashToken(token) });
}

/**
 * Find the caller's cart, creating one (and setting the cookie for guests) if
 * it does not exist yet.
 */
async function getOrCreateCart(req, res) {
  const existing = await findCart(req);
  if (existing) return existing;

  if (req.user) {
    return Cart.create({ user: req.user._id, items: [] });
  }

  const token = generateToken();
  const cart = await Cart.create({
    tokenHash: hashToken(token),
    items: [],
    expiresAt: new Date(Date.now() + GUEST_CART_TTL_MS),
  });
  setCartCookie(res, token);
  return cart;
}

/** Extend the lifetime of a guest cart after every change. */
function touchCart(cart) {
  if (!cart.user) {
    cart.expiresAt = new Date(Date.now() + GUEST_CART_TTL_MS);
  }
}

/**
 * Units this line can still buy right now: shelf stock plus what it holds.
 */
function availableQuantityForLine(medicine, item, now = new Date()) {
  return medicine.stock + heldQuantity(item, now);
}

/**
 * Find the caller's cart and release any hold that has already lapsed, so every
 * caller works with the cart exactly as the sweeper would leave it (FR-1.3).
 *
 * @returns {Promise<import('../models/Cart')|null>}
 */
async function loadLiveCart(req, { now = new Date() } = {}) {
  const cart = await findCart(req);
  if (!cart) return null;

  const { released } = await releaseExpiredHolds({ cartId: cart._id, now });
  // The in-memory document still carries the released markers, so re-read it.
  return released.length > 0 ? findCart(req) : cart;
}

/**
 * Bring one cart line to exactly `quantity`, taking or releasing the difference
 * in held units and renewing the hold clock (FR-1.2).
 *
 * The counter move happens before the cart is saved and is compensated if the
 * save fails, so the reservation can never leak into `held` unnoticed.
 *
 * @param {import('../models/Cart')} cart
 * @param {import('../models/Medicine')} medicine
 * @param {number} quantity at least 1 (removal is `removeCartLine`)
 * @param {object} [options]
 * @param {Date} [options.now] injectable clock (used by tests)
 */
async function setLineQuantity(cart, medicine, quantity, { now = new Date() } = {}) {
  const line = cart.items.find((item) => item.medicine.equals(medicine._id));
  const held = heldQuantity(line, now);
  const available = medicine.stock + held;

  if (quantity > available) {
    throw httpError(
      409,
      `Only ${available} unit${available === 1 ? '' : 's'} of "${medicine.name}" left in stock`
    );
  }

  const delta = quantity - held;

  if (delta > 0) {
    const acquired = await acquireHold(medicine._id, delta);
    if (!acquired) {
      // Another cart got there first between the read and the conditional write.
      const fresh = await Medicine.findById(medicine._id);
      const left = fresh ? fresh.stock + held : 0;
      throw httpError(
        409,
        `Only ${left} unit${left === 1 ? '' : 's'} of "${medicine.name}" left in stock`
      );
    }
  } else if (delta < 0) {
    await releaseHold(medicine._id, -delta);
  }

  const previous = line ? { quantity: line.quantity, holdExpiresAt: line.holdExpiresAt } : null;

  if (line) {
    line.quantity = quantity;
    line.holdExpiresAt = holdExpiry(now);
  } else {
    cart.items.push({ medicine: medicine._id, quantity, holdExpiresAt: holdExpiry(now) });
  }

  touchCart(cart);

  try {
    await cart.save();
  } catch (err) {
    // The counters moved but the cart did not: put them back. Best effort — the
    // hold sweeper is the backstop if this compensating write also fails.
    if (delta > 0) await releaseHold(medicine._id, delta);
    else if (delta < 0) await acquireHold(medicine._id, -delta);

    if (line) {
      line.quantity = previous.quantity;
      line.holdExpiresAt = previous.holdExpiresAt;
    } else {
      cart.items = cart.items.filter((item) => !item.medicine.equals(medicine._id));
    }
    throw err;
  }
}

/**
 * Drop one line from the cart and hand its held units back (FR-1.3).
 *
 * The marker is cleared with the save, and the units are returned afterwards, so
 * a crash in between leaks a hold rather than overselling.
 *
 * @returns {Promise<boolean>} whether a line was removed
 */
async function removeCartLine(cart, medicineId, { now = new Date() } = {}) {
  const line = cart.items.find((item) => String(item.medicine) === String(medicineId));
  if (!line) return false;

  const held = heldQuantity(line, now);

  cart.items = cart.items.filter((item) => String(item.medicine) !== String(medicineId));
  touchCart(cart);
  await cart.save();

  if (held > 0) await releaseHold(line.medicine, held);
  return true;
}

/**
 * Empty the caller's cart, releasing every hold it owns.
 * Guests lose the cart document (and the cookie) entirely.
 */
async function clearCart(req, res) {
  const cart = await findCart(req);

  if (!cart) {
    clearCartCookie(res);
    return;
  }

  // Clear the markers first: a later failure can then only leak units, never
  // release the same hold twice.
  await releaseCartHolds(cart);

  if (cart.user) {
    cart.items = [];
    await cart.save();
  } else {
    await cart.deleteOne();
    clearCartCookie(res);
  }
}

/**
 * Add `quantity` of one medicine to the caller's cart, enforcing live stock.
 *
 * Shared by POST /api/cart/items and the wishlist "move to cart" action
 * (FR-1.5) so both paths can never disagree about expiry, stock limits or the
 * per-line maximum.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ medicineId: string, quantity?: number }} line
 * @returns {Promise<{ cart: import('../models/Cart'), medicine: import('../models/Medicine') }>}
 */
async function addItemToCart(req, res, { medicineId, quantity = 1 } = {}) {
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_LINE_QUANTITY) {
    throw httpError(
      400,
      `Quantity must be a whole number between 1 and ${MAX_LINE_QUANTITY}`
    );
  }

  if (!medicineId || !mongoose.isValidObjectId(medicineId)) {
    throw httpError(400, 'A valid medicineId is required');
  }

  const medicine = await Medicine.findById(medicineId);
  if (!medicine) {
    throw httpError(404, 'Medicine not found');
  }

  const cart = await getOrCreateCart(req, res);
  const line = cart.items.find((item) => item.medicine.equals(medicine._id));
  const heldNow = heldQuantity(line);

  // Expired stock is never sellable. "Out of stock" only blocks a line that is
  // not already holding units — a line that holds them can still be adjusted.
  if (isExpired(medicine)) {
    throw httpError(409, `"${medicine.name}" has expired and cannot be sold.`);
  }
  if (medicine.stock <= 0 && heldNow === 0) {
    throw httpError(409, `"${medicine.name}" is out of stock.`);
  }

  const nextQuantity = (line ? line.quantity : 0) + amount;
  if (nextQuantity > MAX_LINE_QUANTITY) {
    throw httpError(400, `A cart line cannot hold more than ${MAX_LINE_QUANTITY} units`);
  }

  // setLineQuantity() takes the hold (FR-1.2) and re-clocks it.
  await setLineQuantity(cart, medicine, nextQuantity);

  return { cart, medicine };
}

/**
 * Move everything in the guest cart into the signed-in user's cart, combining
 * duplicate lines and never exceeding current availability (FR-1.5 sign-in flow).
 *
 * The guest's holds end with the guest cart: they are released first, then the
 * merged lines take their own holds, so units are never promised twice.
 *
 * @returns {Promise<import('../models/Cart')>} the user's cart
 */
async function mergeGuestCart(req, res, { now = new Date() } = {}) {
  const userCart = await Cart.findOneAndUpdate(
    { user: req.user._id },
    { $setOnInsert: { user: req.user._id, items: [], expiresAt: null } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const guestToken = readCartToken(req);
  if (guestToken) {
    const guestCart = await Cart.findOne({ tokenHash: hashToken(guestToken) });

    if (guestCart && String(guestCart._id) !== String(userCart._id)) {
      await releaseCartHolds(guestCart, { now });

      const medicines = await Medicine.find({
        _id: { $in: guestCart.items.map((item) => item.medicine) },
      }).select('name stock exp');
      const byId = new Map(medicines.map((medicine) => [String(medicine._id), medicine]));

      const taken = [];
      try {
        for (const guestItem of guestCart.items) {
          const medicine = byId.get(String(guestItem.medicine));
          if (!medicine || isExpired(medicine, now)) continue;

          const existing = userCart.items.find((item) =>
            item.medicine.equals(guestItem.medicine)
          );
          const alreadyHeld = heldQuantity(existing, now);

          const target = Math.min(
            (existing ? existing.quantity : 0) + guestItem.quantity,
            medicine.stock + alreadyHeld,
            MAX_LINE_QUANTITY
          );
          if (target < 1) continue;

          // Hold what the line did not already hold. If another cart took those
          // units first the line merges unheld, and the cart view flags it.
          const wanted = Math.max(0, target - alreadyHeld);
          let extra = 0;
          if (wanted > 0) {
            const acquired = await acquireHold(medicine._id, wanted);
            if (acquired) {
              extra = wanted;
              taken.push({ medicine: medicine._id, quantity: wanted });
            }
          }

          const holdExpiresAt = alreadyHeld + extra > 0 ? holdExpiry(now) : null;
          if (existing) {
            existing.quantity = target;
            existing.holdExpiresAt = holdExpiresAt;
          } else {
            userCart.items.push({
              medicine: guestItem.medicine,
              quantity: target,
              holdExpiresAt,
            });
          }
        }

        await userCart.save();
      } catch (err) {
        // The merge failed, so give back the units it had already reserved.
        for (const line of taken) await releaseHold(line.medicine, line.quantity);
        throw err;
      }

      await Cart.deleteOne({ _id: guestCart._id });
    }
  }

  clearCartCookie(res);
  return userCart;
}

/**
 * Turn a cart document into the JSON the frontend consumes. Prices, stock and
 * availability are read live from the medicines collection.
 *
 * @param {import('../models/Cart')|null} cart
 * @param {object} [options]
 * @param {Date} [options.now] injectable clock (used by tests)
 */
async function serializeCart(cart, { now = new Date() } = {}) {
  if (!cart || cart.items.length === 0) {
    return {
      items: [],
      totals: computeTotals([]),
      itemCount: 0,
      lineCount: 0,
      hasIssues: false,
      hasExpiredHolds: false,
      holdExpiresAt: null,
      holdSecondsLeft: 0,
      // Phase D: Rx status and the daily allowance (null for an empty cart).
      requiresPrescription: false,
      prescription: null,
      purchaseLimit: null,
      updatedAt: cart ? cart.updated_at : null,
    };
  }

  const medicines = await Medicine.find({
    _id: { $in: cart.items.map((item) => item.medicine) },
  });
  const byId = new Map(medicines.map((medicine) => [String(medicine._id), medicine]));

  const lines = [];
  const items = cart.items.map((item) => {
    const medicine = byId.get(String(item.medicine));
    const held = heldQuantity(item, now);

    if (!medicine) {
      return {
        medicineId: String(item.medicine),
        name: 'Unavailable medicine',
        image: null,
        price: 0,
        quantity: item.quantity,
        stock: 0,
        available: false,
        expired: false,
        issue: 'This medicine is no longer available.',
        lineTotal: 0,
        held,
        holdActive: false,
        heldUntil: null,
        holdSecondsLeft: 0,
        holdExpired: false,
        prescriptionRequired: false,
      };
    }

    // `stock` is what this line can still buy: shelf stock plus the units the
    // line already holds, so a customer is never told they own too many.
    const availableStock = availableQuantityForLine(medicine, item, now);
    const expired = isExpired(medicine, now);
    const billableQuantity = expired ? 0 : Math.min(item.quantity, availableStock);
    const lineTotalPaise = Math.round(medicine.price * 100) * billableQuantity;

    if (billableQuantity > 0) {
      lines.push({ unitPrice: medicine.price, quantity: billableQuantity });
    }

    let issue = null;
    if (expired) {
      issue = 'This medicine has expired and cannot be ordered.';
    } else if (availableStock <= 0) {
      issue = 'Out of stock.';
    } else if (item.quantity > availableStock) {
      issue = `Only ${availableStock} left in stock.`;
    }

    const holdActive = held > 0;
    const heldUntil = holdActive ? new Date(item.holdExpiresAt) : null;

    return {
      medicineId: medicine._id.toString(),
      name: medicine.name,
      image: medicine.image,
      price: medicine.price,
      quantity: item.quantity,
      stock: availableStock,
      available: billableQuantity >= item.quantity,
      expired,
      issue,
      lineTotal: Math.round(lineTotalPaise) / 100,
      // FR-1.2 / FR-1.3: what this line is holding, and for how much longer.
      held,
      holdActive,
      heldUntil,
      holdSecondsLeft: heldUntil
        ? Math.max(0, Math.ceil((heldUntil.getTime() - now.getTime()) / 1000))
        : 0,
      // True when the line is in the cart but is not holding stock any more, so
      // the customer is offered a "refresh hold" action instead of losing it.
      holdExpired: !holdActive,
      // FR-1.4: shown as an Rx badge in the cart and at checkout.
      prescriptionRequired: Boolean(medicine.prescriptionRequired),
    };
  });

  const totals = computeTotals(lines);

  // Phase D: the cart-level Rx flag and the customer's prescription status, plus
  // the remaining daily allowance (null for guests, who cannot check out).
  const requiresPrescription = items.some((item) => item.prescriptionRequired);
  const [prescription, purchaseLimit] = cart.user
    ? await Promise.all([
        prescriptionStateFor(cart.user, now),
        purchaseLimitSummary(cart.user, now),
      ])
    : [null, null];

  // Cart-level hold summary (NFR-2.2): the earliest deadline is the one that
  // matters, because losing it releases that line's units first.
  const activeHolds = items.filter((item) => item.holdActive && item.heldUntil);
  const holdExpiresAt =
    activeHolds.length > 0
      ? new Date(Math.min(...activeHolds.map((item) => item.heldUntil.getTime())))
      : null;

  return {
    items,
    totals,
    itemCount: totals.itemCount,
    lineCount: items.length,
    hasIssues: items.some((item) => item.issue !== null),
    hasExpiredHolds: items.some((item) => item.holdExpired),
    holdExpiresAt,
    holdSecondsLeft: holdExpiresAt
      ? Math.max(0, Math.ceil((holdExpiresAt.getTime() - now.getTime()) / 1000))
      : 0,
    // FR-1.4 / FR-2.1 / NFR-2.2: what the checkout page needs to explain why
    // the order can or cannot be placed.
    requiresPrescription,
    prescription,
    purchaseLimit,
    updatedAt: cart.updated_at,
  };
}

module.exports = {
  COOKIE_NAME,
  COOKIE_PATH,
  GUEST_CART_TTL_MS,
  MAX_LINE_QUANTITY,
  DEV_COOKIE_SECRET,
  getCookieSecret,
  cookieOptions,
  generateToken,
  hashToken,
  readCartToken,
  hasCartCookie,
  setCartCookie,
  clearCartCookie,
  findCart,
  loadLiveCart,
  getOrCreateCart,
  heldQuantity,
  availableQuantityForLine,
  setLineQuantity,
  addItemToCart,
  removeCartLine,
  clearCart,
  touchCart,
  mergeGuestCart,
  serializeCart,
};
