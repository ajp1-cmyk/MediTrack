// Production configuration guard: the server must refuse to boot with the
// development JWT / cookie fallbacks, because a known secret lets anyone mint
// an administrator token.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { start } = require('../server');

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
