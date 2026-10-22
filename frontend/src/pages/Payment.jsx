import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import OrderSummary from '../components/OrderSummary.jsx';
import { ordersApi } from '../lib/api.js';
import {
  formatCurrency,
  minutesLeft,
  orderStatusLabel,
  PAYMENT_STATUS_LABELS,
} from '../lib/format.js';

const METHODS = [
  { id: 'card', label: 'Card', hint: 'Visa / Mastercard sandbox' },
  { id: 'upi', label: 'UPI', hint: 'Pay with a UPI ID' },
  { id: 'cod', label: 'Cash on delivery', hint: 'Pay when it arrives' },
];

export default function Payment() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [method, setMethod] = useState('card');
  const [card, setCard] = useState({ name: '', number: '', expiry: '', cvv: '' });
  const [vpa, setVpa] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await ordersApi.get(id);
      setOrder(data);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCardNumber = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 19);
    const grouped = digits.replace(/(.{4})/g, '$1 ').trim();
    setCard((prev) => ({ ...prev, number: grouped }));
  };

  const handleExpiry = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    const formatted = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    setCard((prev) => ({ ...prev, expiry: formatted }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (method === 'card') {
      const digits = card.number.replace(/\s/g, '');
      if (digits.length < 12) {
        setError('Enter a valid card number.');
        return;
      }
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(card.expiry)) {
        setError('Expiry must be in MM/YY format.');
        return;
      }
      if (!/^\d{3,4}$/.test(card.cvv)) {
        setError('Enter a valid CVV.');
        return;
      }
    }

    if (method === 'upi' && !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(vpa.trim())) {
      setError('Enter a valid UPI ID, for example name@bank.');
      return;
    }

    setSubmitting(true);
    try {
      const details =
        method === 'card'
          ? { number: card.number.replace(/\s/g, ''), expiry: card.expiry, cvv: card.cvv }
          : method === 'upi'
            ? { vpa: vpa.trim() }
            : {};

      const result = await ordersApi.pay(id, { method, details });

      // A real gateway can ask the browser to continue on its own page.
      if (result && result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }

      navigate(`/orders/${id}/confirmation`, { replace: true });
    } catch (err) {
      setError(err.message);
      // The decline response includes the updated order; otherwise refresh.
      if (err.data && err.data.order) {
        setOrder(err.data.order);
      } else {
        load();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this order? The reserved stock will be released.')) return;

    setSubmitting(true);
    setError('');
    try {
      const cancelled = await ordersApi.cancel(id);
      setOrder(cancelled);
      setNotice('Order cancelled. The reserved stock has been released.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="page">
        <p className="empty">Loading your order…</p>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Order unavailable</h1>
          <p>{error || 'This order could not be loaded.'}</p>
        </div>
        <div className="empty-card">
          <Link to="/orders" className="btn btn-primary">
            My orders
          </Link>
        </div>
      </main>
    );
  }

  const payable = order.status === 'pending_payment';
  const reservedFor = minutesLeft(order.expiresAt);
  const isCod = method === 'cod';

  return (
    <main className="page">
      <div className="page-header">
        <h1>Payment</h1>
        <p>
          Order <strong>{order.orderNumber}</strong> · {formatCurrency(order.totals.total)}
        </p>
      </div>

      {notice && <p className="notice notice-info">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="checkout-grid">
        <section className="form-card payment-card">
          {!payable ? (
            <div className="payment-status">
              <h2>{orderStatusLabel(order.status)}</h2>
              <p>
                {order.status === 'paid'
                  ? 'This order has already been paid.'
                  : order.status === 'processing'
                    ? 'Your order is confirmed. Pay in cash when it is delivered.'
                    : order.status === 'cancelled'
                      ? 'This order was cancelled and its stock released.'
                      : 'This order expired before payment and its stock was released.'}
              </p>
              <p className="muted">
                Payment status:{' '}
                {PAYMENT_STATUS_LABELS[order.payment.status] || order.payment.status}
              </p>

              <div className="modal-actions">
                {(order.status === 'paid' || order.status === 'processing') && (
                  <Link className="btn btn-primary" to={`/orders/${order.id}/confirmation`}>
                    View receipt
                  </Link>
                )}
                <Link className="btn btn-secondary" to="/orders">
                  My orders
                </Link>
                <Link className="btn btn-ghost" to="/">
                  Continue shopping
                </Link>
              </div>
            </div>
          ) : (
            <>
              {order.expiresAt && reservedFor > 0 && (
                <p className="notice notice-warn">
                  Stock is reserved for about {reservedFor} more minute
                  {reservedFor === 1 ? '' : 's'}.
                </p>
              )}

              <div className="payment-methods" role="tablist" aria-label="Payment method">
                {METHODS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={method === option.id}
                    className={`method-tab${method === option.id ? ' active' : ''}`}
                    onClick={() => {
                      setMethod(option.id);
                      setError('');
                      setNotice('');
                    }}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.hint}</span>
                  </button>
                ))}
              </div>

              <form className="medicine-form" onSubmit={handleSubmit}>
                {method === 'card' && (
                  <>
                    <div className="field">
                      <label htmlFor="cardName">Name on card</label>
                      <input
                        id="cardName"
                        type="text"
                        value={card.name}
                        onChange={(e) => setCard((prev) => ({ ...prev, name: e.target.value }))}
                        autoComplete="cc-name"
                        placeholder="Ada Sharma"
                        required
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="cardNumber">Card number</label>
                      <input
                        id="cardNumber"
                        type="text"
                        inputMode="numeric"
                        value={card.number}
                        onChange={(e) => handleCardNumber(e.target.value)}
                        autoComplete="cc-number"
                        placeholder="4242 4242 4242 4242"
                        required
                      />
                    </div>

                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="expiry">Expiry (MM/YY)</label>
                        <input
                          id="expiry"
                          type="text"
                          inputMode="numeric"
                          value={card.expiry}
                          onChange={(e) => handleExpiry(e.target.value)}
                          autoComplete="cc-exp"
                          placeholder="12/30"
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="cvv">CVV</label>
                        <input
                          id="cvv"
                          type="password"
                          inputMode="numeric"
                          value={card.cvv}
                          onChange={(e) =>
                            setCard((prev) => ({
                              ...prev,
                              cvv: e.target.value.replace(/\D/g, '').slice(0, 4),
                            }))
                          }
                          autoComplete="cc-csc"
                          placeholder="123"
                          required
                        />
                      </div>
                    </div>
                  </>
                )}

                {method === 'upi' && (
                  <div className="field">
                    <label htmlFor="vpa">UPI ID</label>
                    <input
                      id="vpa"
                      type="text"
                      value={vpa}
                      onChange={(e) => setVpa(e.target.value)}
                      autoComplete="off"
                      placeholder="name@bank"
                      required
                    />
                  </div>
                )}

                {method === 'cod' && (
                  <div className="notice notice-info">
                    Pay <strong>{formatCurrency(order.totals.total)}</strong> in cash when the
                    order is delivered. The order is confirmed immediately and the stock stays
                    reserved for you.
                  </div>
                )}

                <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                  {submitting
                    ? 'Processing…'
                    : isCod
                      ? 'Place order (cash on delivery)'
                      : `Pay ${formatCurrency(order.totals.total)}`}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost btn-block btn-small"
                  onClick={handleCancel}
                  disabled={submitting}
                >
                  Cancel order
                </button>
              </form>

              <p className="sandbox-note">
                Sandbox gateway — no real money moves. Use <strong>4242 4242 4242 4242</strong>{' '}
                with any future expiry and CVV to succeed; a card ending in <strong>0002</strong>{' '}
                is declined.
              </p>
            </>
          )}
        </section>

        <OrderSummary items={order.items} totals={order.totals} title="Order summary">
          <div className="summary-address">
            <p className="summary-note">Deliver to</p>
            <p>{order.shippingAddress.fullName}</p>
            <p>
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}
            </p>
            <p>
              {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
              {order.shippingAddress.pincode}
            </p>
            <p>{order.shippingAddress.phone}</p>
          </div>
        </OrderSummary>
      </div>
    </main>
  );
}

