import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';

export default function Navbar() {
  const { user, isBackOffice, loading, logout } = useAuth();
  const { itemCount } = useCart();
  const navigate = useNavigate();

  const handleLogout = async () => {
    // Also revokes the refresh session on the server.
    await logout();
    navigate('/');
  };

  return (
    <nav className="navbar">
      <Link to="/" className="brand">
        <span className="logo">💊</span>
        <span className="brand-text">MediTrack</span>
      </Link>

      <div className="nav-actions">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `btn btn-ghost${isActive ? ' active' : ''}`}
        >
          Home
        </NavLink>

        {/* Staff and admins get the back-office console. */}
        {isBackOffice && (
          <Link to="/admin" className="btn btn-primary">
            Admin console
          </Link>
        )}

        {user && (
          <NavLink
            to="/orders"
            className={({ isActive }) => `btn btn-ghost${isActive ? ' active' : ''}`}
          >
            Orders
          </NavLink>
        )}

        <NavLink
          to="/cart"
          className={({ isActive }) => `btn btn-ghost cart-link${isActive ? ' active' : ''}`}
          aria-label={`Cart, ${itemCount} item${itemCount === 1 ? '' : 's'}`}
        >
          <span aria-hidden="true">🛒</span>
          <span className="cart-link-text">Cart</span>
          {itemCount > 0 && <span className="cart-badge">{itemCount}</span>}
        </NavLink>

        {loading ? (
          // The silent refresh is still in flight; avoid flashing "Sign in".
          <span className="user-chip" aria-hidden="true">
            …
          </span>
        ) : user ? (
          <>
            <span className="user-chip" title={user.email}>
              {user.name}
              <span className={`role-badge role-${user.role}`}>{user.role}</span>
            </span>
            <button type="button" className="btn btn-ghost" onClick={handleLogout}>
              Log out
            </button>
          </>
        ) : (
          <Link to="/login" className="btn btn-secondary">
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}

