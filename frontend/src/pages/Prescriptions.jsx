import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { prescriptionsApi, saveBlob } from '../lib/api.js';
import { formatDate, prescriptionStatusLabel } from '../lib/format.js';

const ACCEPT = 'image/jpeg,image/png,application/pdf';
const MAX_BYTES = 5 * 1024 * 1024;

/** Customer prescription upload + status page (FR-1.4 / FR-2.1). */
export default function Prescriptions() {
  const [data, setData] = useState({ prescriptions: [], state: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await prescriptionsApi.list());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pick = (event) => {
    setError('');
    setNotice('');

    const selected = event.target.files && event.target.files[0];
    if (!selected) {
      setFile(null);
      return;
    }
    if (!ACCEPT.split(',').includes(selected.type)) {
      setError('Choose a JPG, PNG or PDF file.');
      event.target.value = '';
      setFile(null);
      return;
    }
    if (selected.size > MAX_BYTES) {
      setError('Prescription files cannot be larger than 5 MB.');
      event.target.value = '';
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const upload = async (event) => {
    event.preventDefault();
    if (!file) {
      setError('Choose a file first.');
      return;
    }

    setUploading(true);
    setError('');
    setNotice('');
    try {
      await prescriptionsApi.upload(file);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      setNotice('Prescription uploaded. Staff will verify it shortly.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const download = async (prescription) => {
    setBusyId(prescription.id);
    setError('');
    try {
      const blob = await prescriptionsApi.file(prescription.id);
      saveBlob(blob, prescription.originalName || `prescription-${prescription.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <main className="page">
        <p className="empty">Loading your prescriptions…</p>
      </main>
    );
  }

  const state = data.state || { status: 'none' };
  const pending = state.status === 'pending';

  return (
    <main className="page">
      <div className="page-header">
        <h1>My prescriptions</h1>
        <p>
          Upload a prescription once and reuse it while it is valid. Prescription-only medicines
          stay locked at checkout until a pharmacist verifies it.
        </p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice notice-info">{notice}</p>}

      <div className="prescription-grid">
        <section className="form-card">
          <h2>Upload a prescription</h2>
          <p className="muted">
            JPG, PNG or PDF up to 5 MB. The file is encrypted at rest and can only be opened by
            you and a pharmacist.
          </p>

          {pending ? (
            <p className="notice notice-warn">
              You already have an upload waiting for verification. You can add another one once
              it has been reviewed.
            </p>
          ) : (
            <form className="prescription-form" onSubmit={upload}>
              <div className="field">
                <label htmlFor="prescription-file">Prescription file</label>
                <input
                  id="prescription-file"
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  onChange={pick}
                />
              </div>
              {file && (
                <p className="muted">
                  {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB
                </p>
              )}
              <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
                {uploading ? 'Uploading…' : 'Upload prescription'}
              </button>
            </form>
          )}
        </section>

        <aside className="summary-card prescription-state">
          <h3>Current status</h3>
          <p>
            <span className={`status-chip status-${state.status}`}>
              {prescriptionStatusLabel(state.status)}
            </span>
          </p>
          {state.status === 'verified' && (
            <p className="muted">Valid until {formatDate(state.validUntil)}.</p>
          )}
          {state.status === 'pending' && (
            <p className="muted">
              Uploaded {formatDate(state.uploadedAt, { withTime: true })}. Staff review usually
              happens within one working day.
            </p>
          )}
          {state.status === 'rejected' && (
            <p className="warning">{state.rejectionReason || 'The upload could not be verified.'}</p>
          )}
          {state.status === 'expired' && (
            <p className="muted">
              Expired on {formatDate(state.validUntil)}. Upload a fresh prescription to order
              prescription-only medicines.
            </p>
          )}
          {state.status === 'none' && (
            <p className="muted">
              Nothing on file yet. Prescription-only medicines stay locked at checkout until an
              upload is verified.
            </p>
          )}
          <Link to="/cart" className="btn btn-ghost btn-block btn-small">
            Back to cart
          </Link>
        </aside>
      </div>

      <section className="prescription-history">
        <h2>Upload history</h2>
        {data.prescriptions.length === 0 ? (
          <p className="empty">No uploads yet.</p>
        ) : (
          <ul className="prescription-list">
            {data.prescriptions.map((prescription) => (
              <li className="prescription-row" key={prescription.id}>
                <div className="prescription-row-main">
                  <strong>{prescription.originalName}</strong>
                  <p className="muted">
                    Uploaded {formatDate(prescription.created_at, { withTime: true })} ·{' '}
                    {Math.max(1, Math.round(prescription.sizeBytes / 1024))} KB
                  </p>
                  {prescription.rejectionReason && (
                    <p className="warning">{prescription.rejectionReason}</p>
                  )}
                </div>
                <span className={`status-chip status-${prescription.status}`}>
                  {prescriptionStatusLabel(prescription.status)}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => download(prescription)}
                  disabled={busyId === prescription.id}
                >
                  {busyId === prescription.id ? 'Preparing…' : 'Download'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
