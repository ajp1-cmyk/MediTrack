import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login, register, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from || '/';

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const update = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  if (user) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Already signed in</h1>
          <p>
            You are signed in as <strong>{user.name}</strong> ({user.role}).
          </p>
        </div>
        <p className="auth-links">
          <Link to="/" className="btn btn-secondary">
            Back to stock
          </Link>
        </p>
      </main>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register(form);
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <div className="page-header">
        <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
        <p>
          {mode === 'login'
            ? 'Sign in to add or update medicine stock.'
            : 'The first account created becomes the administrator.'}
        </p>
      </div>

      <div className="form-card">
        <div className="auth-tabs">
          <button
            type="button"
            className={`btn btn-ghost${mode === 'login' ? ' active' : ''}`}
            onClick={() => {
              setMode('login');
              setError('');
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`btn btn-ghost${mode === 'register' ? ' active' : ''}`}
            onClick={() => {
              setMode('register');
              setError('');
            }}
          >
            Create account
          </button>
        </div>

        <form className="medicine-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input
                id="name"
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="e.g. Ada Sharma"
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={mode === 'register' ? 8 : undefined}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>

          {error && <p className="error">{error}</p>}
        </form>

        <p className="auth-hint">
          Admins can add, update and delete stock. Staff accounts can only view the stock list.
          Once the first admin exists, only an admin can create further accounts.
        </p>
      </div>
    </main>
  );
}
