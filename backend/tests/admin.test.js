// End-to-end tests for the Phase 3 back office:
// role split, staff stock permissions, invite-based provisioning, admin order
// fulfilment, customer list and the audit log.
//
//   cd backend && npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Must be set before ../server and ../db are loaded (dotenv never overrides).
process.env.JWT_SECRET = 'test-secret-admin';
process.env.JWT_ACCESS_TTL = '1h';
process.env.COOKIE_SECRET = 'test-cookie-secret-admin';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '1000';
process.env.AUTH_REGISTER_RATE_LIMIT_MAX = '1000';
process.env.ORDER_RESERVATION_MINUTES = '30';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { createUser } = require('./support');

let mongo;
let server;
let baseUrl;

async function api(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  let payload;

  if (form) {
    payload = new FormData();
    Object.entries(form).forEach(([key, value]) => payload.append(key, value));
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const ADMIN = { name: 'Ada Admin', email: 'admin@phase3.test', password: 'admin-pass-123' };
const CUSTOMER = {
  name: 'Cara Customer',
  email: 'customer@phase3.test',
  password: 'customer-pass-123',
};
const NEW_STAFF = {
  name: 'Sam Staff',
  email: 'staff-invite@phase3.test',
  password: 'staff-pass-123',
};

const SHIPPING = {
  fullName: 'Cara Customer',
  phone: '9876543210',
  email: CUSTOMER.email,
  line1: '1 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

const medicineFields = (overrides = {}) => ({
  name: 'Paracetamol',
  mfd: '2025-01-15',
  exp: '2028-01-15',
  price: '100.25',
  stock: '20',
  ...overrides,
});

const state = {
  adminToken: null,
  customerToken: null,
  staffToken: null,
  medicineId: null,
  orderId: null,
  inviteToken: null,
};

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('meditrack_admin_test');

  const { connectDB } = require('../db');
  const { start } = require('../server');

  await connectDB();
  server = await start(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createUser({ ...ADMIN, role: 'admin' });
  await createUser({ ...CUSTOMER, role: 'customer' });

  const adminLogin = await api('/api/admin/auth/login', {
    method: 'POST',
    body: { email: ADMIN.email, password: ADMIN.password },
  });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
  state.adminToken = adminLogin.body.token;

  const customerLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: CUSTOMER.email, password: CUSTOMER.password },
  });
  assert.equal(customerLogin.status, 200, JSON.stringify(customerLogin.body));
  state.customerToken = customerLogin.body.token;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test('the back-office login rejects customers and wrong passwords', async () => {
  const customerAttempt = await api('/api/admin/auth/login', {
    method: 'POST',
    body: { email: CUSTOMER.email, password: CUSTOMER.password },
  });
  assert.equal(customerAttempt.status, 403);
  assert.match(customerAttempt.body.error, /back-office/i);

  const wrongPassword = await api('/api/admin/auth/login', {
    method: 'POST',
    body: { email: ADMIN.email, password: 'not-the-password' },
  });
  assert.equal(wrongPassword.status, 401);
});

test('an admin invite creates a staff account, once', async () => {
  const created = await api('/api/admin/invites', {
    method: 'POST',
    token: state.adminToken,
    body: { email: NEW_STAFF.email, role: 'staff' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(created.body.token, 'the raw invite token is returned once');
  assert.match(created.body.registerPath, /^\/admin\/register\?invite=/);
  state.inviteToken = created.body.token;

  const accepted = await api('/api/admin/auth/accept-invite', {
    method: 'POST',
    body: {
      token: state.inviteToken,
      name: NEW_STAFF.name,
      password: NEW_STAFF.password,
    },
  });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.user.role, 'staff');
  assert.equal(accepted.body.user.email, NEW_STAFF.email);
  assert.ok(accepted.body.user.permissions.includes('catalog:write'));
  state.staffToken = accepted.body.token;

  const reused = await api('/api/admin/auth/accept-invite', {
    method: 'POST',
    body: {
      token: state.inviteToken,
      name: 'Someone Else',
      password: 'another-pass-123',
    },
  });
  assert.equal(reused.status, 410);

  const login = await api('/api/admin/auth/login', {
    method: 'POST',
    body: { email: NEW_STAFF.email, password: NEW_STAFF.password },
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.role, 'staff');
});

test('an expired invite cannot be accepted', async () => {
  const AdminInvite = require('../models/AdminInvite');

  const created = await api('/api/admin/invites', {
    method: 'POST',
    token: state.adminToken,
    body: { email: 'late@phase3.test', role: 'staff' },
  });
  assert.equal(created.status, 201);

  await AdminInvite.updateOne(
    { _id: created.body.invite.id },
    { $set: { expiresAt: new Date(Date.now() - 1000) } }
  );

  const accepted = await api('/api/admin/auth/accept-invite', {
    method: 'POST',
    body: {
      token: created.body.token,
      name: 'Late Arrival',
      password: 'late-pass-123',
    },
  });
  assert.equal(accepted.status, 410);
  assert.match(accepted.body.error, /expired/i);
});

test('customers cannot reach the admin API; staff have limited access', async () => {
  const customerSummary = await api('/api/admin/summary', {
    token: state.customerToken,
  });
  assert.equal(customerSummary.status, 403);

  const staffSummary = await api('/api/admin/summary', { token: state.staffToken });
  assert.equal(staffSummary.status, 200);

  const staffCustomers = await api('/api/admin/customers', { token: state.staffToken });
  assert.equal(staffCustomers.status, 200);

  const staffInvites = await api('/api/admin/invites', {
    method: 'POST',
    token: state.staffToken,
    body: { email: 'blocked@phase3.test', role: 'staff' },
  });
  assert.equal(staffInvites.status, 403);

  const staffAudit = await api('/api/admin/audit', { token: state.staffToken });
  assert.equal(staffAudit.status, 403);
});

test('staff can add and update stock; customers cannot', async () => {
  const denied = await api('/api/medicines', {
    method: 'POST',
    token: state.customerToken,
    form: medicineFields({ name: 'Customer Item' }),
  });
  assert.equal(denied.status, 403);

  const created = await api('/api/medicines', {
    method: 'POST',
    token: state.staffToken,
    form: medicineFields({ name: 'Staff Stock Item', stock: '5' }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  state.medicineId = created.body.id;

  const updated = await api(`/api/medicines/${state.medicineId}`, {
    method: 'PATCH',
    token: state.staffToken,
    body: { stock: 10 },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.stock, 10);
});

test('a customer can order and staff can fulfil it', async () => {
  const added = await api('/api/cart/items', {
    method: 'POST',
    token: state.customerToken,
    body: { medicineId: state.medicineId, quantity: 1 },
  });
  assert.equal(added.status, 201, JSON.stringify(added.body));

  const order = await api('/api/orders', {
    method: 'POST',
    token: state.customerToken,
    body: { shippingAddress: SHIPPING },
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  state.orderId = order.body.id;

  const paid = await api(`/api/orders/${state.orderId}/pay`, {
    method: 'POST',
    token: state.customerToken,
    body: { method: 'cod' },
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.status, 'processing');

  const shipped = await api(`/api/admin/orders/${state.orderId}/status`, {
    method: 'PATCH',
    token: state.staffToken,
    body: { status: 'shipped' },
  });
  assert.equal(shipped.status, 200, JSON.stringify(shipped.body));
  assert.equal(shipped.body.status, 'shipped');

  const delivered = await api(`/api/admin/orders/${state.orderId}/status`, {
    method: 'PATCH',
    token: state.staffToken,
    body: { status: 'delivered' },
  });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  assert.equal(delivered.body.status, 'delivered');

  const invalid = await api(`/api/admin/orders/${state.orderId}/status`, {
    method: 'PATCH',
    token: state.staffToken,
    body: { status: 'paid' },
  });
  assert.equal(invalid.status, 409);

  const list = await api('/api/admin/orders?status=delivered', {
    token: state.staffToken,
  });
  assert.equal(list.status, 200);
  assert.ok(list.body.orders.some((row) => row.id === state.orderId));

  const detail = await api(`/api/admin/orders/${state.orderId}`, {
    token: state.staffToken,
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.user.email, CUSTOMER.email);

  const customers = await api('/api/admin/customers', { token: state.staffToken });
  const cara = customers.body.customers.find((row) => row.email === CUSTOMER.email);
  assert.ok(cara, 'the customer should be listed');
  assert.ok(cara.orders >= 1);
  assert.ok(cara.spend > 0);
});

test('only admins can change roles, and the change is audited', async () => {
  const users = await api('/api/auth/users', { token: state.adminToken });
  const staff = users.body.find((user) => user.email === NEW_STAFF.email);

  const denied = await api(`/api/auth/users/${staff.id}/role`, {
    method: 'PATCH',
    token: state.staffToken,
    body: { role: 'admin' },
  });
  assert.equal(denied.status, 403);

  const promoted = await api(`/api/auth/users/${staff.id}/role`, {
    method: 'PATCH',
    token: state.adminToken,
    body: { role: 'admin' },
  });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.equal(promoted.body.role, 'admin');

  const demoted = await api(`/api/auth/users/${staff.id}/role`, {
    method: 'PATCH',
    token: state.adminToken,
    body: { role: 'staff' },
  });
  assert.equal(demoted.status, 200);
  assert.equal(demoted.body.role, 'staff');

  const audit = await api('/api/admin/audit?action=user.role', {
    token: state.adminToken,
  });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.entries.length >= 2);
});

test('the audit log records privileged actions', async () => {
  const audit = await api('/api/admin/audit?limit=100', { token: state.adminToken });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.total >= 5);

  const actions = new Set(audit.body.entries.map((entry) => entry.action));
  for (const expected of [
    'auth.admin_login',
    'invite.create',
    'invite.accept',
    'medicine.create',
    'medicine.update',
    'order.status',
  ]) {
    assert.ok(actions.has(expected), `expected an "${expected}" audit entry`);
  }

  assert.ok(
    audit.body.entries.every((entry) => entry.tokenHash === undefined),
    'audit entries must never contain token hashes'
  );
});

test('the dashboard summary reports live counters', async () => {
  const summary = await api('/api/admin/summary', { token: state.adminToken });
  assert.equal(summary.status, 200);
  assert.ok(summary.body.medicines >= 1);
  assert.ok(summary.body.customers >= 1);
  assert.ok(summary.body.orders.total >= 1);
  assert.ok(summary.body.orders.byStatus.delivered >= 1);
});



