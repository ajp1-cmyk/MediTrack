#!/usr/bin/env node
// Verify the Clerk configuration without starting the API.
//
//   npm run clerk:check
//
// Reads CLERK_SECRET_KEY from backend/.env and VITE_CLERK_PUBLISHABLE_KEY from
// frontend/.env.local or frontend/.env (the same files the app uses), then:
//   • checks both key formats
//   • calls Clerk's Backend API to confirm the secret key and instance
//   • derives the Frontend API host from the publishable key and pings it
//   • prints exactly which variables Netlify needs
//
// Exit code 0 = both keys work; 1 = something to fix.
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');
const FRONTEND_ENV_FILES = ['.env.local', '.env'].map((name) => path.join(FRONTEND_DIR, name));

const ok = (label, message) => console.log(`✅ ${label.padEnd(34)} ${message}`);
const bad = (label, message) => console.log(`❌ ${label.padEnd(34)} ${message}`);

/** Read a key from a frontend .env file (Vite's own load order: .env.local wins). */
function readFrontendKey() {
  if (process.env.VITE_CLERK_PUBLISHABLE_KEY) return process.env.VITE_CLERK_PUBLISHABLE_KEY.trim();

  for (const file of FRONTEND_ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    const match = fs
      .readFileSync(file, 'utf8')
      .match(/^\s*VITE_CLERK_PUBLISHABLE_KEY\s*=\s*"?([^"\s#]+)"?/m);
    if (match) return match[1].trim();
  }
  return '';
}

/** `pk_test_<base64("slug.clerk.accounts.dev$")>` → the Frontend API host. */
function frontendApiHost(publishableKey) {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, '');
  try {
    return Buffer.from(encoded, 'base64').toString('utf8').replace(/\$+$/, '').trim();
  } catch {
    return '';
  }
}

/** Never print a full key. */
function mask(key) {
  if (!key) return '(unset)';
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}

async function checkSecretKey(secretKey) {
  if (!secretKey) {
    bad('backend CLERK_SECRET_KEY', 'missing — add it to backend/.env (or Netlify function env)');
    return false;
  }
  if (!/^sk_(test|live)_/.test(secretKey)) {
    bad('backend CLERK_SECRET_KEY', `unexpected format (${mask(secretKey)}) — it must start with sk_test_ or sk_live_`);
    return false;
  }

  try {
    const res = await fetch('https://api.clerk.com/v1/instance', {
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    if (res.status === 401) {
      bad('backend CLERK_SECRET_KEY', 'Clerk rejected this key — copy the whole secret from the same app');
      return false;
    }
    if (!res.ok) {
      bad('backend CLERK_SECRET_KEY', `Clerk API answered ${res.status} — try again in a moment`);
      return false;
    }

    const instance = await res.json().catch(() => ({}));
    const name = instance.instance_name || instance.application_name || 'instance';
    ok('backend CLERK_SECRET_KEY', `${mask(secretKey)} valid (app: ${name})`);
    return true;
  } catch (err) {
    bad('backend CLERK_SECRET_KEY', `could not reach api.clerk.com (${err.message})`);
    return false;
  }
}

async function checkPublishableKey(publishableKey) {
  if (!publishableKey) {
    bad(
      'frontend VITE_CLERK_PUBLISHABLE_KEY',
      'missing — add it to frontend/.env.local (and the Netlify BUILD env)'
    );
    return false;
  }
  if (!/^pk_(test|live)_/.test(publishableKey)) {
    bad(
      'frontend VITE_CLERK_PUBLISHABLE_KEY',
      `unexpected format (${mask(publishableKey)}) — it must start with pk_test_ or pk_live_`
    );
    return false;
  }

  const host = frontendApiHost(publishableKey);
  if (!host || !host.includes('.')) {
    bad('frontend VITE_CLERK_PUBLISHABLE_KEY', 'could not decode the Frontend API host from this key');
    return false;
  }

  try {
    const res = await fetch(`https://${host}/.well-known/jwks.json`);
    if (res.ok) {
      ok('frontend VITE_CLERK_PUBLISHABLE_KEY', `${mask(publishableKey)} → ${host} reachable`);
    } else {
      // Some instances do not publish that file; DNS/TLS still worked.
      ok('frontend VITE_CLERK_PUBLISHABLE_KEY', `${mask(publishableKey)} → ${host} (answered ${res.status})`);
    }
    return true;
  } catch (err) {
    bad(
      'frontend VITE_CLERK_PUBLISHABLE_KEY',
      `could not reach ${host} (${err.message}) — check the key and your network`
    );
    return false;
  }
}

async function main() {
  console.log('Clerk configuration check\n');

  const secretKey = (process.env.CLERK_SECRET_KEY || '').trim();
  const publishableKey = readFrontendKey();

  const [secretOk, publishableOk] = await Promise.all([
    checkSecretKey(secretKey),
    checkPublishableKey(publishableKey),
  ]);

  console.log('');
  if (secretOk && publishableOk) {
    console.log('Both keys work. Remaining steps:');
    console.log('  • Netlify → Site configuration → Environment variables:');
    console.log('      VITE_CLERK_PUBLISHABLE_KEY = <publishable key>   (BUILD scope — triggers a rebuild)');
    console.log('      CLERK_SECRET_KEY           = <secret key>        (functions scope)');
    console.log('  • Clerk dashboard → Domains: add http://localhost:5173 and your https://<site>.netlify.app');
    console.log('  • Redeploy, then open /login → "Continue with Clerk".');
    return 0;
  }

  console.log('Fix the lines marked ❌ above, then run `npm run clerk:check` again.\n');
  console.log('Where the keys live:');
  console.log('  backend/.env        CLERK_SECRET_KEY=sk_test_…        (never committed)');
  console.log('  frontend/.env.local VITE_CLERK_PUBLISHABLE_KEY=pk_test_… (never committed)');
  console.log('Both keys must come from the same Clerk application.');
  return 1;
}

main().then((code) => {
  process.exitCode = code;
});
