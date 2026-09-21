import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
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

        {/* The stock update page is admin-only. */}
        {isAdmin && (
          <Link to="/add" className="btn btn-primary">
            + Add Medicine
          </Link>
        )}

        {user ? (
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
