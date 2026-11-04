import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useWishlist } from '../context/WishlistContext.jsx';
import { formatCurrency } from '../lib/format.js';
import Icon from './Icon.jsx';
import { assetUrl } from '../lib/config.js';

/** Loading placeholder that matches the real card geometry. */
export function MedicineGridSkeleton({ count = 8 }) {
  return (
    <div className="product-grid" role="status" aria-live="polite">
      <span className="sr-only">Loading medicines…</span>
      {Array.from({ length: count }).map((_, index) => (
        <div className="product-card product-card-skeleton" key={index} aria-hidden="true">
          <div className="product-media skeleton-media" />
          <div className="product-body">
            <span className="skeleton-line skeleton-w40" />
            <span className="skeleton-line skeleton-w80" />
            <span className="skeleton-line skeleton-w60" />
            <span className="skeleton-line skeleton-w30" />
            <span className="skeleton-block" />
          </div>
        </div>
      ))}
    </div>
  );
}

function stockState(medicine, expired) {
  if (expired) return { key: 'expired', label: 'Expired' };
  if (medicine.stock <= 0) return { key: 'out', label: 'Out of stock' };
  if (medicine.stock <= 10) return { key: 'low', label: `Only ${medicine.stock} left` };
  return { key: 'in', label: 'In stock' };
}

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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="product-grid">
        {medicines.map((medicine) => {
          const expired = Boolean(medicine.exp && medicine.exp < today);
          const soldOut = medicine.stock <= 0;
          const status = stockState(medicine, expired);
          const saved = isSaved(medicine.id);

          return (
            <article className="product-card" key={medicine.id}>
              <div className="product-media">
                <Link
                  to={`/medicines/${medicine.id}`}
                  className="product-media-link"
                  aria-label={`View details for ${medicine.name}`}
                >
                  {medicine.image ? (
                    <img
                      src={assetUrl(`/uploads/${medicine.image}`)}
                      alt={medicine.name}
                      className="product-image"
                      loading="lazy"
                    />
                  ) : (
                    <span className="product-placeholder" aria-hidden="true">
                      <Icon name="pill" size={40} strokeWidth={1.4} />
                    </span>
                  )}
                </Link>

                <div className="product-flags">
                  {medicine.prescriptionRequired && <span className="flag flag-rx">Rx</span>}
                  {expired && <span className="flag flag-danger">Expired</span>}
                  {!expired && soldOut && <span className="flag flag-muted">Out of stock</span>}
                </div>

                <button
                  type="button"
                  className={`wishlist-toggle${saved ? ' saved' : ''}`}
                  onClick={() => toggleWishlist(medicine)}
                  disabled={busyId === medicine.id}
                  aria-pressed={saved}
                  aria-label={
                    saved
                      ? `Remove ${medicine.name} from your wishlist`
                      : `Save ${medicine.name} to your wishlist`
                  }
                  title={user ? (saved ? 'Saved to wishlist' : 'Save for later') : 'Sign in to save'}
                >
                  {saved ? (
                    <Icon name="heart" size={18} filled strokeWidth={0} />
                  ) : (
                    <Icon name="heart" size={18} />
                  )}
                </button>
              </div>

              <div className="product-body">
                {medicine.category && <p className="product-category">{medicine.category}</p>}
                <h3 className="product-title">
                  <Link to={`/medicines/${medicine.id}`} className="product-title-link">
                    {medicine.name}
                  </Link>
                </h3>
                {medicine.description && <p className="product-desc">{medicine.description}</p>}

                <dl className="product-meta">
                  <div>
                    <dt>MFD</dt>
                    <dd>{medicine.mfd}</dd>
                  </div>
                  <div>
                    <dt>EXP</dt>
                    <dd className={expired ? 'meta-danger' : undefined}>{medicine.exp}</dd>
                  </div>
                </dl>

                <div className="product-footer">
                  <div className="product-price-row">
                    <span className="product-price">{formatCurrency(medicine.price)}</span>
                    <span className={`stock-state stock-${status.key}`}>{status.label}</span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary btn-block cart-add-btn"
                    onClick={() => openAddDialog(medicine)}
                    disabled={expired || soldOut}
                  >
                    {expired ? 'Expired' : soldOut ? 'Out of stock' : 'Add to cart'}
                  </button>

                  <Link to={`/medicines/${medicine.id}`} className="product-details-link">
                    View details <Icon name="arrow" size={16} />
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
