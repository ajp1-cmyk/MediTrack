// Orders collection.
//
// An order is an immutable snapshot of what was bought: name, image and unit
// price are copied in at checkout, so later stock edits or price changes never
// rewrite history. Stock is decremented when the order is created and restored
// if it is cancelled or expires.
const mongoose = require('mongoose');

const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'expired',
];
const PAYMENT_METHODS = ['card', 'upi', 'cod'];
const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'cancelled'];

function isWholeNumber(value) {
  return Number.isInteger(value);
}

const orderItemSchema = new mongoose.Schema(
  {
    medicine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    image: { type: String, default: null },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: isWholeNumber, message: 'Quantity must be a whole number' },
    },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: [80, 'Full name cannot be longer than 80 characters'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^\+?[0-9][0-9\s-]{6,14}$/, 'Please provide a valid phone number'],
    },
    email: {
      type: String,
      required: [true, 'Contact email is required'],
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid contact email'],
    },
    line1: {
      type: String,
      required: [true, 'Address line 1 is required'],
      trim: true,
      maxlength: [120, 'Address line 1 cannot be longer than 120 characters'],
    },
    line2: {
      type: String,
      default: '',
      trim: true,
      maxlength: [120, 'Address line 2 cannot be longer than 120 characters'],
    },
    city: { type: String, required: [true, 'City is required'], trim: true },
    state: { type: String, required: [true, 'State is required'], trim: true },
    pincode: {
      type: String,
      required: [true, 'PIN code is required'],
      trim: true,
      match: [/^[0-9]{4,10}$/, 'PIN code must be 4–10 digits'],
    },
    country: { type: String, default: 'India', trim: true },
  },
  { _id: false }
);

const totalsSchema = new mongoose.Schema(
  {
    subtotal: { type: Number, required: true, min: 0 },
    tax: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    itemCount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR' },
    // Pricing rules that produced this bill (so old orders stay explainable).
    taxRate: { type: Number, default: 0.05 },
    freeDeliveryOver: { type: Number, default: 499 },
  },
  { _id: false }
);

// Only non-sensitive payment metadata is kept: never a card number or CVV.
const paymentSchema = new mongoose.Schema(
  {
    provider: { type: String, default: 'mock' },
    method: {
      type: String,
      // `null` means "not chosen yet" and is explicitly allowed.
      enum: {
        values: [...PAYMENT_METHODS, null],
        message: `Payment method must be one of: ${PAYMENT_METHODS.join(', ')}`,
      },
      default: null,
    },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    transactionId: { type: String, default: null },
    last4: { type: String, default: null },
    brand: { type: String, default: null },
    failureReason: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: {
      type: [orderItemSchema],
      validate: {
        validator: (items) => items.length > 0,
        message: 'An order must contain at least one item',
      },
    },
    shippingAddress: {
      type: shippingAddressSchema,
      required: [true, 'Shipping address is required'],
    },
    totals: { type: totalsSchema, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending_payment' },
    payment: { type: paymentSchema, default: () => ({}) },
    // Pending orders hold their stock only until this moment.
    expiresAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

orderSchema.index({ user: 1, created_at: -1 });
orderSchema.index({ status: 1, expiresAt: 1 });

orderSchema.statics.ORDER_STATUSES = ORDER_STATUSES;
orderSchema.statics.PAYMENT_METHODS = PAYMENT_METHODS;
orderSchema.statics.PAYMENT_STATUSES = PAYMENT_STATUSES;

module.exports = mongoose.model('Order', orderSchema);
module.exports.ORDER_STATUSES = ORDER_STATUSES;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
