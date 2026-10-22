import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QuantityStepper from '../components/QuantityStepper.jsx';
import OrderSummary from '../components/OrderSummary.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { formatCurrency } from '../lib/format.js';

export default function Cart() {
  const { items, totals, itemCount, hasIssues, loading, updateQuantity, removeItem, clearCart } =
    useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const run = async (id, action) => {
    setBusyId(id);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const changeQuantity = (item, quantity) =>
    run(item.medicineId, () => updateQuantity(item.medicineId, quantity));

  const remove = (item) => run(item.medicineId, () => removeItem(item.medicineId));

  const goToCheckout = () => {
    if (user) {
      navigate('/checkout');
    } else {
      navigate('/login', { state: { from: '/checkout' } });
    }
  };

  if (loading) {
    return (
      <main className="page">
        <p className="empty">Loading your cart…</p>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Your cart is empty</h1>
          <p>Add a medicine from the stock list to get started.</p>
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
        <h1>Your cart</h1>
        <p>
          {itemCount} item{itemCount === 1 ? '' : 's'} ready for checkout
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="cart-layout">
        <section className="cart-list">
          {items.map((item) => (
            <article
              className={`cart-row${item.issue ? ' unavailable' : ''}`}
              key={item.medicineId}
            >
              {item.image ? (
                <img
                  className="cart-thumb"
                  src={`/uploads/${item.image}`}
                  alt={item.name}
                />
              ) : (
                <div className="cart-thumb placeholder">💊</div>
              )}

              <div className="cart-row-main">
                <div className="cart-row-head">
                  <h3>{item.name}</h3>
                  <span className="cart-row-price">{formatCurrency(item.price)} each</span>
                </div>

                {item.issue && <p className="warning">{item.issue}</p>}

                <div className="cart-row-actions">
                  <QuantityStepper
                    value={item.quantity}
                    min={1}
                    max={Math.max(1, Math.min(item.stock, 99))}
                    disabled={busyId === item.medicineId || item.stock < 1}
                    onChange={(quantity) => changeQuantity(item, quantity)}
                    label={`Quantity for ${item.name}`}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => remove(item)}
                    disabled={busyId === item.medicineId}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="cart-row-total">{formatCurrency(item.lineTotal)}</div>
            </article>
          ))}

          <div className="cart-foot">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => run('all', clearCart)}
              disabled={busyId === 'all'}
            >
              Clear cart
            </button>
            <Link to="/" className="btn btn-ghost btn-small">
              Continue shopping
            </Link>
          </div>
        </section>

        <OrderSummary items={items} totals={totals} title="Summary">
          {hasIssues && (
            <p className="warning">
              Fix or remove the highlighted items before checking out.
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={goToCheckout}
            disabled={hasIssues || itemCount === 0}
          >
            Proceed to checkout
          </button>
          {!user && (
            <p className="summary-note">You will be asked to sign in. Your cart is kept.</p>
          )}
        </OrderSummary>
      </div>
    </main>
  );
}
