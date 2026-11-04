import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWishlist } from '../context/WishlistContext.jsx';
import { formatCurrency } from '../lib/format.js';
import { assetUrl } from '../lib/config.js';

export default function Wishlist() {
  const {
    items,
    itemCount,
    availableCount,
    hasIssues,
    loading,
    error: loadError,
    remove,
    clear,
    moveToCart,
  } = useWishlist();

  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const run = async (id, action, message) => {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await action();
      if (message) setNotice(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const move = (item) =>
    run(
      item.medicineId,
      () => moveToCart(item.medicineId),
      `“${item.name}” moved to your cart.`
    );

  const removeItem = (item) =>
    run(
      item.medicineId,
      () => remove(item.medicineId),
      `“${item.name}” removed from your wishlist.`
    );

  if (loading && items.length === 0) {
    return (
      <main className="page">
        <p className="empty">Loading your wishlist…</p>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Your wishlist is empty</h1>
          <p>Save medicines for later and move them to your cart when you need them.</p>
        </div>
        <div className="empty-card">
          <Link to="/" className="btn btn-primary">
            Browse medicines
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1>Your wishlist</h1>
        <p>
          {itemCount} saved item{itemCount === 1 ? '' : 's'} · {availableCount} ready to move
          to the cart
        </p>
      </div>

      {loadError && <p className="error">{loadError}</p>}
      {error && <p className="error">{error}</p>}
      {notice && (
        <p className="notice notice-info">
          {notice} <Link to="/cart">View cart</Link>
        </p>
      )}
      {hasIssues && (
        <p className="warning">
          Unavailable items stay on your wishlist until you remove them.
        </p>
      )}

      <section className="cart-list">
        {items.map((item) => (
          <article
            className={`cart-row${item.available ? '' : ' unavailable'}`}
            key={item.medicineId}
          >
            {item.image ? (
              <img
                className="cart-thumb"
                src={assetUrl(`/uploads/${item.image}`)}
                alt={item.name}
              />
            ) : (
              <div className="cart-thumb placeholder">💊</div>
            )}

            <div className="cart-row-main">
              <div className="cart-row-head">
                <h3>{item.name}</h3>
                {item.price > 0 && (
                  <span className="cart-row-price">{formatCurrency(item.price)} each</span>
                )}
              </div>

              <p className="muted">
                {item.available ? `${item.stock} in stock` : 'Not currently orderable'}
                {item.exp ? ` · Expires ${item.exp}` : ''}
                {item.prescriptionRequired ? ' · Prescription required' : ''}
              </p>

              {item.issue && <p className="warning">{item.issue}</p>}
            </div>

            <div className="wishlist-actions">
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => move(item)}
                disabled={busyId === item.medicineId || !item.available}
              >
                {busyId === item.medicineId ? 'Moving…' : 'Move to cart'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => removeItem(item)}
                disabled={busyId === item.medicineId}
              >
                Remove
              </button>
            </div>
          </article>
        ))}

        <div className="cart-foot">
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => run('all', clear, 'Wishlist cleared.')}
            disabled={busyId === 'all'}
          >
            Clear wishlist
          </button>
          <Link to="/" className="btn btn-ghost btn-small">
            Continue shopping
          </Link>
        </div>
      </section>
    </main>
  );
}
