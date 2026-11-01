// MediPoints ledger — the reward-points history of a customer (SRS FR-2.4).
//
// This is an append-only ledger rather than a `points` field on the user: every
// change stays visible (and auditable), and the balance is always the sum of the
// entries. `order` is unique for `earn` entries, so a double-submitted payment
// or a retried request can never credit the same order twice.
const mongoose = require('mongoose');

const ENTRY_TYPES = ['earn', 'spend', 'adjust'];

const mediPointsEntrySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Which order produced the points (null for manual adjustments).
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    type: {
      type: String,
      enum: { values: ENTRY_TYPES, message: `Entry type must be one of: ${ENTRY_TYPES.join(', ')}` },
      default: 'earn',
    },
    // Positive for earn/adjust-up, negative for spend/adjust-down.
    points: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: 'Points must be a whole number',
      },
    },
    reason: { type: String, default: '', trim: true, maxlength: 200 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
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

// One earn entry per order — the database guarantee behind "credit only once".
mediPointsEntrySchema.index(
  { order: 1 },
  { unique: true, partialFilterExpression: { order: { $type: 'objectId' } } }
);
mediPointsEntrySchema.index({ user: 1, created_at: -1 });

module.exports = mongoose.model('MediPointsEntry', mediPointsEntrySchema);
module.exports.ENTRY_TYPES = ENTRY_TYPES;
