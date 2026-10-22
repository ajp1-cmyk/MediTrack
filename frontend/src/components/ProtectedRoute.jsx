import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Wraps a route so that only signed-in users (optionally with a specific role)
 * can open it. Anyone else is sent to the sign-in page.
 */
export default function ProtectedRoute({ roles, loginPath = '/login', children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="page">
        <p className="empty">Checking your access…</p>
      </main>
    );
  }

  if (!user) {
    return <Navigate to={loginPath} state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Not allowed</h1>
          <p>
            This page is for {roles.join(' / ')} accounts. You are signed in as{' '}
            <strong>{user.role}</strong>.
          </p>
        </div>
        <p className="auth-links">
          <Link to="/" className="btn btn-secondary">
            Back to storefront
          </Link>
        </p>
      </main>
    );
  }

  return children;
}
