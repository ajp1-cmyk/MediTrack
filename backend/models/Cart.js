// Cart collection.
//
// A cart belongs to exactly one of:
//   • a signed-in user  → `user` is set
//   • a guest visitor   → `tokenHash` is set (shipped in the signed httpOnly
//                         `mt_cart` cookie — the raw token never touches the DB)
//
// Only the medicine reference and the quantity are stored. Names, prices and
// stock are read live from the `medicines` collection every time the cart is
// serialised, so a price change or a sell-out is reflected immediately and the
// client can never dictate what it pays.
const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
  {
    medicine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      validate: {
        validator: Number.isInteger,
        message: 'Quantity must be a whole number',
      },
    },
    // When the soft hold on this line lapses (SRS FR-1.2 / FR-1.3).
    //
    // `null` means the line is not holding any stock: either it never did or
    // the hold expired and lib/cartHolds.js already returned the units to
    // `Medicine.stock`. An expired line stays in the cart — the customer is
    // asked to refresh the hold rather than losing the item silently.
    holdExpiresAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // SHA-256 hash of the random token kept in the signed cookie.
    tokenHash: {
      type: String,
      default: null,
      select: false,
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
    // Guest carts are removed automatically after 30 days. User carts have no
    // expiry and survive until the account is removed.
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.tokenHash;
        return ret;
      },
    },
  }
);

// One cart per user and one cart per guest token.
cartSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { user: { $type: 'objectId' } } }
);
cartSchema.index(
  { tokenHash: 1 },
  { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } }
);

// TTL index: drops guest carts once expiresAt passes. Documents with a null
// expiresAt (user carts) are ignored by MongoDB's TTL monitor.
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// The hold sweeper (lib/cartHolds.js) looks for carts with a lapsed line, so it
// needs an index on the multikey path rather than a collection scan.
cartSchema.index({ 'items.holdExpiresAt': 1 });

module.exports = mongoose.model('Cart', cartSchema);
