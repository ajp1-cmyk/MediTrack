import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import OrderSummary from '../components/OrderSummary.jsx';
import { accountApi, ordersApi } from '../lib/api.js';
import { bankLabel } from '../lib/banks.js';
import {
  formatCurrency,
  formatDate,
  orderStatusLabel,
  PAYMENT_STATUS_LABELS,
} from '../lib/format.js';

const METHOD_LABELS = {
  card: 'Card',
  upi: 'UPI',
  netbanking: 'Net banking',
  cod: 'Cash on delivery',
};

// The API stores the card network in lower case (`visa`, `mastercard`, `card`).
const CARD_BRANDS = { visa: 'Visa', mastercard: 'Mastercard' };

export default function OrderConfirmation() {
  const { id } = useParams();

  const [order, setOrder] = useState(null);
  // MediPoints summary for this customer (null while loading / when signed out).
  const [points, setPoints] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const [orderData, pointsData] = await Promise.all([
        ordersApi.get(id),
        // Points are a nice-to-have here: never fail the receipt because of them.
        accountApi.medipoints().catch(() => null),
      ]);
      setOrder(orderData);
      setPoints(pointsData);
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

  // The ledger entry for this order (only exists once the payment succeeded).
  const pointsForOrder =
    points && points.entries ? points.entries.find((entry) => entry.order === order.id) : null;

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
              {CARD_BRANDS[order.payment.brand] || 'Card'} ending in {order.payment.last4}
            </p>
          )}
          {order.payment.method === 'netbanking' && order.payment.brand && (
            <p className="muted">Paid through {bankLabel(order.payment.brand)} net banking</p>
          )}
          {order.payment.transactionId && (
            <p className="muted">Transaction: {order.payment.transactionId}</p>
          )}
          {order.payment.failureReason && (
            <p className="warning">{order.payment.failureReason}</p>
          )}

          {points && (
            <>
              <h2>MediPoints</h2>
              {pointsForOrder ? (
                <p>
                  You earned <strong>{pointsForOrder.points}</strong> MediPoint
                  {pointsForOrder.points === 1 ? '' : 's'} on this order.
                </p>
              ) : (
                <p className="muted">
                  Points are credited as soon as the payment is confirmed. Cash on delivery
                  earns them once the order is paid.
                </p>
              )}
              <p className="muted">
                Balance: {points.balance} point{points.balance === 1 ? '' : 's'} ·{' '}
                {points.pointsPer100} point{points.pointsPer100 === 1 ? '' : 's'} per ₹100 spent
              </p>
            </>
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
