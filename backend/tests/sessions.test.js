// End-to-end tests for Phase 2 authentication sessions:
// refresh-token rotation, reuse detection, logout revocation, password change
// and per-device session management.
//
//   cd backend && npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-sessions';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-sessions';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '1000';
process.env.AUTH_REGISTER_RATE_LIMIT_MAX = '1000';
// Keep the cross-tab race window short but measurable in tests.
process.env.REFRESH_REUSE_GRACE_MS = '1000';

const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;
let server;
let baseUrl;

const jar = new Map();

function captureCookies(setCookies) {
  for (const raw of setCookies) {
    const [pair] = raw.split(';');
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1);
    const expired = !value || /expires=thu, 01 jan 1970/i.test(raw);
    if (expired) jar.delete(name);
    else jar.set(name, value);
  }
}

function resetJar() {
  jar.clear();
}

function jarHeader() {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/**
 * fetch helper. `cookie` overrides the jar for a single request (used to
 * replay an old refresh token); `capture: false` leaves the jar untouched.
 */
async function api(path, { method = 'GET', token, body, cookie, capture = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const cookieHeader = cookie !== undefined ? cookie : jarHeader();
  if (cookieHeader) headers.Cookie = cookieHeader;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (capture) captureCookies(setCookies);

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { status: res.status, body: parsed, setCookies };
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_sessions_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

const PASSWORD = 'customer-pass-123';
const NEW_PASSWORD = 'customer-pass-456';

async function register(email) {
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Session Tester', email, password: PASSWORD },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { token: res.body.token, cookie: jar.get('mt_refresh') };
}

async function login(email, password = PASSWORD) {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { token: res.body.token, cookie: jar.get('mt_refresh') };
}

const refreshCookie = (value) => `mt_refresh=${value}`;

const main = {};

test('register issues a short-lived access token and an httpOnly refresh cookie', async () => {
  resetJar();
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Main Session', email: 'sessions-main@meditrack.test', password: PASSWORD },
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.token, 'expected an access token');
  assert.ok(res.body.refreshExpiresAt, 'expected the refresh expiry');

  const raw = res.setCookies.find((cookie) => cookie.startsWith('mt_refresh='));
  assert.ok(raw, 'expected a mt_refresh Set-Cookie header');
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /Path=\/api\/auth/i);
  assert.match(raw, /SameSite=Lax/i);
  assert.match(raw, /Expires=/i);

  main.user = { token: res.body.token, cookie: jar.get('mt_refresh') };
});

test('the session list flags the current browser', async () => {
  const res = await api('/api/auth/sessions', { token: main.user.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].current, true);
  assert.equal(res.body[0].tokenHash, undefined, 'the token hash must never leak');
});

test('refresh rotates the cookie and returns a working access token', async () => {
  main.firstCookie = main.user.cookie;

  const res = await api('/api/auth/refresh', { method: 'POST' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.token);

  main.secondCookie = jar.get('mt_refresh');
  main.secondToken = res.body.token;

  assert.ok(main.secondCookie);
  assert.notEqual(main.secondCookie, main.firstCookie, 'the refresh token must rotate');
  assert.notEqual(main.secondToken, main.user.token);

  const me = await api('/api/auth/me', { token: main.secondToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'sessions-main@meditrack.test');
});

test('replaying an already-rotated refresh token revokes every session', async () => {
  // Inside the grace window this is a cross-tab race: 409 + retry, not theft.
  const race = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: refreshCookie(main.firstCookie),
    capture: false,
  });
  assert.equal(race.status, 409);
  assert.match(race.body.error, /already in progress/i);

  // After the grace window the same replay is treated as token theft.
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const replay = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: refreshCookie(main.firstCookie),
    capture: false,
  });
  assert.equal(replay.status, 401);

  // Reuse is treated as theft: outstanding access tokens die immediately.
  const stale = await api('/api/auth/me', { token: main.secondToken });
  assert.equal(stale.status, 401);

  // …and every refresh session was revoked, including the newest one.
  const current = await api('/api/auth/refresh', { method: 'POST' });
  assert.equal(current.status, 401);
});

test('logout revokes this browser’s refresh session', async () => {
  resetJar();
  await register('sessions-logout@meditrack.test');

  const loggedOut = await api('/api/auth/logout', { method: 'POST' });
  assert.equal(loggedOut.status, 200, JSON.stringify(loggedOut.body));
  assert.equal(jar.has('mt_refresh'), false, 'logout clears the cookie');

  const refresh = await api('/api/auth/refresh', { method: 'POST' });
  assert.equal(refresh.status, 401);
});

test('changing the password invalidates access tokens and every session', async () => {
  resetJar();
  const email = 'sessions-password@meditrack.test';
  const user = await register(email);

  const wrong = await api('/api/auth/password', {
    method: 'PATCH',
    token: user.token,
    body: { currentPassword: 'not-the-password', newPassword: NEW_PASSWORD },
  });
  assert.equal(wrong.status, 400, 'a wrong current password is a form error, not 401');

  const changed = await api('/api/auth/password', {
    method: 'PATCH',
    token: user.token,
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));

  const stale = await api('/api/auth/me', { token: user.token });
  assert.equal(stale.status, 401, 'tokenVersion must invalidate the old access token');

  const staleRefresh = await api('/api/auth/refresh', { method: 'POST' });
  assert.equal(staleRefresh.status, 401, 'all sessions are revoked');

  const oldPassword = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  assert.equal(oldPassword.status, 401);

  const fresh = await login(email, NEW_PASSWORD);
  assert.ok(fresh.token);
});

test('one browser can list and revoke another browser’s session', async () => {
  resetJar();
  const email = 'sessions-two-devices@meditrack.test';
  const first = await register(email);
  resetJar();
  const second = await login(email);

  assert.ok(first.cookie && second.cookie);
  assert.notEqual(first.cookie, second.cookie);

  const list = await api('/api/auth/sessions', {
    token: first.token,
    cookie: refreshCookie(first.cookie),
    capture: false,
  });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.length, 2);
  assert.equal(list.body.filter((session) => session.current).length, 1);

  const other = list.body.find((session) => !session.current);
  const revoked = await api(`/api/auth/sessions/${other.id}`, {
    method: 'DELETE',
    token: first.token,
    cookie: refreshCookie(first.cookie),
    capture: false,
  });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.current, false);

  const otherRefresh = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: refreshCookie(second.cookie),
    capture: false,
  });
  assert.equal(otherRefresh.status, 401, 'the revoked browser can no longer refresh');

  const firstRefresh = await api('/api/auth/refresh', {
    method: 'POST',
    cookie: refreshCookie(first.cookie),
    capture: false,
  });
  assert.equal(firstRefresh.status, 200, JSON.stringify(firstRefresh.body));

  // A customer cannot revoke a session that belongs to someone else.
  const firstSessionId = list.body.find((session) => session.current).id;
  const stranger = await register('sessions-stranger@meditrack.test');
  const denied = await api(`/api/auth/sessions/${firstSessionId}`, {
    method: 'DELETE',
    token: stranger.token,
  });
  assert.equal(denied.status, 404);
});

test('sign out everywhere revokes all sessions and access tokens', async () => {
  resetJar();
  const user = await register('sessions-everywhere@meditrack.test');

  const res = await api('/api/auth/sessions', { method: 'DELETE', token: user.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.revoked >= 1);
  assert.equal(jar.has('mt_refresh'), false);

  const stale = await api('/api/auth/me', { token: user.token });
  assert.equal(stale.status, 401);

  const refresh = await api('/api/auth/refresh', { method: 'POST' });
  assert.equal(refresh.status, 401);
});


