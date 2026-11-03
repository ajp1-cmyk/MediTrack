// Tests for the public catalogue: search (`?q=`), category filter, the category
// list and the single-product endpoint used by the product page.
//
//   cd backend && npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-catalog';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-catalog';
process.env.PAYMENT_MOCK_DELAY_MS = '0';
process.env.INVENTORY_AUTO_REPLENISH = 'off';

const { MongoMemoryServer } = require('mongodb-memory-server');
const Medicine = require('../models/Medicine');

let mongo;
let server;
let baseUrl;

async function api(path) {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const catalogue = [
  {
    name: 'Paracetamol 500mg',
    category: 'Pain Relief & Fever',
    description: 'Fast relief from fever and headache.',
    stock: 12,
  },
  {
    name: 'Ibuprofen 400mg',
    category: 'Pain Relief & Fever',
    description: 'For muscle pain and inflammation.',
    stock: 8,
  },
  {
    name: 'Metformin 500mg',
    category: 'Diabetes Care',
    description: 'Helps control blood sugar in type 2 diabetes.',
    stock: 20,
  },
  {
    name: 'Amoxicillin 500mg',
    category: 'Antibiotics & Antifungals',
    description: 'For chest and dental infections.',
    stock: 5,
  },
  {
    name: 'Vitamin C 500mg',
    category: 'Vitamins & Supplements',
    description: 'Daily immunity support.',
    stock: 30,
  },
  {
    name: 'Vitamin D3 60K',
    category: 'Vitamins & Supplements',
    description: 'Weekly sachet for bone strength.',
    stock: 30,
  },
  // No category: must not show up in the category dropdown.
  {
    name: 'Uncategorised Tonic',
    category: '',
    description: 'Legacy catalogue row.',
    stock: 1,
  },
];

let paracetamolId;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_catalog_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const row of catalogue) {
    const medicine = await Medicine.create({
      ...row,
      mfd: '2025-01-15',
      exp: '2028-01-15',
      price: 100,
      prescriptionRequired: row.name === 'Amoxicillin 500mg',
    });
    if (row.name === 'Paracetamol 500mg') paracetamolId = medicine._id.toString();
  }
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

// ------------------------------------------------------------------- search

test('the catalogue lists every product when no filter is given', async () => {
  const res = await api('/api/medicines');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, catalogue.length);
});

test('q matches the name, case-insensitively and partially', async () => {
  const res = await api('/api/medicines?q=paraCET');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((m) => m.name), ['Paracetamol 500mg']);
});

test('q also matches the category and the description', async () => {
  const byCategory = await api('/api/medicines?q=antibiotic');
  assert.equal(byCategory.status, 200);
  assert.deepEqual(byCategory.body.map((m) => m.name), ['Amoxicillin 500mg']);

  const byDescription = await api('/api/medicines?q=blood%20sugar');
  assert.equal(byDescription.status, 200);
  assert.deepEqual(byDescription.body.map((m) => m.name), ['Metformin 500mg']);
});

test('the category filter is exact and case-insensitive', async () => {
  const res = await api('/api/medicines?category=vitamins%20%26%20supplements');
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.map((m) => m.name).sort(),
    ['Vitamin C 500mg', 'Vitamin D3 60K']
  );
});

test('q and category can be combined', async () => {
  const res = await api('/api/medicines?q=vitamin&category=Vitamins%20%26%20Supplements');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);

  const narrowed = await api('/api/medicines?q=d3&category=Pain%20Relief%20%26%20Fever');
  assert.equal(narrowed.status, 200);
  assert.deepEqual(narrowed.body, []);
});

test('search treats regular-expression characters literally', async () => {
  for (const q of ['(', '.*', '[', '\\']) {
    const res = await api(`/api/medicines?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, `query ${q} should not error`);
    assert.deepEqual(res.body, [], `query ${q} should match nothing`);
  }
});

test('an unmatched search returns an empty list', async () => {
  const res = await api('/api/medicines?q=zzzz-no-such-medicine');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

// --------------------------------------------------------------- categories

test('the category endpoint returns sorted, non-empty categories', async () => {
  const res = await api('/api/medicines/categories');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [
    'Antibiotics & Antifungals',
    'Diabetes Care',
    'Pain Relief & Fever',
    'Vitamins & Supplements',
  ]);
});

// ------------------------------------------------------------------- detail

test('a single product exposes the fields the product page needs', async () => {
  const res = await api(`/api/medicines/${paracetamolId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Paracetamol 500mg');
  assert.equal(res.body.category, 'Pain Relief & Fever');
  assert.match(res.body.description, /fever/i);
  assert.equal(res.body.stock, 12);
  assert.equal(res.body.prescriptionRequired, false);
  assert.equal(res.body.image, null);
});

test('an unknown or malformed product id is a 404', async () => {
  const missing = await api(`/api/medicines/${new mongoose.Types.ObjectId()}`);
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /not found/i);

  const malformed = await api('/api/medicines/not-an-id');
  assert.equal(malformed.status, 404);
  assert.match(malformed.body.error, /not found/i);
});
