import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ordersApi } from '../lib/api.js';
import { formatCurrency, formatDate, orderStatusLabel } from '../lib/format.js';

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await ordersApi.list();
      setOrders(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <main className="page">
        <p className="empty">Loading your orders…</p>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1>Your orders</h1>
        <p>Track payments and review past orders.</p>
      </div>

      {error && <p className="error">{error}</p>}

      {orders.length === 0 ? (
        <div className="empty-card">
          <p className="empty">You have not placed any orders yet.</p>
          <Link to="/" className="btn btn-primary">
            Browse medicines
          </Link>
        </div>
      ) : (
        <div className="order-list">
          {orders.map((order) => (
            <article className="order-card" key={order.id}>
              <div className="order-head">
                <div>
                  <h3>{order.orderNumber}</h3>
                  <p className="muted">
                    {formatDate(order.created_at, { withTime: true })} ·{' '}
                    {order.totals.itemCount} item{order.totals.itemCount === 1 ? '' : 's'}
                  </p>
                </div>
                <span className={`status-chip status-${order.status}`}>
                  {orderStatusLabel(order.status)}
                </span>
              </div>

              <div className="order-foot">
                <strong>{formatCurrency(order.totals.total)}</strong>
                <div className="order-actions">
                  {order.status === 'pending_payment' && (
                    <Link
                      to={`/orders/${order.id}/payment`}
                      className="btn btn-primary btn-small"
                    >
                      Pay now
                    </Link>
                  )}
                  <Link
                    to={`/orders/${order.id}/confirmation`}
                    className="btn btn-secondary btn-small"
                  >
                    View details
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
