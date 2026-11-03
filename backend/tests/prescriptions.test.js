// Tests for prescription uploads, encryption at rest, staff verification and
// the prescription checkout gate (SRS FR-1.4 / FR-2.1, NFR-1.4 / NFR-2.2).
//
//   cd backend && npm test
//
// Files are uploaded as multipart/form-data, encrypted with AES-256-GCM and
// stored in MongoDB; nothing is written to the public uploads directory.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-prescriptions';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-prescriptions';
process.env.PAYMENT_MOCK_DELAY_MS = '0';
process.env.INVENTORY_AUTO_REPLENISH = 'off';
process.env.DAILY_PURCHASE_LIMIT = '0';
process.env.PRESCRIPTION_VALID_DAYS = '30';
// A fixed 32-byte key so a decryption failure is unambiguously a test failure.
process.env.RX_ENCRYPTION_KEY = 'ab'.repeat(32);

const { MongoMemoryServer } = require('mongodb-memory-server');
const { createUser } = require('./support');
const Prescription = require('../models/Prescription');
const {
  MAX_VALID_DAYS,
  DEFAULT_VALID_DAYS,
  prescriptionValidDays,
  encryptionKey,
  encryptFile,
  decryptFile,
} = require('../lib/prescriptions');

let mongo;
let server;
let baseUrl;

async function api(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  let payload;

  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** GET a binary response (prescription files) without parsing it as JSON. */
async function fetchFile(path, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return {
    status: res.status,
    headers: res.headers,
    buffer: Buffer.from(await res.arrayBuffer()),
  };
}

/** Build the multipart body the upload route expects. */
function prescriptionForm(buffer, { filename = 'prescription.pdf', type = 'application/pdf' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), filename);
  return form;
}

const PDF_BYTES = Buffer.from('%PDF-1.4\n% meditrack test prescription\nEND-OF-FILE\n');
const ADMIN = { name: 'Ada Admin', email: 'rx-admin@meditrack.test', password: 'admin-pass-123' };
const STAFF = { name: 'Sam Staff', email: 'rx-staff@meditrack.test', password: 'staff-pass-123' };
const CUSTOMER = {
  name: 'Cara Customer',
  email: 'rx-customer@meditrack.test',
  password: 'customer-pass-123',
};
const OTHER = {
  name: 'Owen Other',
  email: 'rx-other@meditrack.test',
  password: 'customer-pass-123',
};

const SHIPPING = {
  fullName: 'Cara Customer',
  phone: '9876543210',
  email: 'rx-customer@meditrack.test',
  line1: '1 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

let adminToken;
let staffToken;
let customerToken;
let otherToken;
let rxMedicine;
let otcMedicine;
// The first accepted upload, reused by the file-access and verification tests.
let firstId;

async function login(account) {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

/** Create a medicine through the multipart admin route. */
async function addMedicine({ name, prescriptionRequired }) {
  const form = new FormData();
  form.append('name', name);
  form.append('mfd', '2025-01-15');
  form.append('exp', '2028-01-15');
  form.append('price', '120');
  form.append('stock', '100');
  form.append('prescriptionRequired', prescriptionRequired ? 'true' : 'false');

  const res = await fetch(`${baseUrl}/api/medicines`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  });
  const text = await res.text();
  assert.equal(res.status, 201, text);
  return JSON.parse(text);
}

async function clearCart(token) {
  const res = await api('/api/cart', { method: 'DELETE', token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

async function addToCart(token, medicineId, quantity = 1) {
  const res = await api('/api/cart/items', {
    method: 'POST',
    token,
    body: { medicineId, quantity },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function checkout(token) {
  return api('/api/orders', {
    method: 'POST',
    token,
    body: { shippingAddress: SHIPPING },
  });
}

async function uploadPrescription(token, options = {}) {
  return api('/api/prescriptions', {
    method: 'POST',
    token,
    form: prescriptionForm(PDF_BYTES, options),
  });
}

/** Approve or reject through the staff endpoint. */
async function review(token, id, payload) {
  return api(`/api/admin/prescriptions/${id}/verify`, {
    method: 'POST',
    token,
    body: payload,
  });
}

async function prescriptionState(token) {
  const res = await api('/api/prescriptions', { token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.state;
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_prescriptions_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createUser({ ...ADMIN, role: 'admin' });
  await createUser({ ...STAFF, role: 'staff' });
  await createUser({ ...CUSTOMER, role: 'customer' });
  await createUser({ ...OTHER, role: 'customer' });

  adminToken = await login(ADMIN);
  staffToken = await login(STAFF);
  customerToken = await login(CUSTOMER);
  otherToken = await login(OTHER);

  rxMedicine = await addMedicine({ name: 'Amoxicillin 500mg', prescriptionRequired: true });
  otcMedicine = await addMedicine({ name: 'Paracetamol 500mg', prescriptionRequired: false });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

// ------------------------------------------------------- encryption helpers

test('AES-256-GCM round-trips a file and detects tampering', () => {
  const plain = Buffer.from('a prescription scan, uniquely marked: 7f3c9a');
  const encrypted = encryptFile(plain);

  assert.equal(encrypted.fileData.equals(plain), false, 'the ciphertext must differ');
  assert.equal(encrypted.fileIv.length, 24, '12-byte IV in hex');
  assert.equal(encrypted.fileAuthTag.length, 32, '16-byte GCM tag in hex');

  const document = {
    fileData: encrypted.fileData,
    fileIv: encrypted.fileIv,
    fileAuthTag: encrypted.fileAuthTag,
  };
  assert.deepEqual(decryptFile(document), plain);

  // A fresh IV per file means the same plaintext never produces the same bytes.
  const again = encryptFile(plain);
  assert.notEqual(again.fileIv, encrypted.fileIv);
  assert.equal(again.fileData.equals(encrypted.fileData), false);

  // Flip one ciphertext byte: GCM authentication must reject it.
  const tampered = Buffer.from(encrypted.fileData);
  tampered[0] ^= 0xff;
  assert.throws(
    () => decryptFile({ ...document, fileData: tampered }),
    (err) => err.status === 500 && /could not be decrypted/i.test(err.message)
  );

  // A document with no bytes left is reported as gone, not as a 500.
  assert.throws(
    () => decryptFile({ fileData: null, fileIv: null, fileAuthTag: null }),
    (err) => err.status === 410
  );
});

test('the encryption key and validity window come from the environment', () => {
  const key = encryptionKey();
  assert.equal(key.length, 32);
  assert.equal(key.toString('hex'), 'ab'.repeat(32));

  // A non-hex passphrase is stretched to 32 bytes.
  const originalKey = process.env.RX_ENCRYPTION_KEY;
  try {
    process.env.RX_ENCRYPTION_KEY = 'a long passphrase';
    const derived = encryptionKey();
    assert.equal(derived.length, 32);
    assert.equal(derived.toString('hex'), crypto.createHash('sha256').update('a long passphrase').digest('hex'));

    // Falling back to JWT_SECRET keeps an existing deployment readable.
    delete process.env.RX_ENCRYPTION_KEY;
    const fromJwt = encryptionKey();
    assert.equal(fromJwt.length, 32);
    assert.equal(
      fromJwt.toString('hex'),
      crypto.createHash('sha256').update(`meditrack-rx:${process.env.JWT_SECRET}`).digest('hex')
    );
  } finally {
    process.env.RX_ENCRYPTION_KEY = originalKey;
  }

  assert.equal(prescriptionValidDays(), 30);
  const originalDays = process.env.PRESCRIPTION_VALID_DAYS;
  try {
    delete process.env.PRESCRIPTION_VALID_DAYS;
    assert.equal(prescriptionValidDays(), DEFAULT_VALID_DAYS);
    assert.equal(DEFAULT_VALID_DAYS, 365);

    process.env.PRESCRIPTION_VALID_DAYS = '0';
    assert.equal(prescriptionValidDays(), DEFAULT_VALID_DAYS);
    process.env.PRESCRIPTION_VALID_DAYS = String(MAX_VALID_DAYS + 1);
    assert.equal(prescriptionValidDays(), DEFAULT_VALID_DAYS);
    process.env.PRESCRIPTION_VALID_DAYS = 'not-a-number';
    assert.equal(prescriptionValidDays(), DEFAULT_VALID_DAYS);
  } finally {
    process.env.PRESCRIPTION_VALID_DAYS = originalDays;
  }
});

// --------------------------------------------------------- upload validation

test('uploading requires a signed-in customer', async () => {
  const anonymous = await api('/api/prescriptions', {
    method: 'POST',
    form: prescriptionForm(PDF_BYTES),
  });
  assert.equal(anonymous.status, 401);
});

test('the upload route rejects a missing, wrong-type or oversized file', async () => {
  const missing = await api('/api/prescriptions', {
    method: 'POST',
    token: customerToken,
    form: new FormData(),
  });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /Attach a prescription file/i);

  const wrongType = await uploadPrescription(customerToken, {
    filename: 'notes.txt',
    type: 'text/plain',
  });
  assert.equal(wrongType.status, 415);
  assert.match(wrongType.body.error, /must be one of/i);

  // A real 5 MB + 1 KB body, for a different account so the pending-upload rule
  // in the next test is unaffected.
  const big = Buffer.alloc(Prescription.MAX_BYTES + 1024, 0x41);
  const tooBig = await api('/api/prescriptions', {
    method: 'POST',
    token: otherToken,
    form: prescriptionForm(big, { filename: 'huge.pdf' }),
  });
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.body.error, /larger than 5 MB/i);
});

test('an accepted upload is encrypted at rest and stored without plaintext', async () => {
  const res = await uploadPrescription(customerToken, { filename: 'scan.pdf' });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const uploaded = res.body.prescription;
  assert.equal(uploaded.status, 'pending');
  assert.equal(uploaded.sizeBytes, PDF_BYTES.length);
  assert.equal(uploaded.mimeType, 'application/pdf');
  assert.equal(uploaded.originalName, 'scan.pdf');
  firstId = uploaded.id;
  assert.equal(uploaded.fileData, undefined, 'the response must not leak the bytes');
  assert.equal(uploaded.fileIv, undefined);
  assert.equal(uploaded.fileAuthTag, undefined);

  assert.equal(res.body.state.status, 'pending');
  assert.equal(res.body.state.pending, true);
  assert.equal(res.body.state.verified, false);
  assert.equal(res.body.state.prescriptionId, uploaded.id);

  // Default queries never even load the encrypted fields.
  const plain = await Prescription.findById(uploaded.id);
  assert.equal(plain.fileData, undefined);
  assert.equal(plain.fileIv, undefined);
  assert.equal(plain.fileAuthTag, undefined);

  const stored = await Prescription.findById(uploaded.id).select(
    '+fileData +fileIv +fileAuthTag'
  );
  assert.ok(Buffer.isBuffer(stored.fileData));
  assert.equal(stored.fileIv.length, 24);
  assert.equal(stored.fileAuthTag.length, 32);
  assert.equal(stored.fileData.includes(Buffer.from('meditrack test prescription')), false);
  assert.equal(stored.fileData.includes(PDF_BYTES), false);
  assert.deepEqual(decryptFile(stored), PDF_BYTES);
});

test('only one upload can wait for verification at a time', async () => {
  const second = await uploadPrescription(customerToken, { filename: 'second.pdf' });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /waiting for verification/i);
});

test('the history lists the caller\'s uploads with their status', async () => {
  const res = await api('/api/prescriptions', { token: customerToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.prescriptions.length, 1);
  assert.equal(res.body.prescriptions[0].status, 'pending');
  assert.equal(res.body.prescriptions[0].fileData, undefined);
  assert.equal(res.body.state.status, 'pending');

  const other = await api('/api/prescriptions', { token: otherToken });
  assert.equal(other.body.prescriptions.length, 0);
  assert.equal(other.body.state.status, 'none');
});

// ------------------------------------------------------------- file access

test('the owner can read the decrypted file; nobody else can', async () => {
  const anonymous = await fetchFile(`/api/prescriptions/${firstId}/file`);
  assert.equal(anonymous.status, 401);

  const owner = await fetchFile(`/api/prescriptions/${firstId}/file`, customerToken);
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get('content-type'), 'application/pdf');
  assert.equal(owner.headers.get('cache-control'), 'no-store');
  assert.equal(owner.headers.get('x-content-type-options'), 'nosniff');
  assert.match(owner.headers.get('content-disposition'), /^inline; filename="scan\.pdf"$/);
  assert.equal(owner.headers.get('content-length'), String(PDF_BYTES.length));
  assert.deepEqual(owner.buffer, PDF_BYTES);

  // Another customer must not learn that the id exists.
  const stranger = await fetchFile(`/api/prescriptions/${firstId}/file`, otherToken);
  assert.equal(stranger.status, 404);

  // Staff are verifiers and may open the file from the review queue.
  const verifier = await fetchFile(`/api/prescriptions/${firstId}/file`, staffToken);
  assert.equal(verifier.status, 200);
  assert.deepEqual(verifier.buffer, PDF_BYTES);
});

test('malformed and unknown prescription ids are 404s', async () => {
  const malformed = await fetchFile('/api/prescriptions/not-an-id/file', customerToken);
  assert.equal(malformed.status, 404);

  const unknown = await fetchFile(
    `/api/prescriptions/${new mongoose.Types.ObjectId()}/file`,
    customerToken
  );
  assert.equal(unknown.status, 404);
});

test('only verifiers may list the queue or decide an upload', async () => {
  const queue = await api('/api/admin/prescriptions', { token: customerToken });
  assert.equal(queue.status, 403);

  const decide = await review(customerToken, firstId, { approved: true });
  assert.equal(decide.status, 403);

  const staffQueue = await api('/api/admin/prescriptions?status=pending', { token: staffToken });
  assert.equal(staffQueue.status, 200, JSON.stringify(staffQueue.body));
  assert.equal(staffQueue.body.prescriptions.length, 1);
  assert.equal(staffQueue.body.pendingCount, 1);
  assert.equal(staffQueue.body.prescriptions[0].id, firstId);
  assert.equal(staffQueue.body.prescriptions[0].user.email, CUSTOMER.email);
  assert.equal(staffQueue.body.prescriptions[0].fileData, undefined);
});

// ------------------------------------------------------------- verification

test('a rejection needs a reason and blocks checkout', async () => {
  const noReason = await review(staffToken, firstId, { approved: false });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /rejection reason is required/i);

  const rejected = await review(staffToken, firstId, {
    approved: false,
    reason: 'The scan is unreadable.',
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.status, 'rejected');
  assert.equal(rejected.body.rejectionReason, 'The scan is unreadable.');
  assert.equal(rejected.body.validUntil, null);
  assert.ok(rejected.body.verifiedBy);

  const state = await prescriptionState(customerToken);
  assert.equal(state.status, 'rejected');
  assert.equal(state.verified, false);
  assert.equal(state.rejectionReason, 'The scan is unreadable.');

  // FR-2.1: prescription-only items cannot be bought without a valid upload.
  await clearCart(customerToken);
  await addToCart(customerToken, rxMedicine.id, 2);
  const stockBefore = (await api(`/api/medicines/${rxMedicine.id}`)).body.stock;

  const blocked = await checkout(customerToken);
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.match(blocked.body.error, /verified prescription is required/i);
  assert.equal((await api(`/api/medicines/${rxMedicine.id}`)).body.stock, stockBefore);
  assert.equal((await api('/api/orders', { token: customerToken })).body.length, 0);

  // A decided upload cannot be decided again.
  const again = await review(staffToken, firstId, { approved: true });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already rejected/i);
});

test('a rejected upload may be replaced by a new one', async () => {
  const res = await uploadPrescription(customerToken, { filename: 'retry.pdf' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.prescription.status, 'pending');
  assert.equal(res.body.state.status, 'pending');
});

test('approval sets the validity window and unblocks checkout', async () => {
  const history = await api('/api/prescriptions', { token: customerToken });
  const secondId = history.body.prescriptions[0].id;

  const before = Date.now();
  const approved = await review(staffToken, secondId, { approved: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, 'verified');
  assert.equal(approved.body.rejectionReason, null);
  assert.ok(approved.body.verifiedBy);

  const validUntil = new Date(approved.body.validUntil).getTime();
  const expected = before + 30 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(validUntil - expected) < 60_000, 'validUntil ≈ now + 30 days');

  const state = await prescriptionState(customerToken);
  assert.equal(state.status, 'verified');
  assert.equal(state.verified, true);
  assert.equal(state.prescriptionId, secondId);
  assert.equal(new Date(state.validUntil).getTime(), validUntil);

  // The cart still holds the 2 Rx units from the blocked attempt.
  const order = await checkout(customerToken);
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.prescription, secondId, 'the order snapshots the prescription');
  assert.equal(new Date(order.body.prescriptionValidUntil).getTime(), validUntil);
  assert.equal(order.body.totals.itemCount, 2);

  // Approving twice is refused; the upload is already decided.
  const twice = await review(adminToken, secondId, { approved: true });
  assert.equal(twice.status, 409);
  assert.match(twice.body.error, /already verified/i);
});

test('a newer verified upload supersedes the previous one', async () => {
  const third = await uploadPrescription(customerToken, { filename: 'newer.pdf' });
  assert.equal(third.status, 201, JSON.stringify(third.body));
  const thirdId = third.body.prescription.id;

  const approved = await review(adminToken, thirdId, { approved: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, 'verified');

  const history = await api('/api/prescriptions', { token: customerToken });
  const statuses = Object.fromEntries(history.body.prescriptions.map((rx) => [rx.id, rx.status]));
  assert.equal(statuses[thirdId], 'verified');
  assert.equal(
    statuses[history.body.prescriptions.find((rx) => rx.originalName === 'retry.pdf').id],
    'superseded'
  );

  const state = await prescriptionState(customerToken);
  assert.equal(state.status, 'verified');
  assert.equal(state.prescriptionId, thirdId);
});

test('an expired prescription no longer unlocks checkout', async () => {
  await clearCart(customerToken);
  const cart = await addToCart(customerToken, rxMedicine.id, 1);
  assert.equal(cart.requiresPrescription, true);
  assert.equal(cart.prescription.status, 'verified');

  const state = await prescriptionState(customerToken);
  const past = new Date(Date.now() - 60_000);
  await Prescription.updateOne({ _id: state.prescriptionId }, { $set: { validUntil: past } });

  const expired = await prescriptionState(customerToken);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.verified, false);

  const cartAfter = await api('/api/cart', { token: customerToken });
  assert.equal(cartAfter.body.prescription.status, 'expired');

  const blocked = await checkout(customerToken);
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.match(blocked.body.error, /verified prescription is required/i);
});

test('a cart without Rx items checks out without a prescription', async () => {
  await clearCart(otherToken);
  const cart = await addToCart(otherToken, otcMedicine.id, 1);
  assert.equal(cart.requiresPrescription, false);
  assert.equal(cart.prescription.status, 'none');

  const order = await checkout(otherToken);
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.prescription, null);
  assert.equal(order.body.prescriptionValidUntil, null);
});

test('upload, verify and reject actions reach the audit log', async () => {
  const uploads = await api('/api/admin/audit?action=prescription.upload', { token: adminToken });
  assert.equal(uploads.status, 200);
  assert.ok(uploads.body.entries.length >= 3, 'every accepted upload is recorded');

  const verifies = await api('/api/admin/audit?action=prescription.verify', { token: adminToken });
  assert.equal(verifies.status, 200);
  assert.ok(verifies.body.entries.length >= 2);

  const rejections = await api('/api/admin/audit?action=prescription.reject', { token: adminToken });
  assert.equal(rejections.status, 200);
  assert.equal(rejections.body.entries.length, 1);
  assert.equal(rejections.body.entries[0].after.reason, 'The scan is unreadable.');
});
