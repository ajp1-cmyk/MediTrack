// One-time data migrations, run automatically after the database connects.
//
// A marker document is written to the `migrations` collection after each step,
// so restarting the server never re-applies it (and real staff accounts created
// after the rename are safe).
const mongoose = require('mongoose');
const User = require('../models/User');

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
