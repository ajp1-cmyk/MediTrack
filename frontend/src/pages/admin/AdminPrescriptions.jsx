import { useCallback, useEffect, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import { adminApi, saveBlob } from '../../lib/api.js';
import { formatDate, prescriptionStatusLabel } from '../../lib/format.js';

const STATUSES = ['pending', 'verified', 'rejected', 'superseded'];

/** Staff/admin prescription verification queue (FR-2.1). */
export default function AdminPrescriptions() {
  const [data, setData] = useState({
    prescriptions: [],
    total: 0,
    page: 1,
    pages: 1,
    pendingCount: 0,
  });
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setLoading(true);
      setData(await adminApi.prescriptions({ status, page, limit: 20 }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const view = async (prescription) => {
    setBusyId(prescription.id);
    setError('');
    try {
      const blob = await adminApi.prescriptionFile(prescription.id);
      saveBlob(blob, prescription.originalName || `prescription-${prescription.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (prescription) => {
    setBusyId(prescription.id);
    setError('');
    try {
      await adminApi.verifyPrescription(prescription.id, { approved: true });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const openReject = (prescription) => {
    setError('');
    setReason('');
    setRejecting(prescription);
  };

  const submitReject = async (event) => {
    event.preventDefault();
    if (!rejecting) return;

    const trimmed = reason.trim();
    if (!trimmed) {
      setError('A rejection reason is required.');
      return;
    }

    setBusyId(rejecting.id);
    setError('');
    try {
      await adminApi.verifyPrescription(rejecting.id, { approved: false, reason: trimmed });
      setRejecting(null);
      setReason('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h1>
            Prescriptions{' '}
            {data.pendingCount > 0 && (
              <span className="badge badge-amber">{data.pendingCount} waiting</span>
            )}
          </h1>
          <p className="muted">
            Review customer uploads before their prescription-only items can be ordered.
          </p>
        </div>
        <div className="admin-page-actions">
          <button type="button" className="btn btn-ghost btn-small" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <div className="toolbar toolbar-wrap">
        <select
          value={status}
          aria-label="Filter by status"
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {prescriptionStatusLabel(value)}
            </option>
          ))}
          <option value="all">All statuses</option>
        </select>
        <span className="muted">{data.total} upload(s)</span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="empty">Loading prescriptions…</p>
      ) : data.prescriptions.length === 0 ? (
        <p className="empty">No prescriptions match this filter.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Uploaded</th>
                <th>File</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.prescriptions.map((prescription) => (
                <tr key={prescription.id}>
                  <td>
                    {prescription.user
                      ? prescription.user.name || prescription.user.email
                      : '—'}
                    {prescription.user && (
                      <small className="table-sub">{prescription.user.email}</small>
                    )}
                  </td>
                  <td>{formatDate(prescription.created_at, { withTime: true })}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => view(prescription)}
                      disabled={busyId === prescription.id}
                    >
                      {prescription.originalName}
                    </button>
                    <small className="table-sub">
                      {Math.max(1, Math.round(prescription.sizeBytes / 1024))} KB
                      {prescription.verifiedBy
                        ? ` · reviewed by ${prescription.verifiedBy.name}`
                        : ''}
                    </small>
                  </td>
                  <td>
                    <span className={`status-chip status-${prescription.status}`}>
                      {prescriptionStatusLabel(prescription.status)}
                    </span>
                    {prescription.rejectionReason && (
                      <small className="table-sub">{prescription.rejectionReason}</small>
                    )}
                    {prescription.validUntil && prescription.status === 'verified' && (
                      <small className="table-sub">
                        Valid until {formatDate(prescription.validUntil)}
                      </small>
                    )}
                  </td>
                  <td className="table-actions">
                    {prescription.status === 'pending' ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-small btn-primary"
                          onClick={() => approve(prescription)}
                          disabled={busyId === prescription.id}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          onClick={() => openReject(prescription)}
                          disabled={busyId === prescription.id}
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-small btn-ghost"
                        onClick={() => view(prescription)}
                        disabled={busyId === prescription.id}
                      >
                        Download
                      </button>
                    )}
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

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        labelledBy="reject-prescription-title"
      >
        {rejecting && (
          <form className="reject-form" onSubmit={submitReject}>
            <h2 id="reject-prescription-title">Reject prescription</h2>
            <p className="muted">
              {rejecting.user ? rejecting.user.name || rejecting.user.email : 'Customer'} ·{' '}
              {rejecting.originalName}
            </p>

            <div className="field">
              <label htmlFor="reject-reason">Reason shown to the customer</label>
              <textarea
                id="reject-reason"
                rows={3}
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. The scan is unreadable; please upload a clearer photo."
                required
              />
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setRejecting(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busyId === rejecting.id || !reason.trim()}
              >
                {busyId === rejecting.id ? 'Rejecting…' : 'Reject prescription'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
