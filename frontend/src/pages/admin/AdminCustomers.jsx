import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../lib/api.js';
import { formatCurrency, formatDate } from '../../lib/format.js';

export default function AdminCustomers() {
  const [data, setData] = useState({ customers: [], total: 0, page: 1, pages: 1 });
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setLoading(true);
      setData(await adminApi.customers({ q, page, limit: 20 }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [q, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h1>Customers</h1>
          <p className="muted">Accounts, order counts and lifetime spend.</p>
        </div>
      </div>

      <div className="toolbar toolbar-wrap">
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
            placeholder="Name or email…"
            aria-label="Search customers"
          />
          <button type="submit" className="btn btn-secondary btn-small">
            Search
          </button>
        </form>
        <span className="muted">{data.total} customer(s)</span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="empty">Loading customers…</p>
      ) : data.customers.length === 0 ? (
        <p className="empty">No customers match that search.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Joined</th>
                <th>Orders</th>
                <th>Spend</th>
                <th>Last order</th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <strong>{customer.name}</strong>
                    <small className="table-sub">{customer.email}</small>
                  </td>
                  <td>{formatDate(customer.created_at)}</td>
                  <td>{customer.orders}</td>
                  <td>{formatCurrency(customer.spend)}</td>
                  <td>{customer.lastOrderAt ? formatDate(customer.lastOrderAt) : '—'}</td>
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
    </>
  );
}
