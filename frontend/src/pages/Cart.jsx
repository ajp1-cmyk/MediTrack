import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QuantityStepper from '../components/QuantityStepper.jsx';
import OrderSummary from '../components/OrderSummary.jsx';
import HoldCountdown from '../components/HoldCountdown.jsx';
import PrescriptionNotice from '../components/PrescriptionNotice.jsx';
import PurchaseLimitNotice from '../components/PurchaseLimitNotice.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { formatCurrency } from '../lib/format.js';
import { assetUrl } from '../lib/config.js';

export default function Cart() {
  const {
    cart,
    items,
    totals,
    itemCount,
    hasIssues,
    loading,
    refresh,
    updateQuantity,
    removeItem,
    clearCart,
  } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // Several lines can lapse in the same second; refresh the cart only once.
  const refreshingRef = useRef(false);

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

  // FR-1.3: sending the quantity the line already has re-takes the hold, which
  // is what the "Refresh hold" action does — no separate endpoint.
  const refreshHold = (item) =>
    run(item.medicineId, () => updateQuantity(item.medicineId, item.quantity));

  const handleHoldExpired = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    refresh()
      .catch(() => {})
      .finally(() => {
        refreshingRef.current = false;
      });
  }, [refresh]);

  const goToCheckout = () => {
    if (user) {
      navigate('/checkout');
    } else {
      navigate('/login', { state: { from: '/checkout' } });
    }
  };

  // FR-1.4 / FR-2.1 / NFR-2.2: mirror the server rules so the button explains
  // itself instead of failing after the form is filled in.
  const rxBlocked = Boolean(
    cart.requiresPrescription && !(cart.prescription && cart.prescription.verified)
  );
  const overDailyLimit = Boolean(
    cart.purchaseLimit &&
      cart.purchaseLimit.enabled &&
      itemCount > (cart.purchaseLimit.remaining ?? 0)
  );
  const canCheckout = !hasIssues && itemCount > 0 && !rxBlocked && !overDailyLimit;

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

      {cart.holdExpiresAt && !cart.hasExpiredHolds && (
        <p className="notice notice-warn">
          Your items are reserved for you for another{' '}
          <HoldCountdown until={cart.holdExpiresAt} onExpire={handleHoldExpired} />. Changing the
          cart restarts the clock.
        </p>
      )}

      {cart.hasExpiredHolds && (
        <p className="notice notice-warn">
          Some items are no longer reserved. Refresh the hold to keep them while you finish
          shopping.
        </p>
      )}

      <PrescriptionNotice
        prescription={cart.prescription}
        requiresPrescription={cart.requiresPrescription}
      />
      <PurchaseLimitNotice purchaseLimit={cart.purchaseLimit} cartItemCount={itemCount} />

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
                  src={assetUrl(`/uploads/${item.image}`)}
                  alt={item.name}
                />
              ) : (
                <div className="cart-thumb placeholder">💊</div>
              )}

              <div className="cart-row-main">
                <div className="cart-row-head">
                  <h3>
                    {item.name}
                    {item.prescriptionRequired && (
                      <span className="badge badge-blue rx-badge" title="Prescription required">
                        Rx
                      </span>
                    )}
                  </h3>
                  <span className="cart-row-price">{formatCurrency(item.price)} each</span>
                </div>

                {item.issue && <p className="warning">{item.issue}</p>}

                {/* FR-1.2 / FR-1.3: an expired hold keeps the line but shows a refresh action. */}
                {item.holdActive ? (
                  <p className="cart-row-hold">
                    Reserved for you ·{' '}
                    <HoldCountdown until={item.heldUntil} onExpire={handleHoldExpired} /> left
                  </p>
                ) : (
                  item.holdExpired &&
                  !item.expired && (
                    <p className="cart-row-hold expired">
                      Hold expired — these units are available to other shoppers.{' '}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => refreshHold(item)}
                        disabled={busyId === item.medicineId}
                      >
                        Refresh hold
                      </button>
                    </p>
                  )
                )}

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
          {rxBlocked && (
            <p className="summary-note">
              A verified prescription is required for the Rx items in your cart.
            </p>
          )}
          {overDailyLimit && (
            <p className="summary-note">
              Reduce the quantity to stay within today’s purchase limit.
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={goToCheckout}
            disabled={!canCheckout}
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
