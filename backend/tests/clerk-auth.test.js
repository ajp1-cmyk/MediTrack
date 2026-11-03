// Tests for Clerk sign-in (POST /api/auth/clerk).
//
// Clerk's network calls are stubbed: the route is exercised over HTTP exactly as
// the SPA calls it, while `lib/clerk` supplies the identity it would have
// verified. Everything else (account linking, roles, sessions, audit) is real.
//
//   cd backend && npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-clerk';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-clerk';
process.env.INVENTORY_AUTO_REPLENISH = 'off';
process.env.PAYMENT_MOCK_DELAY_MS = '0';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '1000';
process.env.CLERK_SECRET_KEY = 'sk_test_placeholder_for_tests';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { createUser } = require('./support');
const User = require('../models/User');
const clerk = require('../lib/clerk');

let mongo;
let server;
let baseUrl;

// token → identity that `clerk.resolveClerkIdentity` should return.
const identities = new Map();
// The real verifier needs Clerk's API; tests inject the identity instead.
clerk.resolveClerkIdentity = async (token) => {
  if (!identities.has(token)) {
    const err = new Error('invalid session');
    err.status = 401;
    throw err;
  }
  return identities.get(token);
};

/** fetch helper that understands JSON bodies and Bearer tokens. */
async function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  let payload;

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const CUSTOMER = {
  name: 'Cara Customer',
  email: 'clerk-customer@meditrack.test',
  password: 'customer-pass-123',
};
const STAFF = { name: 'Sam Staff', email: 'clerk-staff@meditrack.test', password: 'staff-pass-123' };

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_clerk_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createUser({ ...CUSTOMER, role: 'customer' });
  await createUser({ ...STAFF, role: 'staff' });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.close();
  if (mongo) await mongo.stop();
});

test('a missing token is rejected', async () => {
  const res = await api('/api/auth/clerk', { method: 'POST', body: {} });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /token/i);
});

test('the endpoint answers 503 when Clerk is not configured', async () => {
  const saved = process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_SECRET_KEY;
  try {
    const res = await api('/api/auth/clerk', { method: 'POST', body: { token: 'anything' } });
    assert.equal(res.status, 503);
    assert.match(res.body.error, /not configured/i);
  } finally {
    process.env.CLERK_SECRET_KEY = saved;
  }
});


test('a new Clerk user gets a customer account and a working MediTrack session', async () => {
  identities.set('tok-new', {
    clerkUserId: 'user_new_123',
    email: 'new-clerk-user@meditrack.test',
    name: 'New Clerk User',
  });

  const res = await api('/api/auth/clerk', { method: 'POST', body: { token: 'tok-new' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.token, 'an access token must be returned');
  assert.equal(res.body.user.role, 'customer');
  assert.equal(res.body.user.authProvider, 'clerk');
  assert.equal(res.body.user.email, 'new-clerk-user@meditrack.test');
  assert.equal(res.body.user.passwordHash, undefined);
  assert.equal(res.body.user.clerkUserId, undefined, 'internal id must not leak');

  // The issued token works on protected routes.
  const me = await api('/api/auth/me', { token: res.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'new-clerk-user@meditrack.test');

  const stored = await User.findOne({ email: 'new-clerk-user@meditrack.test' });
  assert.equal(stored.clerkUserId, 'user_new_123');
  assert.equal(stored.passwordHash, undefined);

  // Clerk accounts have no local password to change.
  const password = await api('/api/auth/password', {
    method: 'PATCH',
    token: res.body.token,
    body: { currentPassword: 'whatever', newPassword: 'another-pass-123' },
  });
  assert.equal(password.status, 400);
  assert.match(password.body.error, /clerk/i);
});

test('a repeat sign-in reuses the same local account', async () => {
  identities.set('tok-new-again', {
    clerkUserId: 'user_new_123',
    email: 'new-clerk-user@meditrack.test',
    name: 'New Clerk User',
  });

  const first = await api('/api/auth/clerk', { method: 'POST', body: { token: 'tok-new' } });
  const second = await api('/api/auth/clerk', {
    method: 'POST',
    body: { token: 'tok-new-again' },
  });

  assert.equal(second.status, 200);
  assert.equal(second.body.user.id, first.body.user.id);
  assert.equal(await User.countDocuments({ email: 'new-clerk-user@meditrack.test' }), 1);
});

test('a verified Clerk email links an existing customer account without changing its role', async () => {
  identities.set('tok-customer', {
    clerkUserId: 'user_customer_456',
    email: CUSTOMER.email,
    name: CUSTOMER.name,
  });

  const res = await api('/api/auth/clerk', { method: 'POST', body: { token: 'tok-customer' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.role, 'customer');
  assert.equal(res.body.user.authProvider, 'password');

  const stored = await User.findOne({ email: CUSTOMER.email });
  assert.equal(stored.clerkUserId, 'user_customer_456');
  assert.equal(stored.authProvider, 'password', 'a linked account keeps its password login');

  // The original password still signs in.
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: CUSTOMER.email, password: CUSTOMER.password },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, res.body.user.id);
});

test('back-office accounts need an explicit opt-in before Clerk can link them', async () => {
  identities.set('tok-staff', {
    clerkUserId: 'user_staff_789',
    email: STAFF.email,
    name: STAFF.name,
  });

  const denied = await api('/api/auth/clerk', { method: 'POST', body: { token: 'tok-staff' } });
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /back-office/i);

  const staff = await User.findOne({ email: STAFF.email });
  assert.equal(staff.clerkUserId, undefined, 'the account must stay unlinked');

  process.env.CLERK_ALLOW_BACKOFFICE_LOGIN = 'true';
  try {
    const allowed = await api('/api/auth/clerk', { method: 'POST', body: { token: 'tok-staff' } });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.equal(allowed.body.user.role, 'staff', 'the role must be preserved');
  } finally {
    delete process.env.CLERK_ALLOW_BACKOFFICE_LOGIN;
  }
});

test('an email already linked to another Clerk account is refused', async () => {
  identities.set('tok-conflict', {
    clerkUserId: 'user_different_999',
    email: CUSTOMER.email,
    name: CUSTOMER.name,
  });

  const res = await api('/api/auth/clerk', { method: 'POST', body: { token: 'tok-conflict' } });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /different Clerk account/i);
});

test('identityFromProfile only accepts a verified primary email', () => {
  const base = {
    id: 'user_profile_1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    primaryEmailAddressId: 'idn_1',
    emailAddresses: [
      { id: 'idn_1', emailAddress: 'Ada@Example.com', verification: { status: 'verified' } },
    ],
  };

  assert.deepEqual(clerk.identityFromProfile(base), {
    clerkUserId: 'user_profile_1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
  });

  const unverified = {
    ...base,
    emailAddresses: [
      { id: 'idn_1', emailAddress: 'ada@example.com', verification: { status: 'unverified' } },
    ],
  };
  assert.throws(() => clerk.identityFromProfile(unverified), /verify your email/i);

  assert.throws(
    () => clerk.identityFromProfile({ ...base, emailAddresses: [] }),
    /no email address/i
  );
});
