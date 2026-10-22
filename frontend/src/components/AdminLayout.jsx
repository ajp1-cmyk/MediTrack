import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV_ITEMS = [
  { to: '/admin', end: true, label: 'Dashboard' },
  { to: '/admin/stock', label: 'Stock', permission: 'catalog:write' },
  { to: '/admin/orders', label: 'Orders', permission: 'orders:read:all' },
  { to: '/admin/customers', label: 'Customers', permission: 'customers:read' },
  { to: '/admin/invites', label: 'Invites', permission: 'invites:manage' },
  { to: '/admin/audit', label: 'Audit log', permission: 'audit:read' },
];

/** Shell for every /admin page: sidebar + top bar + nested page content. */
export default function AdminLayout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link to="/admin" className="admin-brand">
          <span aria-hidden="true">💊</span>
          <span>
            <strong>MediTrack</strong>
            <small>Admin console</small>
          </span>
        </Link>

        <nav className="admin-nav" aria-label="Back office">
          {NAV_ITEMS.filter((item) => !item.permission || can(item.permission)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-foot">
          <span className={`role-badge role-${user.role}`}>{user.role}</span>
          <strong>{user.name}</strong>
          <small>{user.email}</small>
          <Link to="/" className="btn btn-ghost btn-small">
            View storefront
          </Link>
          <button type="button" className="btn btn-ghost btn-small" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <span className="admin-topbar-title">Back office</span>
          <div className="admin-topbar-actions">
            <Link to="/" className="btn btn-ghost btn-small">
              Storefront
            </Link>
            <span className="user-chip">
              {user.name}
              <span className={`role-badge role-${user.role}`}>{user.role}</span>
            </span>
          </div>
        </header>

        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
