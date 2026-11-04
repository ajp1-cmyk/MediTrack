// Production configuration guard: the server must refuse to boot with the
// development JWT / cookie fallbacks, because a known secret lets anyone mint
// an administrator token.
//
// Also pins the cookie SameSite policy, which decides whether a frontend on
// another origin can keep a session at all.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { start } = require('../server');
const { sameSite, cookieSecurity, crossSiteCookies } = require('../lib/cookies');

test('production refuses to start without JWT_SECRET and COOKIE_SECRET', async () => {
  const saved = {
    nodeEnv: process.env.NODE_ENV,
    jwt: process.env.JWT_SECRET,
    cookie: process.env.COOKIE_SECRET,
  };

  process.env.NODE_ENV = 'production';
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;

  try {
    await assert.rejects(
      () => start(0),
      /Refusing to start in production without JWT_SECRET and COOKIE_SECRET/
    );
  } finally {
    if (saved.nodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = saved.nodeEnv;
    }
    if (saved.jwt) process.env.JWT_SECRET = saved.jwt;
    if (saved.cookie) process.env.COOKIE_SECRET = saved.cookie;
  }
});

test('cookies default to SameSite=Lax and go cross-site only when asked', () => {
  const saved = { sameSite: process.env.COOKIE_SAMESITE, env: process.env.NODE_ENV };

  try {
    delete process.env.COOKIE_SAMESITE;

    delete process.env.NODE_ENV;
    assert.equal(sameSite(), 'lax', 'the default suits same-origin deployments');
    assert.deepEqual(cookieSecurity(), { sameSite: 'lax', secure: false });
    assert.equal(crossSiteCookies(), false);

    // Behind the platform proxy: HTTPS, still SameSite=Lax.
    process.env.NODE_ENV = 'production';
    assert.deepEqual(cookieSecurity(), { sameSite: 'lax', secure: true });

    // A frontend on another origin: SameSite=None, which forces Secure.
    process.env.COOKIE_SAMESITE = 'None';
    assert.equal(sameSite(), 'none', 'the value is normalised');
    assert.deepEqual(cookieSecurity(), { sameSite: 'none', secure: true });
    assert.equal(crossSiteCookies(), true);

    // Unknown values fall back instead of producing a broken cookie.
    process.env.COOKIE_SAMESITE = 'sometimes';
    assert.equal(sameSite(), 'lax');
  } finally {
    if (saved.sameSite === undefined) delete process.env.COOKIE_SAMESITE;
    else process.env.COOKIE_SAMESITE = saved.sameSite;
    if (saved.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.env;
  }
});
