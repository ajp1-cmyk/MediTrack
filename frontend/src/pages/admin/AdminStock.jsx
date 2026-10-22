import { useCallback, useEffect, useState } from 'react';
import MedicineForm from '../../components/MedicineForm.jsx';
import { adminApi } from '../../lib/api.js';
import { formatCurrency } from '../../lib/format.js';

function StockEditor({ medicine, onSave }) {
  const [value, setValue] = useState(medicine.stock);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(medicine.stock);
  }, [medicine.stock]);

  const changed = Number(value) !== medicine.stock;

  return (
    <div className="inline-stock">
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        aria-label={`Stock for ${medicine.name}`}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-small btn-secondary"
        disabled={!changed || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(Number(value));
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? '…' : 'Save'}
      </button>
    </div>
  );
}

export default function AdminStock() {
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      setMedicines(await adminApi.medicines());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateStock = async (medicine, stock) => {
    try {
      setError('');
      const updated = await adminApi.updateMedicine(medicine.id, { stock });
      setMedicines((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setNotice(`Stock for ${updated.name} set to ${updated.stock}.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (medicine) => {
    if (!window.confirm(`Delete ${medicine.name} from stock?`)) return;
    try {
      setError('');
      await adminApi.deleteMedicine(medicine.id);
      setMedicines((prev) => prev.filter((row) => row.id !== medicine.id));
      setNotice(`${medicine.name} removed.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const filtered = medicines.filter((medicine) =>
    medicine.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h1>Stock</h1>
          <p className="muted">Add medicines, adjust quantities and remove items.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowForm((open) => !open)}
        >
          {showForm ? 'Close form' : '+ Add medicine'}
        </button>
      </div>

      {showForm && (
        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>New medicine</h2>
          </div>
          <MedicineForm
            onCreated={(created) => {
              setMedicines((prev) => [created, ...prev]);
              setShowForm(false);
              setNotice(`${created.name} added to stock.`);
            }}
          />
        </section>
      )}

      <div className="toolbar">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by medicine name…"
          aria-label="Search stock"
        />
        <span className="muted">{filtered.length} item(s)</span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="success-line">{notice}</p>}

      {loading ? (
        <p className="empty">Loading stock…</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>MFD</th>
                <th>EXP</th>
                <th>Price</th>
                <th>Stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((medicine) => {
                const today = new Date().toISOString().slice(0, 10);
                const expired = medicine.exp < today;
                const low = medicine.stock <= 10;

                return (
                  <tr key={medicine.id}>
                    <td>
                      <div className="table-product">
                        {medicine.image ? (
                          <img src={`/uploads/${medicine.image}`} alt="" />
                        ) : (
                          <span className="table-product-placeholder">💊</span>
                        )}
                        <div>
                          <strong>{medicine.name}</strong>
                          <div className="badge-row">
                            {expired && <span className="badge badge-red">Expired</span>}
                            {!expired && low && (
                              <span className="badge badge-amber">Low stock</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{medicine.mfd}</td>
                    <td>{medicine.exp}</td>
                    <td>{formatCurrency(medicine.price)}</td>
                    <td>
                      <StockEditor
                        medicine={medicine}
                        onSave={(stock) => updateStock(medicine, stock)}
                      />
                    </td>
                    <td className="table-actions">
                      <button
                        type="button"
                        className="btn btn-small btn-ghost danger"
                        onClick={() => remove(medicine)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

