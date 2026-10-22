import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import OrderSummary from '../components/OrderSummary.jsx';
import { ordersApi } from '../lib/api.js';
import {
  formatCurrency,
  formatDate,
  orderStatusLabel,
  PAYMENT_STATUS_LABELS,
} from '../lib/format.js';

const METHOD_LABELS = {
  card: 'Card',
  upi: 'UPI',
  cod: 'Cash on delivery',
};

export default function OrderConfirmation() {
  const { id } = useParams();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await ordersApi.get(id);
      setOrder(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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

  const paid = order.status === 'paid';
  const processing = order.status === 'processing';
  const pending = order.status === 'pending_payment';

  return (
    <main className="page">
      <div className={`status-banner status-${order.status}`}>
        <p className="status-banner-icon" aria-hidden="true">
          {paid || processing ? '✓' : pending ? '!' : '×'}
        </p>
        <h1>
          {paid
            ? 'Payment successful'
            : processing
              ? 'Order confirmed'
              : pending
                ? 'Payment pending'
                : orderStatusLabel(order.status)}
        </h1>
        <p>
          Order <strong>{order.orderNumber}</strong> ·{' '}
          {formatDate(order.created_at, { withTime: true })}
        </p>
        <p className="status-banner-total">{formatCurrency(order.totals.total)}</p>

        {processing && <p>Please keep the amount ready for cash on delivery.</p>}
        {pending && <p>Complete the payment to confirm your order.</p>}

        {pending && (
          <Link to={`/orders/${order.id}/payment`} className="btn btn-primary">
            Complete payment
          </Link>
        )}
      </div>

      <div className="checkout-grid">
        <section className="panel">
          <h2>Shipping to</h2>
          <address className="address-block">
            <strong>{order.shippingAddress.fullName}</strong>
            <br />
            {order.shippingAddress.line1}
            <br />
            {order.shippingAddress.line2 && (
              <>
                {order.shippingAddress.line2}
                <br />
              </>
            )}
            {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
            {order.shippingAddress.pincode}
            <br />
            {order.shippingAddress.phone}
            <br />
            {order.shippingAddress.email}
          </address>

          <h2>Payment</h2>
          <p>
            <strong>
              {order.payment.method ? METHOD_LABELS[order.payment.method] : 'Not chosen yet'}
            </strong>
            {order.payment.status
              ? ` · ${PAYMENT_STATUS_LABELS[order.payment.status] || order.payment.status}`
              : ''}
          </p>
          {order.payment.last4 && order.payment.method === 'card' && (
            <p className="muted">
              {order.payment.brand} ending in {order.payment.last4}
            </p>
          )}
          {order.payment.transactionId && (
            <p className="muted">Transaction: {order.payment.transactionId}</p>
          )}
          {order.payment.failureReason && (
            <p className="warning">{order.payment.failureReason}</p>
          )}

          <h2>Delivery</h2>
          <p>
            {processing
              ? 'Cash on delivery · usually 3–5 business days'
              : 'Usually 3–5 business days after payment'}
          </p>

          <div className="modal-actions">
            <Link to="/orders" className="btn btn-secondary">
              My orders
            </Link>
            <Link to="/" className="btn btn-primary">
              Continue shopping
            </Link>
          </div>
        </section>

        <OrderSummary items={order.items} totals={order.totals} title="Your order" />
      </div>
    </main>
  );
}
