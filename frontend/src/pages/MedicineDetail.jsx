import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useWishlist } from '../context/WishlistContext.jsx';
import { medicinesApi } from '../lib/api.js';
import { formatCurrency, formatDate } from '../lib/format.js';

/** Public product page: full details, add to cart and save for later. */
export default function MedicineDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openAddDialog } = useCart();
  const { isSaved, add, remove } = useWishlist();

  const [medicine, setMedicine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [wishlistBusy, setWishlistBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      setNotFound(false);
      try {
        const data = await medicinesApi.get(id);
        if (!cancelled) setMedicine(data);
      } catch (err) {
        if (!cancelled) {
          if (err.status === 404) setNotFound(true);
          else setError(err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const toggleWishlist = async () => {
    if (!user) {
      navigate('/login', { state: { from: `/medicines/${id}` } });
      return;
    }

    setWishlistBusy(true);
    setError('');
    setNotice('');
    try {
      if (isSaved(medicine.id)) {
        await remove(medicine.id);
        setNotice('Removed from your wishlist.');
      } else {
        await add(medicine.id);
        setNotice('Saved to your wishlist.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setWishlistBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="page">
        <p className="empty">Loading medicine…</p>
      </main>
    );
  }

  if (notFound || !medicine) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Medicine not found</h1>
          <p>{notFound ? 'This product may have been removed from the catalogue.' : error}</p>
        </div>
        <div className="empty-card">
          <Link to="/" className="btn btn-primary">
            Browse medicines
          </Link>
        </div>
      </main>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const expired = Boolean(medicine.exp && medicine.exp < today);
  const soldOut = medicine.stock <= 0;
  const saved = isSaved(medicine.id);
  const stockLabel = expired
    ? 'Expired'
    : soldOut
      ? 'Out of stock'
      : medicine.stock <= 10
        ? `Only ${medicine.stock} left`
        : 'In stock';
  const stockTone = expired || soldOut ? 'badge-red' : medicine.stock <= 10 ? 'badge-amber' : 'badge-blue';

  return (
    <main className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Medicines</Link>
        <span aria-hidden="true">›</span>
        {medicine.category ? (
          <Link to={`/?category=${encodeURIComponent(medicine.category)}`}>
            {medicine.category}
          </Link>
        ) : (
          <span>Uncategorised</span>
        )}
        <span aria-hidden="true">›</span>
        <span aria-current="page">{medicine.name}</span>
      </nav>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice notice-info">{notice}</p>}

      <article className="medicine-detail">
        <div className="medicine-detail-media">
          {medicine.image ? (
            <img src={`/uploads/${medicine.image}`} alt={medicine.name} />
          ) : (
            <div className="medicine-detail-placeholder">💊</div>
          )}
        </div>

        <div className="medicine-detail-info">
          <div className="badge-row">
            {medicine.category && <span className="badge badge-gray">{medicine.category}</span>}
            {medicine.prescriptionRequired ? (
              <span className="badge badge-blue">Prescription required</span>
            ) : (
              <span className="badge badge-gray">Over the counter</span>
            )}
            <span className={`badge ${stockTone}`}>{stockLabel}</span>
          </div>

          <h1>{medicine.name}</h1>

          {medicine.description && (
            <p className="medicine-detail-description">{medicine.description}</p>
          )}

          <p className="medicine-detail-price">{formatCurrency(medicine.price)}</p>

          <dl className="medicine-detail-meta">
            <div>
              <dt>Manufactured</dt>
              <dd>{formatDate(medicine.mfd)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd className={expired ? 'danger' : undefined}>{formatDate(medicine.exp)}</dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>
                {medicine.stock} unit{medicine.stock === 1 ? '' : 's'}
              </dd>
            </div>
            <div>
              <dt>One pack lasts</dt>
              <dd>about {medicine.refillDays || 30} days</dd>
            </div>
          </dl>

          {medicine.prescriptionRequired && (
            <p className="notice notice-warn">
              This medicine is prescription-only. Checkout needs a verified prescription on
              file — <Link to="/prescriptions">upload or check yours</Link> before ordering.
            </p>
          )}

          <div className="medicine-detail-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openAddDialog(medicine)}
              disabled={expired || soldOut}
            >
              {expired ? 'Expired' : soldOut ? 'Out of stock' : 'Add to cart'}
            </button>
            <button
              type="button"
              className={`btn btn-ghost${saved ? ' saved' : ''}`}
              onClick={toggleWishlist}
              disabled={wishlistBusy}
              aria-pressed={saved}
            >
              {saved ? '♥ Saved' : '♡ Save for later'}
            </button>
            <Link to="/cart" className="btn btn-ghost">
              View cart
            </Link>
          </div>

          <p className="summary-note">
            Stock and prices are read live from the pharmacy catalogue. Delivery and GST are
            calculated at checkout.
          </p>
        </div>
      </article>
    </main>
  );
}
