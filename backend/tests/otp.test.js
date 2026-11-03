// Tests for the emailed one-time-code sign-in
// (POST /api/auth/otp/request and POST /api/auth/otp/verify).
//
// Only the mailer is stubbed — no email leaves the test machine. Everything else
// is real: code generation, the HMAC, single use, the attempt limit, account
// creation, sessions and the audit trail.
//
//   cd backend && npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../lib/otp are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-otp';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-otp';
process.env.INVENTORY_AUTO_REPLENISH = 'off';
process.env.PAYMENT_MOCK_DELAY_MS = '0';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '1000';
process.env.AUTH_OTP_RATE_LIMIT_MAX = '1000';
// The cooldown has its own test below; keep it out of the way here.
process.env.OTP_RESEND_COOLDOWN_SECONDS = '0';
process.env.OTP_TTL_MINUTES = '10';
process.env.OTP_MAX_ATTEMPTS = '3';
// A developer's backend/.env may set this; the suite must see the production
// behaviour (codes only by email), so pin it here — dotenv never overrides.
process.env.OTP_EXPOSE_CODE = 'false';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { createUser } = require('./support');
const User = require('../models/User');
const OtpCode = require('../models/OtpCode');
const otp = require('../lib/otp');
const mailer = require('../lib/mailer');

let mongo;
let server;
let baseUrl;

// address → the code the API "emailed".
const sent = new Map();

// The route calls `mailer.sendOtpEmail(...)`, so replacing it here is enough.
mailer.sendOtpEmail = async ({ to, code }) => {
  sent.set(to, code);
};

/** fetch helper that understands JSON bodies, Bearer tokens and Set-Cookie. */
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
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    cookies: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [],
  };
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_otp_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.close();
  if (mongo) await mongo.stop();
});

test('a malformed address is rejected before anything is sent', async () => {
  const res = await api('/api/auth/otp/request', {
    method: 'POST',
    body: { email: 'not-an-address' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /valid email/i);
  assert.equal(await OtpCode.countDocuments({ email: 'not-an-address' }), 0);
});

test('requesting a code emails six digits and does not create an account yet', async () => {
  const email = 'new-code-user@meditrack.test';

  const res = await api('/api/auth/otp/request', { method: 'POST', body: { email } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.equal(res.body.email, email);
  assert.ok(res.body.expiresAt, 'the reply carries the expiry');
  assert.equal(res.body.expiresInMinutes, 10);
  assert.equal(res.body.devCode, undefined, 'codes are only exposed with OTP_EXPOSE_CODE');

  const code = sent.get(email);
  assert.match(code, /^\d{6}$/, 'the email carries a 6-digit code');

  // Only the HMAC is stored — never the code itself.
  const stored = await OtpCode.findOne({ email });
  assert.ok(stored, 'a code document was written');
  assert.equal(stored.codeHash, undefined, 'codeHash is select:false by default');
  assert.equal(await User.countDocuments({ email }), 0, 'no account before verification');
});

test('a wrong code is refused and the remaining attempts are reported', async () => {
  const email = 'wrong-code@meditrack.test';
  await api('/api/auth/otp/request', { method: 'POST', body: { email } });
  const code = sent.get(email);
  const wrong = code === '000000' ? '111111' : '000000';

  const res = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { email, code: wrong },
  });
  assert.equal(res.status, 401);
  assert.match(res.body.error, /not correct/i);
  assert.match(res.body.error, /2 attempts left/i);

  // The real code still works: one wrong guess does not burn it.
  const ok = await api('/api/auth/otp/verify', { method: 'POST', body: { email, code } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test('verifying a code creates a customer account and a session', async () => {
  const email = 'fresh-customer@meditrack.test';
  await api('/api/auth/otp/request', { method: 'POST', body: { email } });
  const code = sent.get(email);

  const res = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { email, code, name: 'Nina New' },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.created, true);
  assert.ok(res.body.token, 'an access token is issued');
  assert.equal(res.body.user.email, email);
  assert.equal(res.body.user.name, 'Nina New');
  assert.equal(res.body.user.role, 'customer');
  assert.equal(res.body.user.authProvider, 'otp');

  // Same refresh cookie as the password form.
  assert.ok(
    res.cookies.some((cookie) => cookie.startsWith('mt_refresh=')),
    'the httpOnly refresh cookie is set'
  );

  // The token works on a protected route.
  const me = await api('/api/auth/me', { token: res.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, res.body.user.id);

  const stored = await User.findOne({ email });
  assert.equal(stored.authProvider, 'otp');
  assert.equal(stored.passwordHash, undefined, 'code-only accounts have no password');
});


test('a name is derived from the address when none is given', async () => {
  const email = 'no-name@meditrack.test';
  await api('/api/auth/otp/request', { method: 'POST', body: { email } });

  const res = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { email, code: sent.get(email) },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.user.name, 'no-name');
});

test('a code can only be used once', async () => {
  const email = 'single-use@meditrack.test';
  await api('/api/auth/otp/request', { method: 'POST', body: { email } });
  const code = sent.get(email);

  const first = await api('/api/auth/otp/verify', { method: 'POST', body: { email, code } });
  assert.equal(first.status, 201);

  const replay = await api('/api/auth/otp/verify', { method: 'POST', body: { email, code } });
  assert.equal(replay.status, 401);
  assert.match(replay.body.error, /no longer valid|already been used/i);
});

test('the attempt limit destroys the code', async () => {
  const email = 'too-many-guesses@meditrack.test';
  await api('/api/auth/otp/request', { method: 'POST', body: { email } });
  const code = sent.get(email);
  const wrong = code === '000000' ? '111111' : '000000';

  // OTP_MAX_ATTEMPTS=3 in this suite.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await api('/api/auth/otp/verify', {
      method: 'POST',
      body: { email, code: wrong },
    });
    assert.equal(res.status, 401, `attempt ${attempt}`);
  }

  const blocked = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { email, code: wrong },
  });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /too many incorrect codes/i);

  // Even the correct code is gone now.
  const correct = await api('/api/auth/otp/verify', { method: 'POST', body: { email, code } });
  assert.equal(correct.status, 401);
});

test('an expired code is refused', async () => {
  const email = 'expired-code@meditrack.test';
  await api('/api/auth/otp/request', { method: 'POST', body: { email } });
  const code = sent.get(email);

  await OtpCode.updateOne({ email }, { $set: { expires_at: new Date(Date.now() - 1000) } });

  const res = await api('/api/auth/otp/verify', { method: 'POST', body: { email, code } });
  assert.equal(res.status, 401);
  assert.match(res.body.error, /no longer valid/i);
});

test('a malformed code is rejected without touching the stored one', async () => {
  const email = 'malformed-code@meditrack.test';
  await api('/api/auth/otp/request', { method: 'POST', body: { email } });
  const code = sent.get(email);

  const res = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { email, code: '12ab' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /6-digit/i);

  const ok = await api('/api/auth/otp/verify', { method: 'POST', body: { email, code } });
  assert.equal(ok.status, 201);
});

test('an existing password customer keeps its password login', async () => {
  const customer = {
    name: 'Cara Customer',
    email: 'code-customer@meditrack.test',
    password: 'customer-pass-123',
  };
  const created = await createUser({ ...customer, role: 'customer' });

  await api('/api/auth/otp/request', { method: 'POST', body: { email: customer.email } });
  const res = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { email: customer.email, code: sent.get(customer.email) },
  });

  assert.equal(res.status, 200, 'an existing account is signed in, not created');
  assert.equal(res.body.created, false);
  assert.equal(res.body.user.id, created._id.toString());
  assert.equal(res.body.user.role, 'customer');

  const stored = await User.findOne({ email: customer.email }).select('+passwordHash');
  assert.equal(stored.authProvider, 'password', 'the provider is not rewritten');
  assert.ok(stored.passwordHash, 'the password still exists');

  const passwordLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: customer.email, password: customer.password },
  });
  assert.equal(passwordLogin.status, 200);
});

test('back-office accounts need an explicit opt-in before a code signs them in', async () => {
  const staff = {
    name: 'Sam Staff',
    email: 'code-staff@meditrack.test',
    password: 'staff-pass-123',
  };
  await createUser({ ...staff, role: 'staff' });

  await api('/api/auth/otp/request', { method: 'POST', body: { email: staff.email } });
  const denied = await api('/api/auth/otp/verify', {
    method: 'POST',
    body: { email: staff.email, code: sent.get(staff.email) },
  });
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /back-office/i);

  process.env.OTP_ALLOW_BACKOFFICE_LOGIN = 'true';
  try {
    // The refused attempt burned the code, so ask for a new one.
    await api('/api/auth/otp/request', { method: 'POST', body: { email: staff.email } });
    const allowed = await api('/api/auth/otp/verify', {
      method: 'POST',
      body: { email: staff.email, code: sent.get(staff.email) },
    });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.equal(allowed.body.user.role, 'staff', 'the role is preserved');
  } finally {
    delete process.env.OTP_ALLOW_BACKOFFICE_LOGIN;
  }
});

test('a delivery failure leaves no usable code behind', async () => {
  const email = 'mail-failure@meditrack.test';
  const original = mailer.sendOtpEmail;

  mailer.sendOtpEmail = async () => {
    const err = new Error('Could not send the sign-in code. Please try again.');
    err.status = 502;
    throw err;
  };

  try {
    const res = await api('/api/auth/otp/request', { method: 'POST', body: { email } });
    assert.equal(res.status, 502);
    assert.match(res.body.error, /could not send/i);
  } finally {
    mailer.sendOtpEmail = original;
  }

  assert.equal(await OtpCode.countDocuments({ email }), 0, 'the code was discarded');
});

test('a second code for the same address is refused during the cooldown', async () => {
  // The HTTP handlers captured the module instance with a 0-second cooldown, so
  // the cooldown is exercised on the library directly, with a fresh instance.
  const modulePath = require.resolve('../lib/otp');
  process.env.OTP_RESEND_COOLDOWN_SECONDS = '30';
  delete require.cache[modulePath];
  const withCooldown = require('../lib/otp');

  try {
    const email = 'cooldown@meditrack.test';
    await withCooldown.issueCode(email, { ip: '127.0.0.1' });
    await assert.rejects(
      () => withCooldown.issueCode(email, { ip: '127.0.0.1' }),
      /wait \d+ second/i
    );

    const live = await OtpCode.find({ email, consumed_at: null });
    assert.equal(live.length, 1, 'the first code is still the only live one');
  } finally {
    process.env.OTP_RESEND_COOLDOWN_SECONDS = '0';
    delete require.cache[modulePath];
  }
});

test('codes are stored as an HMAC, never as the digits', () => {
  const hash = otp.hashCode('someone@meditrack.test', '123456');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, '123456');
  assert.notEqual(hash, otp.hashCode('someone@meditrack.test', '123457'));
  assert.equal(hash, otp.hashCode('someone@meditrack.test', '123456'));
  assert.equal(otp.generateCode().length, 6);
});

test('OTP_EXPOSE_CODE only applies outside production', () => {
  const saved = {
    expose: process.env.OTP_EXPOSE_CODE,
    env: process.env.NODE_ENV,
  };

  try {
    process.env.OTP_EXPOSE_CODE = 'true';
    delete process.env.NODE_ENV;
    assert.equal(otp.config().exposeCode, true, 'allowed in development');

    process.env.NODE_ENV = 'production';
    assert.equal(otp.config().exposeCode, false, 'never in production');

    delete process.env.NODE_ENV;
    process.env.OTP_EXPOSE_CODE = 'false';
    assert.equal(otp.config().exposeCode, false, 'off when not requested');
  } finally {
    if (saved.expose === undefined) delete process.env.OTP_EXPOSE_CODE;
    else process.env.OTP_EXPOSE_CODE = saved.expose;
    if (saved.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.env;
  }
});
