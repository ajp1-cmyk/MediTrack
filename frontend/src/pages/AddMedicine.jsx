import { useState } from 'react';
import { Link } from 'react-router-dom';
import MedicineForm from '../components/MedicineForm.jsx';

export default function AddMedicine() {
  const [lastAdded, setLastAdded] = useState(null);

  return (
    <main className="page">
      <div className="page-header">
        <h1>Add Medicine</h1>
        <p>
          Fill in the details below to add a new medicine to your stock.
          This page is only available to administrators.
        </p>
      </div>

      <div className="form-card">
        <MedicineForm onCreated={setLastAdded} />
      </div>

      {lastAdded && (
        <div className="success-card">
          <p>
            ✅ Added <strong>{lastAdded.name}</strong> to stock successfully!
          </p>
          <div className="success-actions">
            <Link to="/" className="btn btn-secondary">
              View stock
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setLastAdded(null)}
            >
              Add another
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
