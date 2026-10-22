import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';

const STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted',
  revoked: 'Revoked',
  expired: 'Expired',
};

export default function AdminInvites() {
  const [invites, setInvites] = useState([]);
  const [form, setForm] = useState({ email: '', role: 'staff' });
  const [created, setCreated] = useState(null);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setLoading(true);
      setInvites(await adminApi.invites(includeClosed ? { includeClosed: 'true' } : {}));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [includeClosed]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const result = await adminApi.createInvite(form);
      setCreated(result);
      setForm({ email: '', role: 'staff' });
      setNotice('Invite created. Copy the link and send it privately.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const revoke = async (invite) => {
    if (!window.confirm(`Revoke the invite for ${invite.email}?`)) return;
    try {
      setError('');
      await adminApi.revokeInvite(invite.id);
      setNotice(`Invite for ${invite.email} revoked.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const inviteLink = created ? `${window.location.origin}${created.registerPath}` : '';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setNotice('Invite link copied to the clipboard.');
    } catch {
      setNotice('Copy failed — select the link and copy it manually.');
    }
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h1>Invites</h1>
          <p className="muted">
            Invite staff or administrators. Each link is single-use and expires automatically.
          </p>
        </div>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Create an invite</h2>
        </div>
        <form className="medicine-form invite-form" onSubmit={create}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="invite-email-input">Email</label>
              <input
                id="invite-email-input"
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="new.staff@example.com"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="invite-role-input">Role</label>
              <select
                id="invite-role-input"
                value={form.role}
                onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
              >
                <option value="staff">Staff — stock &amp; orders</option>
                <option value="admin">Administrator — full access</option>
              </select>
            </div>
          </div>
          <button type="submit" className="btn btn-primary">
            Create invite
          </button>
        </form>
      </section>

      {created && (
        <section className="admin-panel invite-created">
          <div className="admin-panel-head">
            <h2>Share this link</h2>
          </div>
          <p className="muted">
            Shown once. It creates a <strong>{created.invite.role}</strong> account for{' '}
            <strong>{created.invite.email}</strong> and expires in {created.expiresInHours} hours.
          </p>
          <div className="invite-link">
            <input readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-secondary btn-small" onClick={copyLink}>
              Copy link
            </button>
          </div>
        </section>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="success-line">{notice}</p>}

      <div className="toolbar">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
          />
          Include accepted / revoked / expired
        </label>
        <span className="muted">{invites.length} invite(s)</span>
      </div>

      {loading ? (
        <p className="empty">Loading invites…</p>
      ) : invites.length === 0 ? (
        <p className="empty">No pending invites.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.email}</td>
                  <td>
                    <span className={`role-badge role-${invite.role}`}>{invite.role}</span>
                  </td>
                  <td>
                    <span
                      className={`badge badge-${invite.status === 'pending' ? 'amber' : 'gray'}`}
                    >
                      {STATUS_LABELS[invite.status] || invite.status}
                    </span>
                  </td>
                  <td>{formatDate(invite.created_at, { withTime: true })}</td>
                  <td>{formatDate(invite.expiresAt, { withTime: true })}</td>
                  <td className="table-actions">
                    {invite.status === 'pending' && (
                      <button
                        type="button"
                        className="btn btn-small btn-ghost danger"
                        onClick={() => revoke(invite)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

