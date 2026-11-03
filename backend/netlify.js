// Lambda-style handler that runs this Express app as a Netlify Function
// (entry point: netlify/functions/api.js).
// netlify.toml rewrites /api/* and /uploads/* to this function.
process.env.MEDITRACK_SERVERLESS = '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const serverless = require('serverless-http');
const { connectLambda } = require('@netlify/blobs');
const { app } = require('./server');
const { connectDB } = require('./db');
const { runMigrations } = require('./lib/migrations');

const FUNCTION_PREFIX = '/.netlify/functions/api';
const REQUIRED_ENV = ['MONGODB_URI', 'JWT_SECRET', 'COOKIE_SECRET'];

// Netlify may hand the function either the public path (/api/...) or the
// rewritten one (/.netlify/functions/api/api/...); Express expects the former.
//
// `binary` matters: serverless-http only base64-encodes responses whose
// Content-Type matches this list. Without it every response is decoded as UTF-8,
// which corrupts uploaded PNG/JPEG/WEBP images and prescription files
// (0x89 → EF BF BD) even though the bytes in MongoDB are correct. SVGs and JSON
// are plain text and were unaffected.
const SERVERLESS_OPTIONS = {
  binary: ['image/*', 'application/pdf', 'application/octet-stream'],
  request(req) {
    if (req.url.startsWith(FUNCTION_PREFIX)) {
      req.url = req.url.slice(FUNCTION_PREFIX.length) || '/';
    }
  },
};

const handler = serverless(app, SERVERLESS_OPTIONS);

// Connect once per warm instance; a failed attempt is retried on the next request.
let ready = null;
function ensureReady() {
  if (!ready) {
    ready = connectDB()
      .then(() => runMigrations())
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

function jsonError(statusCode, error) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
  };
}

exports.handler = async (event, context) => {
  // Lets @netlify/blobs (the legacy image store, still read by imageStore.js)
  // work in a Lambda-style function.
  if (event.blobs) connectLambda(event);

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[config] missing environment variables: ${missing.join(', ')}`);
    return jsonError(
      500,
      `Server is not configured: set ${missing.join(', ')} in the Netlify environment variables.`
    );
  }

  try {
    await ensureReady();
  } catch (err) {
    console.error(err.message);
    return jsonError(503, 'Could not connect to the database. Please try again shortly.');
  }

  context.callbackWaitsForEmptyEventLoop = false;
  return handler(event, context);
};

// Exposed for tests: asserts binary responses are base64-encoded (see
// tests/serverless-response.test.js).
exports.SERVERLESS_OPTIONS = SERVERLESS_OPTIONS;
