import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';

const ACTIONS = [
  '',
  'auth.register',
  'auth.login',
  'auth.admin_login',
  'auth.password_change',
  'medicine.create',
  'medicine.update',
  'medicine.delete',
  'order.status',
  'user.role',
  'invite.create',
  'invite.accept',
  'invite.revoke',
];

export default function AdminAudit() {
  const [data, setData] = useState({ entries: [], total: 0, page: 1, pages: 1 });
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setLoading(true);
      setData(await adminApi.audit({ action, page, limit: 50 }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [action, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Every privileged action, newest first.</p>
        </div>
      </div>

      <div className="toolbar toolbar-wrap">
        <select
          value={action}
          aria-label="Filter by action"
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          {ACTIONS.map((value) => (
            <option key={value || 'all'} value={value}>
              {value || 'All actions'}
            </option>
          ))}
        </select>
        <span className="muted">{data.total} entries</span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="empty">Loading audit log…</p>
      ) : data.entries.length === 0 ? (
        <p className="empty">No audit entries yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>IP</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.created_at, { withTime: true })}</td>
                  <td>{entry.actorEmail || '—'}</td>
                  <td>
                    <code>{entry.action}</code>
                  </td>
                  <td>
                    {entry.targetType || '—'}
                    {entry.targetId ? ` · ${entry.targetId.slice(-6)}` : ''}
                  </td>
                  <td>{entry.ip || '—'}</td>
                  <td>
                    <details>
                      <summary>View</summary>
                      <pre className="audit-json">
                        {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pager">
        <button
          type="button"
          className="btn btn-small btn-ghost"
          disabled={data.page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </button>
        <span className="muted">
          Page {data.page} of {data.pages}
        </span>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          disabled={data.page >= data.pages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
