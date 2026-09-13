import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import MedicineList from '../components/MedicineList.jsx';

export default function Home() {
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMedicines = useCallback(async () => {
    try {
      setError('');
      const res = await fetch('/api/medicines');
      if (!res.ok) throw new Error('Failed to fetch medicines');
      setMedicines(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMedicines();
  }, [fetchMedicines]);

  return (
    <main className="page">
      <section className="hero">
        <div className="hero-logo">💊</div>
        <h1>Welcome to MediTrack</h1>
        <p>
          Track your medicine stock — manufacturing dates, expiry dates, prices
          and quantities, all in one place.
        </p>
        <Link to="/add" className="btn btn-lg">
          + Add Medicine
        </Link>
      </section>

      <section>
        <div className="section-head">
          <h2>Medicine Stock</h2>
          {!loading && (
            <span className="count">
              {medicines.length} item{medicines.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="empty">Loading…</p>
        ) : (
          <MedicineList medicines={medicines} />
        )}
      </section>
    </main>
  );
}
