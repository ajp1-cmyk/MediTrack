import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

/** Dark closing band: navigation, service promises and the legal footnote. */
export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="footer-logo" aria-hidden="true">
            <Icon name="pill" size={22} strokeWidth={1.7} />
          </span>
          <div>
            <strong>MediTrack</strong>
            <p>
              Genuine medicines with live stock and expiry dates, prescriptions checked by
              pharmacists, and secure checkout — delivered to your door.
            </p>
            <ul className="footer-trust">
              <li>
                <Icon name="shield" size={15} /> Pharmacist verified
              </li>
              <li>
                <Icon name="truck" size={15} /> Same-day dispatch
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-cols">
          <div>
            <h4>Shop</h4>
            <Link to="/">All medicines</Link>
            <Link to="/cart">Your cart</Link>
            <Link to="/wishlist">Wishlist</Link>
          </div>
          <div>
            <h4>Account</h4>
            <Link to="/login">Sign in</Link>
            <Link to="/orders">Orders</Link>
            <Link to="/prescriptions">Prescriptions</Link>
          </div>
          <div>
            <h4>Service</h4>
            <span>
              <Icon name="clock" size={15} /> Mon–Sat, 9 am – 9 pm
            </span>
            <a href="mailto:support@meditrack.example">support@meditrack.example</a>
            <span>Rx verified within 2 hours</span>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} MediTrack · Software engineering course project</span>
        <span>Demo storefront — no real medicines are dispensed.</span>
      </div>
    </footer>
  );
}
