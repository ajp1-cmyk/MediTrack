import { formatCurrency } from '../lib/format.js';

/**
 * Price breakdown shared by the cart, checkout, payment and confirmation pages.
 * Totals always come from the server; this component only formats them.
 */
export default function OrderSummary({
  items = [],
  totals,
  title = 'Order summary',
  showItems = true,
  children,
}) {
  return (
    <aside className="summary-card">
      <h3>{title}</h3>

      {showItems && items.length > 0 && (
        <ul className="summary-items">
          {items.map((item) => (
            <li key={item.medicineId || item.medicine || item.name}>
              <span className="summary-item-name">
                {item.name} <em>× {item.quantity}</em>
              </span>
              <span>{formatCurrency(item.lineTotal)}</span>
            </li>
          ))}
        </ul>
      )}

      {totals && (
        <div className="summary-totals">
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{formatCurrency(totals.subtotal)}</span>
          </div>
          <div className="summary-row">
            <span>GST ({Math.round((totals.taxRate ?? 0.05) * 100)}%)</span>
            <span>{formatCurrency(totals.tax)}</span>
          </div>
          <div className="summary-row">
            <span>Delivery</span>
            <span>{totals.deliveryFee === 0 ? 'Free' : formatCurrency(totals.deliveryFee)}</span>
          </div>
          <div className="summary-row total">
            <span>Total</span>
            <span>{formatCurrency(totals.total)}</span>
          </div>
          <p className="summary-note">
            {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'} · GST shown above
          </p>
        </div>
      )}

      {children}
    </aside>
  );
}
