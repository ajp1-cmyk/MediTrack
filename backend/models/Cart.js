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

module.exports = mongoose.model('Cart', cartSchema);
