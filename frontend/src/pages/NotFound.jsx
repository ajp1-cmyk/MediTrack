import { Link, useLocation } from 'react-router-dom';

/**
 * Fallback for an address that matches no route.
 *
 * A reload on a deep link only reaches React Router when the host serves
 * `index.html` for it (see vite.config.js and docs/DEPLOYMENT.md, section 8);
 * once it does, a mistyped or stale link — a truncated order id, an old
 * bookmark — lands here instead of silently rendering the catalogue, which
 * looked like "the site is broken" rather than "this address does not exist".
 */
export default function NotFound() {
  const { pathname } = useLocation();

  return (
    <main className="page">
      <div className="page-header">
        <h1>Page not found</h1>
        <p>
          Nothing is served at <code>{pathname}</code>. The link may be out of date,
          or the address may have been mistyped.
        </p>
      </div>
      <div className="empty-card">
        <p className="empty">
          Looking for an order? Your history has every order and its current status.
        </p>
        <Link to="/orders" className="btn btn-secondary">
          My orders
        </Link>{' '}
        <Link to="/" className="btn btn-primary">
          Browse medicines
        </Link>
      </div>
    </main>
  );
}
