import { Link, NavLink } from 'react-router-dom';

export default function Navbar() {
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
        <Link to="/add" className="btn btn-primary">
          + Add Medicine
        </Link>
      </div>
    </nav>
  );
}
