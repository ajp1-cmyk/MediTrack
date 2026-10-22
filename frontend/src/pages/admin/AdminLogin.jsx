import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

/** Separate back-office sign-in. Customers are rejected by the API too. */
export default function AdminLogin() {
  const { user, loading, loginAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from || '/admin';
  const [form, setForm] = useState({ email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (loading) {
    return (
      <main className="admin-auth-page">
        <p className="empty">Checking your session…</p>
      </main>
    );
  }

  if (user && (user.role === 'admin' || user.role === 'staff')) {
    return <Navigate to={redirectTo} replace />;
  }

  if (user) {
    return (
      <main className="admin-auth-page">
        <div className="admin-auth-card">
          <div className="admin-auth-brand">
            <span aria-hidden="true">💊</span>
            <strong>MediTrack</strong>
            <small>Admin console</small>
          </div>
          <h1>Customer account</h1>
          <p>
            You are signed in as <strong>{user.email}</strong> ({user.role}). The back office
            needs a staff or administrator account.
          </p>
          <div className="auth-links">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                await logout();
              }}
            >
              Sign out
            </button>
            <Link to="/" className="btn btn-ghost">
              Back to storefront
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await loginAdmin(form.email, form.password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="admin-auth-page">
      <div className="admin-auth-card">
        <div className="admin-auth-brand">
          <span aria-hidden="true">💊</span>
          <strong>MediTrack</strong>
          <small>Admin console</small>
        </div>

        <h1>Sign in to the back office</h1>
        <p>Staff and administrators only. Customers sign in on the storefront.</p>

        <form className="medicine-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              autoComplete="username"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>

        <p className="auth-hint">
          Invited staff and administrators must open the invite link they were sent.{' '}
          <Link to="/">Back to storefront</Link>
        </p>
      </div>
    </main>
  );
}
