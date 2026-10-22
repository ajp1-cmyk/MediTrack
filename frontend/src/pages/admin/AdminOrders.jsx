import { useCallback, useEffect, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import { adminApi } from '../../lib/api.js';
import {
  formatCurrency,
  formatDate,
  orderStatusLabel,
  ORDER_STATUS_LABELS,
} from '../../lib/format.js';

const NEXT_STATUSES = {
  pending_payment: ['cancelled'],
  paid: ['processing'],
  processing: ['shipped'],
  shipped: ['delivered'],
};

const ACTION_LABELS = {
  processing: 'Start processing',
  shipped: 'Mark shipped',
  delivered: 'Mark delivered',
  cancelled: 'Cancel order',
};

export default function AdminOrders() {
  const [data, setData] = useState({ orders: [], total: 0, page: 1, pages: 1 });
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      setError('');
      setLoading(true);
      setData(await adminApi.orders({ status, q, page, limit: 20 }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status, q, page]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (order, next) => {
    setBusyId(order.id);
    try {
      setError('');
      await adminApi.updateOrderStatus(order.id, next);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const openDetail = async (order) => {
    try {
      setError('');
      setSelected(await adminApi.order(order.id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h1>Orders</h1>
          <p className="muted">Fulfil orders and keep customers up to date.</p>
        </div>
      </div>

      <div className="toolbar toolbar-wrap">
        <select
          value={status}
          aria-label="Filter by status"
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search);
            setPage(1);
          }}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order number or customer email…"
            aria-label="Search orders"
          />
          <button type="submit" className="btn btn-secondary btn-small">
            Search
          </button>
        </form>

        <span className="muted">{data.total} order(s)</span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="empty">Loading orders…</p>
      ) : data.orders.length === 0 ? (
        <p className="empty">No orders match those filters.</p>
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <button type="button" className="link-button" onClick={() => openDetail(order)}>
                      {order.orderNumber}
                    </button>
                  </td>
                  <td>
                    {order.user ? order.user.name || order.user.email : '—'}
                    {order.user && <small className="table-sub">{order.user.email}</small>}
                  </td>
                  <td>{formatDate(order.created_at, { withTime: true })}</td>
                  <td>{order.totals.itemCount}</td>
                  <td>{formatCurrency(order.totals.total)}</td>
                  <td>
                    <span className={`status-chip status-${order.status}`}>
                      {orderStatusLabel(order.status)}
                    </span>
                  </td>
                  <td className="table-actions">
                    {(NEXT_STATUSES[order.status] || []).map((next) => (
                      <button
                        key={next}
                        type="button"
                        className="btn btn-small btn-secondary"
                        disabled={busyId === order.id}
                        onClick={() => changeStatus(order, next)}
                      >
                        {ACTION_LABELS[next]}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pager">
        <button
          type="button"
          className="btn btn-small btn-ghost"
          disabled={data.page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </button>
        <span className="muted">
          Page {data.page} of {data.pages}
        </span>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          disabled={data.page >= data.pages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        labelledBy="order-detail-title"
      >
        {selected && (
          <div className="order-detail">
            <div className="order-detail-head">
              <h2 id="order-detail-title">{selected.orderNumber}</h2>
              <span className={`status-chip status-${selected.status}`}>
                {orderStatusLabel(selected.status)}
              </span>
            </div>
            <p className="muted">
              {selected.user ? `${selected.user.name} · ${selected.user.email}` : 'Customer'} ·{' '}
              {formatDate(selected.created_at, { withTime: true })}
            </p>

            <ul className="order-detail-items">
              {selected.items.map((item) => (
                <li key={item.medicine}>
                  <span>
                    {item.name} × {item.quantity}
                  </span>
                  <strong>{formatCurrency(item.lineTotal)}</strong>
                </li>
              ))}
            </ul>

            <div className="order-detail-totals">
              <span>Subtotal</span>
              <span>{formatCurrency(selected.totals.subtotal)}</span>
              <span>Tax</span>
              <span>{formatCurrency(selected.totals.tax)}</span>
              <span>Delivery</span>
              <span>{formatCurrency(selected.totals.deliveryFee)}</span>
              <strong>Total</strong>
              <strong>{formatCurrency(selected.totals.total)}</strong>
            </div>

            <h3>Shipping</h3>
            <p className="muted">
              {selected.shippingAddress.fullName}, {selected.shippingAddress.line1}
              {selected.shippingAddress.line2 ? `, ${selected.shippingAddress.line2}` : ''},{' '}
              {selected.shippingAddress.city}, {selected.shippingAddress.state}{' '}
              {selected.shippingAddress.pincode} · {selected.shippingAddress.phone}
            </p>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

