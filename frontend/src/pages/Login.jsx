import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/** Seconds left on a countdown that ends at `until` (epoch ms). */
function secondsUntil(until) {
  if (!until) return 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/**
 * Sign in, sign up or sign in with an emailed one-time code.
 *
 * Two methods are offered side by side and never stacked:
 *
 *   password → MediTrack's own email + password form (sign in / create account)
 *   code     → the API emails six digits; verifying them returns the same
 *              session. A new address becomes a `customer` account, so this is
 *              sign-up and sign-in in one step.
 *
 * Both end in the same place: `navigate(redirectTo)`, where `redirectTo` is the
 * page a ProtectedRoute bounced the visitor away from.
 */
export default function Login() {
  const {
    login,
    register,
    requestOtp,
    verifyOtp,
    user,
    sessionExpired,
    clearSessionExpired,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from || '/';

  // Which sign-in method is on screen: 'password' | 'code'.
  const [method, setMethod] = useState('password');

  // --- email + password form ------------------------------------------------
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  // Customer fields only. Administrator accounts are not self-service: they are
  // created from the separate, unlinked /admin/register page using the invite
  // code configured by the site owner.
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // --- emailed one-time code -----------------------------------------------
  const [otpStep, setOtpStep] = useState('email'); // 'email' | 'code'
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpName, setOtpName] = useState('');
  const [otpTtlMinutes, setOtpTtlMinutes] = useState(10);
  const [otpDevCode, setOtpDevCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState('');

  // Live countdown for "resend code" (the server also enforces the cooldown).
  useEffect(() => {
    if (!resendAt) return undefined;
    const tick = () => setWaitSeconds(secondsUntil(resendAt));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

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
    clearSessionExpired();

    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        // Sign-up from the storefront always creates a customer account; the
        // server defaults to the customer role when no role is sent.
        await register({
          name: form.name,
          email: form.email,
          password: form.password,
        });
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /** Ask the API to email a code (also used by "Resend code"). */
  const requestCode = async (event) => {
    if (event) event.preventDefault();
    setOtpBusy(true);
    setOtpError('');

    try {
      const data = await requestOtp(otpEmail.trim());
      setOtpEmail(data.email || otpEmail.trim());
      setOtpStep('code');
      setOtpCode('');
      setOtpTtlMinutes(data.expiresInMinutes || 10);
      setOtpDevCode(data.devCode || '');
      setResendAt(Date.now() + (data.resendAfterSeconds ?? 30) * 1000);
    } catch (err) {
      setOtpError(err.message);
    } finally {
      setOtpBusy(false);
    }
  };

  /** Trade the code for a session. */
  const verifyCode = async (event) => {
    event.preventDefault();
    setOtpBusy(true);
    setOtpError('');

    try {
      await verifyOtp({
        email: otpEmail.trim(),
        code: otpCode.trim(),
        name: otpName.trim() || undefined,
      });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setOtpError(err.message);
      setOtpCode('');
    } finally {
      setOtpBusy(false);
    }
  };

  const switchMethod = (next) => {
    setMethod(next);
    setError('');
    setOtpError('');
    clearSessionExpired();
  };

  const changeEmail = () => {
    setOtpStep('email');
    setOtpCode('');
    setOtpDevCode('');
    setOtpError('');
    setResendAt(0);
  };

  return (
    <main className="page">
      <div className="page-header">
        <h1>
          {method === 'code'
            ? otpStep === 'code'
              ? 'Enter your code'
              : 'Sign in with a code'
            : mode === 'login'
              ? 'Sign in'
              : 'Create account'}
        </h1>
        <p>
          {method === 'code'
            ? 'We email you a 6-digit code — no password to remember. A new address gets a customer account.'
            : mode === 'login'
              ? 'Sign in to check out, track orders and manage your account.'
              : 'Create a customer account to check out, track orders and save your details.'}
        </p>
      </div>

      <div className="form-card">
        <div className="auth-method-switch" role="group" aria-label="Sign-in method">
          <button
            type="button"
            className={`auth-method${method === 'password' ? ' active' : ''}`}
            aria-pressed={method === 'password'}
            onClick={() => switchMethod('password')}
          >
            Email &amp; password
          </button>
          <button
            type="button"
            className={`auth-method${method === 'code' ? ' active' : ''}`}
            aria-pressed={method === 'code'}
            onClick={() => switchMethod('code')}
          >
            Email code
            <span className="auth-method-tag">OTP</span>
          </button>
        </div>

        {method === 'password' && (
          <>
            <div className="auth-tabs">
              <button
                type="button"
                className={`btn btn-ghost${mode === 'login' ? ' active' : ''}`}
                onClick={() => {
                  setMode('login');
                  setError('');
                  clearSessionExpired();
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
                  clearSessionExpired();
                }}
              >
                Create account
              </button>
            </div>

            {sessionExpired && (
              <p className="error" role="alert">
                Your session expired. Please sign in again.
              </p>
            )}

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
                    autoComplete="name"
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
          </>
        )}

        {method === 'code' && otpStep === 'email' && (
          <form className="medicine-form" onSubmit={requestCode}>
            <div className="field">
              <label htmlFor="otp-email">Email</label>
              <input
                id="otp-email"
                type="email"
                value={otpEmail}
                onChange={(e) => setOtpEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={otpBusy}>
              {otpBusy ? 'Sending…' : 'Email me a code'}
            </button>

            {otpError && <p className="error">{otpError}</p>}
          </form>
        )}

        {method === 'code' && otpStep === 'code' && (
          <>
            <p className="otp-sent">
              We sent a 6-digit code to <strong>{otpEmail}</strong>. It can be used once and
              expires in {otpTtlMinutes} minute{otpTtlMinutes === 1 ? '' : 's'}.
            </p>

            {/* The API adds `devCode` only when it runs with OTP_EXPOSE_CODE=true
                (never in production), so the demo needs no real mailbox. */}
            {otpDevCode && (
              <p className="otp-dev" role="status">
                Development code: <strong>{otpDevCode}</strong>
              </p>
            )}

            <form className="medicine-form" onSubmit={verifyCode}>
              <div className="field">
                <label htmlFor="otp-code">Sign-in code</label>
                <input
                  id="otp-code"
                  className="otp-code-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  autoFocus
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="otp-name">
                  Full name <span className="muted">(new accounts only)</span>
                </label>
                <input
                  id="otp-name"
                  type="text"
                  value={otpName}
                  onChange={(e) => setOtpName(e.target.value)}
                  placeholder="e.g. Ada Sharma"
                  autoComplete="name"
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={otpBusy || otpCode.length !== 6}
              >
                {otpBusy ? 'Checking…' : 'Verify and sign in'}
              </button>

              {otpError && <p className="error">{otpError}</p>}

              <div className="otp-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={requestCode}
                  disabled={otpBusy || waitSeconds > 0}
                >
                  {waitSeconds > 0 ? `Resend in ${waitSeconds}s` : 'Resend code'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={changeEmail}
                  disabled={otpBusy}
                >
                  Use a different email
                </button>
              </div>
            </form>
          </>
        )}

        <p className="auth-hint">
          Customer accounts can browse stock and place orders. Staff and administrators sign
          in on the <Link to="/admin/login">back-office page</Link>.
        </p>
      </div>
    </main>
  );
}
