#!/usr/bin/env node
// Create (or promote) the first administrator without self-service signup.
//
//   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='long-password' \
//     ADMIN_NAME='Store Admin' npm run seed:admin
//
// or:
//
//   npm run seed:admin -- --email admin@example.com --password 'long-password' --name 'Store Admin'
//
// If the account already exists it is promoted to `admin`. The password is left
// untouched unless `--reset-password` is passed.
require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../db');
const User = require('../models/User');
const { runMigrations } = require('../lib/migrations');

const MIN_PASSWORD_LENGTH = 8;

function cliArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = String(cliArg('email') || process.env.ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
  const password = cliArg('password') || process.env.ADMIN_PASSWORD || '';
  const name =
    String(cliArg('name') || process.env.ADMIN_NAME || 'Administrator').trim() ||
    'Administrator';
  const resetPassword =
    process.argv.includes('--reset-password') || process.env.ADMIN_RESET_PASSWORD === 'true';

  if (!email) {
    console.error('❌ ADMIN_EMAIL (or --email) is required.');
    process.exit(1);
  }
  if (!password && !resetPassword) {
    console.error('❌ ADMIN_PASSWORD (or --password) is required for a new account.');
    process.exit(1);
  }
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    console.error(`❌ Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    process.exit(1);
  }

  await connectDB();
  // Apply the legacy staff → customer migration before creating an admin, so
  // the operator's intent is unambiguous.
  await runMigrations();

  let user = await User.findOne({ email });
  let created = false;

  if (!user) {
    user = new User({ name, email, role: 'admin' });
    created = true;
  }

  user.role = 'admin';
  if (!user.name) user.name = name;
  if (created || resetPassword) {
    await user.setPassword(password);
  }

  await user.save();

  console.log(
    created
      ? `✅ Administrator created: ${email}`
      : `✅ Existing account promoted to administrator: ${email}`
  );
  if (!created && !resetPassword) {
    console.log('   Password unchanged (pass --reset-password to replace it).');
  }
  console.log('   Sign in at /admin/login');
}

main()
  .catch((err) => {
    console.error(`❌ Could not seed the administrator: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
    await mongoose.connection.close().catch(() => {});
  });
