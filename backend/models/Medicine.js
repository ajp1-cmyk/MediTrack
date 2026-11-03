// The one stock collection: `medicines`.
//
// Every document is a single medicine currently held in stock, so it carries
// both the product details (name/mfd/exp/price/image) and the inventory
// quantity (`stock`). See README "Data model" for when to split this out.
const mongoose = require('mongoose');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD

const medicineSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Medicine name is required'],
      trim: true,
      maxlength: [120, 'Medicine name cannot be longer than 120 characters'],
    },
    mfd: {
      type: String,
      required: [true, 'Manufacturing date (mfd) is required'],
      match: [DATE_RE, 'mfd must be a date in YYYY-MM-DD format'],
    },
    exp: {
      type: String,
      required: [true, 'Expiry date (exp) is required'],
      match: [DATE_RE, 'exp must be a date in YYYY-MM-DD format'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    stock: {
      type: Number,
      required: [true, 'Stock quantity is required'],
      min: [0, 'Stock cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Stock must be a whole number',
      },
    },
    // Units promised to carts by a live soft hold (SRS FR-1.2).
    //
    // `stock` is what a *new* customer can still buy, so taking a hold moves
    // units from `stock` into `held` and releasing it moves them back. The pair
    // (`stock + held`) is the physical quantity on hand and only changes when a
    // hold converts into a sale (decreases) or a replenishment arrives
    // (increases). See lib/cartHolds.js.
    held: {
      type: Number,
      default: 0,
      min: [0, 'Held quantity cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Held quantity must be a whole number',
      },
    },
    // Prescription-only medicine (Rx). When true, checkout is blocked until the
    // customer has a verified prescription on file (SRS FR-1.4 / FR-2.1).
    prescriptionRequired: {
      type: Boolean,
      default: false,
    },
    // How long one pack lasts the customer. The refill reminder on /orders is
    // calculated from the last purchase date plus this number of days (FR-2.5).
    refillDays: {
      type: Number,
      default: 30,
      min: [1, 'Refill cycle must be at least 1 day'],
      max: [365, 'Refill cycle cannot be longer than 365 days'],
      validate: {
        validator: Number.isInteger,
        message: 'Refill cycle must be a whole number of days',
      },
    },
    // Storefront grouping ("Pain Relief & Fever", "Vitamins & Supplements", …).
    category: {
      type: String,
      default: '',
      trim: true,
      maxlength: [40, 'Category cannot be longer than 40 characters'],
    },
    // Short product description shown on the catalogue card.
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: [500, 'Description cannot be longer than 500 characters'],
    },
    image: {
      type: String,
      default: null, // uploaded image filename inside backend/uploads
    },
    // Which user added this stock row (ref to the users collection).
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
    toJSON: {
      // The React app talks in `id`, not `_id`.
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

// A medicine must expire after it was manufactured.
medicineSchema.pre('validate', function checkDates(next) {
  if (this.mfd && this.exp && this.exp < this.mfd) {
    this.invalidate('exp', 'exp cannot be earlier than mfd');
  }
  return next();
});

// The list endpoint always sorts by newest first.
medicineSchema.index({ created_at: -1 });

module.exports = mongoose.model('Medicine', medicineSchema);
