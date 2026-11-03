import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useWishlist } from '../context/WishlistContext.jsx';
import { formatCurrency } from '../lib/format.js';

export default function MedicineList({ medicines, emptyMessage }) {
  const { openAddDialog } = useCart();
  const { user } = useAuth();
  const { isSaved, add, remove } = useWishlist();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  const toggleWishlist = async (medicine) => {
    if (!user) {
      // The wishlist belongs to an account; send guests to sign in and return.
      navigate('/login', { state: { from: '/' } });
      return;
    }

    setBusyId(medicine.id);
    setError('');
    try {
      if (isSaved(medicine.id)) {
        await remove(medicine.id);
      } else {
        await add(medicine.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (medicines.length === 0) {
    return (
      <p className="empty">
        {emptyMessage || 'No medicines in stock yet. Please check back soon.'}
      </p>
    );
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="medicine-grid">
        {medicines.map((m) => {
          const expired = Boolean(m.exp && m.exp < today);
          const soldOut = m.stock <= 0;
          const saved = isSaved(m.id);

          return (
            <div className="medicine-card" key={m.id}>
              <button
                type="button"
                className={`wishlist-toggle${saved ? ' saved' : ''}`}
                onClick={() => toggleWishlist(m)}
                disabled={busyId === m.id}
                aria-pressed={saved}
                aria-label={
                  saved
                    ? `Remove ${m.name} from your wishlist`
                    : `Save ${m.name} to your wishlist`
                }
                title={
                  user
                    ? saved
                      ? 'Saved to wishlist'
                      : 'Save for later'
                    : 'Sign in to save'
                }
              >
                {saved ? '♥' : '♡'}
              </button>

              <Link
                to={`/medicines/${m.id}`}
                className="medicine-card-link"
                aria-label={`View details for ${m.name}`}
              >
                {m.image ? (
                  <img
                    src={`/uploads/${m.image}`}
                    alt={m.name}
                    className="medicine-image"
                  />
                ) : (
                  <div className="medicine-image placeholder">💊</div>
                )}
              </Link>
              <div className="medicine-body">
                <h3>
                  <Link to={`/medicines/${m.id}`} className="medicine-title-link">
                    {m.name}
                  </Link>
                </h3>
                {(m.category || m.prescriptionRequired) && (
                  <div className="badge-row">
                    {m.category && <span className="badge badge-gray">{m.category}</span>}
                    {m.prescriptionRequired && (
                      <span className="badge badge-blue">Rx required</span>
                    )}
                  </div>
                )}
                {m.description && <p className="medicine-description">{m.description}</p>}
                <p><span>MFD:</span> {m.mfd}</p>
                <p><span>EXP:</span> {m.exp}</p>
                <p><span>Price:</span> {formatCurrency(m.price)}</p>
                <p><span>Stock:</span> {m.stock} units</p>

                <Link to={`/medicines/${m.id}`} className="medicine-details-link">
                  View details <span aria-hidden="true">→</span>
                </Link>

                <button
                  type="button"
                  className="btn btn-primary btn-block cart-add-btn"
                  onClick={() => openAddDialog(m)}
                  disabled={expired || soldOut}
                >
                  {expired ? 'Expired' : soldOut ? 'Out of stock' : 'Add to cart'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

