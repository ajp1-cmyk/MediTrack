import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import MedicineList from '../components/MedicineList.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../lib/api.js';

export default function Home() {
  const { user, isBackOffice } = useAuth();
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMedicines = useCallback(async () => {
    try {
      setError('');
      const data = await apiFetch('/api/medicines');
      setMedicines(data);
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
          Browse the pharmacy stock, add medicines to your cart and check out
          with home delivery — with manufacturing dates, expiry dates and prices
          always up to date.
        </p>
        {isBackOffice ? (
          <Link to="/admin" className="btn btn-lg">
            Open admin console
          </Link>
        ) : (
          <Link to={user ? '/cart' : '/login'} className="btn btn-lg">
            {user ? 'View your cart' : 'Sign in to order'}
          </Link>
        )}
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
