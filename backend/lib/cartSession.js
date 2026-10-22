// Cart session handling.
//
// The cart is identified by a *server-side* document. Guests receive a random
// 32-byte token inside a signed, httpOnly cookie; only the SHA-256 hash of that
// token is stored in MongoDB. The cookie therefore carries no cart contents, is
// unreadable from JavaScript (XSS cannot steal the cart), cannot be forged
// (HMAC signature) and cannot be replayed against another database.
const crypto = require('crypto');
const Cart = require('../models/Cart');
const Medicine = require('../models/Medicine');
const { computeTotals } = require('./pricing');
const { isExpired } = require('./availability');

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
 * Move everything in the guest cart into the signed-in user's cart, combining
 * duplicate lines and never exceeding current stock.
 *
 * @returns {Promise<import('../models/Cart')>} the user's cart
 */
async function mergeGuestCart(req, res) {
  const userCart = await Cart.findOneAndUpdate(
    { user: req.user._id },
    { $setOnInsert: { user: req.user._id, items: [], expiresAt: null } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const guestToken = readCartToken(req);
  if (guestToken) {
    const guestCart = await Cart.findOne({ tokenHash: hashToken(guestToken) });

    if (guestCart && String(guestCart._id) !== String(userCart._id)) {
      const medicines = await Medicine.find({
        _id: { $in: guestCart.items.map((item) => item.medicine) },
      }).select('name stock exp');
      const byId = new Map(medicines.map((medicine) => [String(medicine._id), medicine]));

      for (const guestItem of guestCart.items) {
        const medicine = byId.get(String(guestItem.medicine));
        if (!medicine || isExpired(medicine) || medicine.stock < 1) continue;

        const existing = userCart.items.find((item) => item.medicine.equals(guestItem.medicine));
        const combined = Math.min(
          (existing ? existing.quantity : 0) + guestItem.quantity,
          medicine.stock,
          MAX_LINE_QUANTITY
        );
        if (combined < 1) continue;

        if (existing) {
          existing.quantity = combined;
        } else {
          userCart.items.push({ medicine: guestItem.medicine, quantity: combined });
        }
      }

      await userCart.save();
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
      };
    }

    const expired = isExpired(medicine, now);
    const billableQuantity = expired ? 0 : Math.min(item.quantity, medicine.stock);
    const lineTotalPaise = Math.round(medicine.price * 100) * billableQuantity;

    if (billableQuantity > 0) {
      lines.push({ unitPrice: medicine.price, quantity: billableQuantity });
    }

    let issue = null;
    if (expired) {
      issue = 'This medicine has expired and cannot be ordered.';
    } else if (medicine.stock <= 0) {
      issue = 'Out of stock.';
    } else if (item.quantity > medicine.stock) {
      issue = `Only ${medicine.stock} left in stock.`;
    }

    return {
      medicineId: medicine._id.toString(),
      name: medicine.name,
      image: medicine.image,
      price: medicine.price,
      quantity: item.quantity,
      stock: medicine.stock,
      available: billableQuantity >= item.quantity,
      expired,
      issue,
      lineTotal: Math.round(lineTotalPaise) / 100,
    };
  });

  const totals = computeTotals(lines);

  return {
    items,
    totals,
    itemCount: totals.itemCount,
    lineCount: items.length,
    hasIssues: items.some((item) => item.issue !== null),
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
  getOrCreateCart,
  touchCart,
  mergeGuestCart,
  serializeCart,
};
