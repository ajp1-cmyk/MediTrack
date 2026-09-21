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
