// Shared helpers for the test suites (not a test file: `node --test` ignores it).
const User = require('../models/User');

/** Insert an account directly, bypassing the public (customer-only) sign-up. */
async function createUser({ name, email, password, role = 'customer' }) {
  const user = new User({ name, email, role });
  await user.setPassword(password);
  await user.save();
  return user;
}

module.exports = { createUser };
