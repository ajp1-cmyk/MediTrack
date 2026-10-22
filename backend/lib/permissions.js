// Role → permission map shared by the API (authorisation middleware) and the
// SPA (User#toJSON includes the list, so the UI never hard-codes role checks).
//
//   customer → storefront only
//   staff    → back office: stock + fulfilment (add/update medicine, orders)
//   admin    → everything, including roles, invites and the audit log
const ROLE_PERMISSIONS = {
  customer: [],
  staff: [
    'catalog:read',
    'catalog:write',
    'orders:read:all',
    'orders:write',
    'customers:read',
  ],
  admin: [
    'catalog:read',
    'catalog:write',
    'orders:read:all',
    'orders:write',
    'customers:read',
    'users:manage',
    'invites:manage',
    'audit:read',
  ],
};

function permissionsFor(role) {
  return [...(ROLE_PERMISSIONS[role] || [])];
}

function roleHasPermission(role, permission) {
  return permissionsFor(role).includes(permission);
}

/** Roles allowed into /api/admin and the /admin console. */
function isBackOffice(role) {
  return role === 'admin' || role === 'staff';
}

module.exports = {
  ROLE_PERMISSIONS,
  permissionsFor,
  roleHasPermission,
  isBackOffice,
};
