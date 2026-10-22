#!/usr/bin/env node
// Apply pending one-time data migrations manually.
//
// The server already runs these automatically on startup; this script is for
// operators who want to run them before deploying the new code.
//
//   npm run migrate:roles
require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../db');
const { runMigrations } = require('../lib/migrations');

async function main() {
  await connectDB();
  await runMigrations();
  console.log('✅ migrations up to date');
}

main()
  .catch((err) => {
    console.error(`❌ Migration failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
    await mongoose.connection.close().catch(() => {});
  });
