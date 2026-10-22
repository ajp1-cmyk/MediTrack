import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import OrderSummary from '../components/OrderSummary.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { ordersApi } from '../lib/api.js';

const emptyAddress = {
  fullName: '',
  phone: '',
  email: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
};

export default function Checkout() {
  const { user } = useAuth();
  const { items, totals, loading, refresh } = useCart();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    ...emptyAddress,
    fullName: user ? user.name : '',
    email: user ? user.email : '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const update = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const order = await ordersApi.create({ ...form, country: 'India' });
      // The order now owns the stock; the cart is empty server-side.
      refresh().catch(() => {});
      navigate(`/orders/${order.id}/payment`, { replace: true });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="page">
        <p className="empty">Loading your cart…</p>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Nothing to check out</h1>
          <p>Your cart is empty.</p>
        </div>
        <div className="empty-card">
          <Link to="/" className="btn btn-primary">
            Browse medicines
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1>Checkout</h1>
        <p>Where should we deliver your order?</p>
      </div>

      <form className="checkout-grid" onSubmit={handleSubmit}>
        <section className="form-card checkout-form">
          <h2>Shipping details</h2>

          <div className="field">
            <label htmlFor="fullName">Full name</label>
            <input
              id="fullName"
              type="text"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              autoComplete="name"
              required
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input
                id="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="9876543210"
                autoComplete="tel"
                pattern="[+]?[0-9][0-9 -]{6,14}"
                title="7–15 digits, spaces and dashes allowed"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="email">Contact email</label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="line1">Address line 1</label>
            <input
              id="line1"
              type="text"
              value={form.line1}
              onChange={(e) => update('line1', e.target.value)}
              placeholder="House / flat, street"
              autoComplete="address-line1"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="line2">Address line 2 (optional)</label>
            <input
              id="line2"
              type="text"
              value={form.line2}
              onChange={(e) => update('line2', e.target.value)}
              placeholder="Landmark, area"
              autoComplete="address-line2"
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="city">City</label>
              <input
                id="city"
                type="text"
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
                autoComplete="address-level2"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="state">State</label>
              <input
                id="state"
                type="text"
                value={form.state}
                onChange={(e) => update('state', e.target.value)}
                autoComplete="address-level1"
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="pincode">PIN code</label>
            <input
              id="pincode"
              type="text"
              inputMode="numeric"
              value={form.pincode}
              onChange={(e) => update('pincode', e.target.value.replace(/\D/g, '').slice(0, 10))}
              autoComplete="postal-code"
              pattern="[0-9]{4,10}"
              title="4–10 digits"
              required
            />
          </div>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Placing order…' : 'Place order & continue to payment'}
          </button>
          <p className="summary-note">
            Stock is reserved for 30 minutes while you pay. Nothing is charged on this page.
          </p>
        </section>

        <OrderSummary items={items} totals={totals} title="Your order">
          <Link to="/cart" className="btn btn-ghost btn-block btn-small">
            Edit cart
          </Link>
        </OrderSummary>
      </form>
    </main>
  );
}
