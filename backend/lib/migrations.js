// One-time data migrations, run automatically after the database connects.
//
// A marker document is written to the `migrations` collection after each step,
// so restarting the server never re-applies it (and real staff accounts created
// after the rename are safe).
const mongoose = require('mongoose');
const User = require('../models/User');
const Medicine = require('../models/Medicine');

const MIGRATIONS = [
  {
    id: '001-staff-to-customer',
    async run() {
      // Before Phase 3 `staff` meant "customer". Those accounts must not
      // inherit the new back-office permissions.
      const result = await User.updateMany({ role: 'staff' }, { $set: { role: 'customer' } });
      return `${result.modifiedCount} legacy staff account(s) moved to customer`;
    },
  },
  {
    id: '002-medicine-held-counter',
    async run() {
      // Phase C adds `held` (units promised to carts, SRS FR-1.2). Rows created
      // before it have no such field, and `$inc` on a missing field would start
      // the counter at a negative value, so every existing medicine is pinned
      // to zero before any hold is taken.
      const result = await Medicine.updateMany(
        { held: { $exists: false } },
        { $set: { held: 0 } }
      );
      return `${result.modifiedCount} medicine row(s) initialised with held=0`;
    },
  },
];

async function runMigrations() {
  const collection = mongoose.connection.db.collection('migrations');

  for (const migration of MIGRATIONS) {
    const applied = await collection.findOne({ _id: migration.id });
    if (applied) continue;

    const detail = await migration.run();
    await collection.insertOne({
      _id: migration.id,
      appliedAt: new Date(),
      detail,
    });
    console.log(`[migrate] ${migration.id}: ${detail}`);
  }
}

module.exports = { runMigrations, MIGRATIONS };
