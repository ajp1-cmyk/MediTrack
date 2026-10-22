// Back-office API (staff + admin). Mounted at /api/admin after the public
// /api/admin/auth router.
//
//   GET    /api/admin/summary            dashboard counters
//   GET    /api/admin/orders             every order (filter/search/paginate)
//   GET    /api/admin/orders/:id         one order
//   PATCH  /api/admin/orders/:id/status  fulfilment transition
//   GET    /api/admin/customers          customer list + order stats
//   GET    /api/admin/audit              audit log (admin only)
//   POST   /api/admin/invites            create an admin/staff invite (admin)
//   GET    /api/admin/invites            list invites (admin)
//   DELETE /api/admin/invites/:id        revoke an invite (admin)
const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const Medicine = require('../models/Medicine');
const { INVITE_ROLES } = require('../models/AdminInvite');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { httpError, asyncHandler } = require('../lib/errors');
const { recordAudit, listAudit } = require('../lib/audit');
const { restoreStock } = require('../lib/orderService');
const {
  createInvite,
  listInvites,
  revokeInviteById,
  INVITE_TTL_HOURS,
} = require('../lib/invites');

const router = express.Router();
router.use(requireAuth);

// Only these forward transitions are allowed. Cancelling is limited to orders
// that have not been paid (money would otherwise have to be refunded first).
const ORDER_TRANSITIONS = {
  pending_payment: ['cancelled'],
  paid: ['processing'],
  processing: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  expired: [],
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pagination(query = {}, defaultLimit = 20) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function pageResult(rows, total, { page, limit }) {
  return { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

// GET /api/admin/summary
router.get(
  '/summary',
  requirePermission('orders:read:all'),
  asyncHandler(async (_req, res) => {
    const [medicines, lowStock, customers, statusRows, revenueRows, recentOrders] =
      await Promise.all([
        Medicine.countDocuments(),
        Medicine.countDocuments({ stock: { $lte: 10 } }),
        User.countDocuments({ role: 'customer' }),
        Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        Order.aggregate([
          { $match: { status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } } },
          { $group: { _id: null, total: { $sum: '$totals.total' } } },
        ]),
        Order.find().sort({ created_at: -1 }).limit(5).populate('user', 'name email'),
      ]);

    const byStatus = {};
    for (const row of statusRows) byStatus[row._id] = row.count;

    res.json({
      medicines,
      lowStock,
      customers,
      orders: {
        total: statusRows.reduce((sum, row) => sum + row.count, 0),
        byStatus,
      },
      revenue: revenueRows[0] ? revenueRows[0].total : 0,
      recentOrders,
    });
  })
);

// GET /api/admin/orders?status=&q=&page=&limit=
router.get(
  '/orders',
  requirePermission('orders:read:all'),
  asyncHandler(async (req, res) => {
    const paging = pagination(req.query);
    const filter = {};

    if (req.query.status) {
      if (!Order.ORDER_STATUSES.includes(req.query.status)) {
        throw httpError(400, `status must be one of: ${Order.ORDER_STATUSES.join(', ')}`);
      }
      filter.status = req.query.status;
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      const or = [{ orderNumber: pattern }];
      if (mongoose.isValidObjectId(q)) or.push({ _id: q });

      const matchedUsers = await User.find({ email: pattern }).select('_id').limit(50);
      if (matchedUsers.length > 0) {
        or.push({ user: { $in: matchedUsers.map((user) => user._id) } });
      }
      filter.$or = or;
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ created_at: -1 })
        .skip(paging.skip)
        .limit(paging.limit)
        .populate('user', 'name email'),
      Order.countDocuments(filter),
    ]);

    res.json({ orders, ...pageResult(orders, total, paging) });
  })
);

// GET /api/admin/orders/:id
router.get(
  '/orders/:id',
  requirePermission('orders:read:all'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw httpError(404, 'Order not found');
    }
    const order = await Order.findById(req.params.id).populate('user', 'name email');
    if (!order) throw httpError(404, 'Order not found');
    res.json(order);
  })
);

// PATCH /api/admin/orders/:id/status
router.patch(
  '/orders/:id/status',
  requirePermission('orders:write'),
  asyncHandler(async (req, res) => {
    const nextStatus = req.body ? req.body.status : null;
    if (!Order.ORDER_STATUSES.includes(nextStatus)) {
      throw httpError(400, `status must be one of: ${Order.ORDER_STATUSES.join(', ')}`);
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw httpError(404, 'Order not found');
    }

    const order = await Order.findById(req.params.id);
    if (!order) throw httpError(404, 'Order not found');

    const previousStatus = order.status;
    const allowed = ORDER_TRANSITIONS[previousStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw httpError(
        409,
        `An order cannot move from "${previousStatus}" to "${nextStatus}".`
      );
    }

    order.status = nextStatus;
    if (nextStatus === 'cancelled') {
      order.payment.status = 'cancelled';
      order.payment.failureReason = 'Cancelled by an administrator.';
      order.expiresAt = null;
    }
    await order.save();

    if (nextStatus === 'cancelled') {
      await restoreStock(order.items);
    }

    await recordAudit({
      req,
      action: 'order.status',
      targetType: 'order',
      targetId: order._id,
      before: { status: previousStatus },
      after: { status: nextStatus },
    });

    res.json(order);
  })
);

// GET /api/admin/customers?q=&page=&limit=
router.get(
  '/customers',
  requirePermission('customers:read'),
  asyncHandler(async (req, res) => {
    const paging = pagination(req.query);
    const filter = { role: 'customer' };

    const q = String(req.query.q || '').trim();
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    const [customers, total] = await Promise.all([
      User.find(filter).sort({ created_at: -1 }).skip(paging.skip).limit(paging.limit),
      User.countDocuments(filter),
    ]);

    const ids = customers.map((customer) => customer._id);
    const stats = await Order.aggregate([
      { $match: { user: { $in: ids } } },
      {
        $group: {
          _id: '$user',
          orders: { $sum: 1 },
          spend: { $sum: '$totals.total' },
          lastOrderAt: { $max: '$created_at' },
        },
      },
    ]);
    const byUser = new Map(stats.map((row) => [String(row._id), row]));

    const rows = customers.map((customer) => {
      const stat = byUser.get(String(customer._id));
      return {
        id: customer._id.toString(),
        name: customer.name,
        email: customer.email,
        created_at: customer.created_at,
        orders: stat ? stat.orders : 0,
        spend: stat ? stat.spend : 0,
        lastOrderAt: stat ? stat.lastOrderAt : null,
      };
    });

    res.json({ customers: rows, ...pageResult(rows, total, paging) });
  })
);

// GET /api/admin/audit?action=&page=&limit=
router.get(
  '/audit',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    res.json(
      await listAudit({
        page: req.query.page,
        limit: req.query.limit,
        action: req.query.action,
      })
    );
  })
);

// POST /api/admin/invites — { email, role }
router.post(
  '/invites',
  requirePermission('invites:manage'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body.role;

    if (!email) throw httpError(400, 'email is required');
    if (!INVITE_ROLES.includes(role)) {
      throw httpError(400, `role must be one of: ${INVITE_ROLES.join(', ')}`);
    }

    const existing = await User.findOne({ email });
    if (existing) {
      throw httpError(409, 'An account with this email already exists');
    }

    const { invite, token, expiresAt } = await createInvite({
      email,
      role,
      createdBy: req.user._id,
    });

    await recordAudit({
      req,
      action: 'invite.create',
      targetType: 'invite',
      targetId: invite._id,
      after: { email, role, expiresAt },
    });

    res.status(201).json({
      invite,
      token,
      registerPath: `/admin/register?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
      expiresInHours: INVITE_TTL_HOURS,
    });
  })
);

// GET /api/admin/invites?includeClosed=true
router.get(
  '/invites',
  requirePermission('invites:manage'),
  asyncHandler(async (req, res) => {
    res.json(await listInvites({ includeClosed: req.query.includeClosed === 'true' }));
  })
);

// DELETE /api/admin/invites/:id
router.delete(
  '/invites/:id',
  requirePermission('invites:manage'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw httpError(404, 'Invite not found');
    }

    const invite = await revokeInviteById(req.params.id);
    if (!invite) throw httpError(404, 'Invite not found');

    await recordAudit({
      req,
      action: 'invite.revoke',
      targetType: 'invite',
      targetId: invite._id,
      after: { email: invite.email, role: invite.role },
    });

    res.json({ success: true, id: invite._id.toString() });
  })
);

module.exports = router;

