// Audit logging helper.
const AuditLog = require('../models/AuditLog');

function requestMeta(req) {
  if (!req) return { ip: '', userAgent: '' };
  return {
    ip: String(req.ip || '').slice(0, 64),
    userAgent: String(req.get('user-agent') || '').slice(0, 300),
  };
}

/**
 * Record an audit entry. Never throws: a logging failure must not break the
 * action that was already committed.
 */
async function recordAudit({ req, actor, action, targetType, targetId, before, after }) {
  try {
    const user = actor || (req ? req.user : null);
    const { ip, userAgent } = requestMeta(req);

    await AuditLog.create({
      actor: user ? user._id : null,
      actorEmail: user ? user.email : null,
      action,
      targetType: targetType || null,
      targetId: targetId ? String(targetId) : null,
      before: before === undefined ? null : before,
      after: after === undefined ? null : after,
      ip,
      userAgent,
    });
  } catch (err) {
    console.error(`[audit] could not record "${action}": ${err.message}`);
  }
}

/** Paginated audit list, newest first. */
async function listAudit({ page = 1, limit = 50, action } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const filter = action ? { action } : {};

  const [entries, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ created_at: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    AuditLog.countDocuments(filter),
  ]);

  return {
    entries,
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

module.exports = { recordAudit, listAudit };
