#!/usr/bin/env node
// Post-deployment smoke test.
//
//   npm run smoke:deploy -- https://meditrack.netlify.app
//   SMOKE_BASE_URL=https://meditrack.netlify.app npm run smoke:deploy
//
// Run it against the PUBLIC url (the Netlify deployment), not the API host:
// the SPA deep-link check only makes sense where the frontend is served, and
// the login check reproduces the browser's `Origin` header so a missing or
// wrong CORS_ORIGIN is caught immediately (403 instead of 401).
const REQUEST_TIMEOUT_MS = 20000;

function usage() {
  console.error('Usage: npm run smoke:deploy -- https://<public-url>');
  process.exit(2);
}

function baseUrl() {
  const raw = process.argv[2] || process.env.SMOKE_BASE_URL;
  if (!raw) usage();
  return raw.replace(/\/+$/, '');
}

/** Fetch with a timeout and a parsed body (JSON when possible). */
async function request(url, options = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...options,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const base = baseUrl();
  const origin = new URL(base).origin;
  console.log(`\nSmoke test against ${base}\n`);

  // 1. Health: the API is reachable through the same origin as the SPA.
  try {
    const { res, json } = await request(`${base}/api/health`);
    const ok = res.status === 200 && json && json.status === 'ok';
    const db = json ? json.database : 'no JSON body';
    record(
      'GET /api/health',
      ok && db === 'connected',
      `HTTP ${res.status}, database: ${db}`
    );
  } catch (err) {
    record('GET /api/health', false, err.message);
  }

  // 2. Catalogue: the API can read the deployed database.
  try {
    const { res, json } = await request(`${base}/api/medicines`);
    const ok = res.status === 200 && Array.isArray(json);
    record(
      'GET /api/medicines',
      ok,
      ok ? `HTTP ${res.status}, ${json.length} medicine(s)` : `HTTP ${res.status}`
    );
  } catch (err) {
    record('GET /api/medicines', false, err.message);
  }

  // 3. CORS: browsers send Origin on every POST, even same-origin. A 403 here
  //    means CORS_ORIGIN on the API host does not list this deployment.
  try {
    const { res, json } = await request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        email: `smoke-${Date.now()}@example.com`,
        password: 'not-the-right-password',
      }),
    });
    const ok = res.status === 401;
    const detail =
      res.status === 403
        ? `HTTP 403 — set CORS_ORIGIN to ${origin} on the API host`
        : `HTTP ${res.status}${json && json.error ? ` (${json.error})` : ''}`;
    record('POST /api/auth/login with Origin (expect 401)', ok, detail);
  } catch (err) {
    record('POST /api/auth/login with Origin (expect 401)', false, err.message);
  }

  // 4. SPA fallback: deep links such as /admin/stock must return index.html,
  //    otherwise a browser refresh lands on a 404.
  try {
    const { res, text } = await request(`${base}/admin/stock`);
    const ok = res.status === 200 && /<div id="root">|<script[^>]+src=/i.test(text);
    record('GET /admin/stock returns the SPA', ok, `HTTP ${res.status}`);
  } catch (err) {
    record('GET /admin/stock returns the SPA', false, err.message);
  }

  const failed = results.filter((r) => !r.passed);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed.` +
      (failed.length ? ' Fix the failures above and re-run.\n' : '\n')
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(`❌ Smoke test failed: ${err.message}`);
  process.exitCode = 1;
});
