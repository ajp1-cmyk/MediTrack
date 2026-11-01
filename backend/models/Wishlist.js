// Wishlist collection (SRS FR-1.5).
//
// A wishlist is deliberately independent of the cart: it stores only medicine
// references and never reserves stock. Names, prices, stock and expiry are read
// live from the `medicines` collection when the wishlist is serialised, so a
// price change or a sell-out is reflected immediately.
//
// One wishlist per account (the unique index on `user`), and it belongs to the
// account rather than to a guest cookie: saving items is an account feature,
// while the cart continues to work for anonymous visitors.
const mongoose = require('mongoose');

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // Saved medicines, in the order they were added. `$addToSet` keeps the list
    // free of duplicates even when two requests arrive together.
    items: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Medicine',
      default: [],
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
    toJSON: {
      // The React app talks in `id`, not `_id` (same convention as the cart).
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model('Wishlist', wishlistSchema);
