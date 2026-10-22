import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/api.js';
import {
  formatCurrency,
  formatDate,
  orderStatusLabel,
  ORDER_STATUS_LABELS,
} from '../../lib/format.js';

function Stat({ label, value, hint }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export default function AdminDashboard() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setSummary(await adminApi.summary());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="empty">Loading dashboard…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Live snapshot of stock, customers and orders.</p>
        </div>
        <Link to="/admin/stock" className="btn btn-primary">
          + Add stock
        </Link>
      </div>

      <div className="admin-cards">
        <Stat label="Stock items" value={summary.medicines} hint={`${summary.lowStock} low stock`} />
        <Stat label="Customers" value={summary.customers} />
        <Stat label="Orders" value={summary.orders.total} />
        <Stat label="Revenue" value={formatCurrency(summary.revenue)} hint="Paid / fulfilled" />
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Orders by status</h2>
          <Link to="/admin/orders">View orders</Link>
        </div>
        <div className="status-row">
          {Object.entries(ORDER_STATUS_LABELS).map(([status, label]) => (
            <span key={status} className={`status-chip status-${status}`}>
              {label}: {summary.orders.byStatus[status] || 0}
            </span>
          ))}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Recent orders</h2>
          <Link to="/admin/orders">View all</Link>
        </div>

        {summary.recentOrders.length === 0 ? (
          <p className="empty">No orders yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link to="/admin/orders">{order.orderNumber}</Link>
                    </td>
                    <td>{order.user ? order.user.name || order.user.email : '—'}</td>
                    <td>{formatDate(order.created_at, { withTime: true })}</td>
                    <td>{order.totals.itemCount}</td>
                    <td>{formatCurrency(order.totals.total)}</td>
                    <td>
                      <span className={`status-chip status-${order.status}`}>
                        {orderStatusLabel(order.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
