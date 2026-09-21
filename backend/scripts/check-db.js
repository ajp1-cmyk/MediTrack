#!/usr/bin/env node
// Connection check for the configured MongoDB — local or cloud (Atlas).
//
//   npm run db:check
//
// Reads MONGODB_URI from backend/.env, connects, pings the server and reports
// what the app will actually see (collections + document counts + indexes), so a
// bad connection string is caught before starting the backend.
require('dotenv').config();

const mongoose = require('mongoose');
const { MONGODB_URI } = require('../db');
const { connectionTarget, formatConnectionError } = require('../lib/mongoErrors');

async function main() {
  const target = connectionTarget(MONGODB_URI);
  console.log('MediTrack MongoDB check');
  console.log(`  target : ${target.uri}`);
  console.log(`  kind   : ${target.cloud ? 'cloud (Atlas / remote)' : 'local'}`);
  console.log('');

  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  } catch (err) {
    console.error(`❌ ${formatConnectionError(err, MONGODB_URI)}\n`);
    process.exit(1);
  }

  const { connection } = mongoose;
  console.log(`✅ connected   : database "${connection.name}"`);

  try {
    await connection.db.admin().command({ ping: 1 });
    console.log('✅ ping        : ok');
  } catch (err) {
    console.log(`⚠️  ping        : ${err.message}`);
  }

  try {
    const info = await connection.db.admin().command({ buildInfo: 1 });
    console.log(`ℹ️  server      : MongoDB ${info.version}`);
  } catch {
    // Atlas may restrict buildInfo for some roles — not important.
  }

  const collections = await connection.db.listCollections().toArray();
  console.log(
    `ℹ️  collections : ${
      collections.length ? collections.map((c) => c.name).join(', ') : '(none yet — created on first write)'
    }`
  );

  for (const name of ['medicines', 'users']) {
    const count = await connection.db.collection(name).countDocuments();
    console.log(`   • ${name.padEnd(10)} : ${count} document${count === 1 ? '' : 's'}`);
  }

  // Create the indexes the app relies on (unique email, newest-first stock list).
  await require('../models/Medicine').createIndexes();
  await require('../models/User').createIndexes();
  console.log('✅ indexes     : ensured');

  await mongoose.disconnect();
  console.log('\n✅ Ready — start the backend with `npm run dev`.');
}

main().catch(async (err) => {
  console.error(`❌ ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
