// Regression test: Netlify Functions must base64-encode binary responses.
//
// `serverless-http` only base64-encodes Content-Types listed in its `binary`
// option; by default it decodes every body as UTF-8, which silently corrupts
// PNG/JPEG/WEBP images and prescription PDFs (0x89 → EF BF BD). This test drives
// the exact options object `backend/netlify.js` hands to serverless-http.
//
//   cd backend && npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Must be set before ../netlify (which loads ../server) is required. They are
// placeholders only: this test never connects to MongoDB.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/meditrack_test';
process.env.JWT_SECRET = 'test-secret-serverless';
process.env.COOKIE_SECRET = 'test-cookie-secret-serverless';

const express = require('express');
const serverless = require('serverless-http');
const { SERVERLESS_OPTIONS } = require('../netlify');

/** Minimal AWS/Netlify (HTTP API v1) GET event. */
function eventFor(path) {
  return {
    httpMethod: 'GET',
    path,
    resource: path,
    headers: { host: 'example.netlify.app' },
    queryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  };
}

/** Wrap a throw-away Express app exactly like the real function. */
function handlerFor(setup) {
  const app = express();
  setup(app);
  return serverless(app, SERVERLESS_OPTIONS);
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('PNG responses are base64-encoded so Netlify returns the exact bytes', async () => {
  const handler = handlerFor((app) => {
    app.get('/img.png', (_req, res) => {
      res.set('Content-Type', 'image/png');
      res.send(PNG);
    });
  });

  const out = await handler(eventFor('/img.png'), {});
  assert.equal(out.statusCode, 200);
  assert.equal(out.isBase64Encoded, true, 'without this Netlify UTF-8 decodes the body');
  assert.deepEqual(Buffer.from(out.body, 'base64'), PNG);
});

test('JPEG, WEBP and PDF responses are binary too', async () => {
  const cases = [
    ['/photo.jpg', 'image/jpeg'],
    ['/photo.webp', 'image/webp'],
    ['/prescription.pdf', 'application/pdf'],
  ];

  for (const [path, contentType] of cases) {
    const handler = handlerFor((app) => {
      app.get(path, (_req, res) => res.type(contentType).send(PNG));
    });
    const out = await handler(eventFor(path), {});
    assert.equal(out.isBase64Encoded, true, `${contentType} must be base64-encoded`);
    assert.deepEqual(Buffer.from(out.body, 'base64'), PNG);
  }
});

test('SVG bytes survive the round trip and JSON stays plain text', async () => {
  const svgHandler = handlerFor((app) => {
    app.get('/icon.svg', (_req, res) => {
      res.set('Content-Type', 'image/svg+xml');
      res.send('<svg xmlns="http://www.w3.org/2000/svg"/>');
    });
  });
  const svg = await svgHandler(eventFor('/icon.svg'), {});
  const decode = (out) => (out.isBase64Encoded ? Buffer.from(out.body, 'base64') : Buffer.from(out.body));
  assert.match(decode(svg).toString('utf8'), /^<svg /);

  const jsonHandler = handlerFor((app) => {
    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  });
  const json = await jsonHandler(eventFor('/api/health'), {});
  assert.equal(json.isBase64Encoded, false);
  assert.deepEqual(JSON.parse(json.body), { status: 'ok' });
});

test("the function prefix is stripped from rewritten URLs", () => {
  const req = { url: '/.netlify/functions/api/uploads/seed-paracetamol-500mg.svg' };
  SERVERLESS_OPTIONS.request(req);
  assert.equal(req.url, '/uploads/seed-paracetamol-500mg.svg');

  const plain = { url: '/api/medicines' };
  SERVERLESS_OPTIONS.request(plain);
  assert.equal(plain.url, '/api/medicines');
});
