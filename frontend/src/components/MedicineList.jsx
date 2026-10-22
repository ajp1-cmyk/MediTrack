import { useCart } from '../context/CartContext.jsx';
import { formatCurrency } from '../lib/format.js';

export default function MedicineList({ medicines }) {
  const { openAddDialog } = useCart();
  const today = new Date().toISOString().slice(0, 10);

  if (medicines.length === 0) {
    return (
      <p className="empty">
        No medicines in stock yet. Please check back soon.
      </p>
    );
  }

  return (
    <div className="medicine-grid">
      {medicines.map((m) => {
        const expired = Boolean(m.exp && m.exp < today);
        const soldOut = m.stock <= 0;

        return (
          <div className="medicine-card" key={m.id}>
            {m.image ? (
              <img
                src={`/uploads/${m.image}`}
                alt={m.name}
                className="medicine-image"
              />
            ) : (
              <div className="medicine-image placeholder">💊</div>
            )}
            <div className="medicine-body">
              <h3>{m.name}</h3>
              <p><span>MFD:</span> {m.mfd}</p>
              <p><span>EXP:</span> {m.exp}</p>
              <p><span>Price:</span> {formatCurrency(m.price)}</p>
              <p><span>Stock:</span> {m.stock} units</p>

              <button
                type="button"
                className="btn btn-primary btn-block cart-add-btn"
                onClick={() => openAddDialog(m)}
                disabled={expired || soldOut}
              >
                {expired ? 'Expired' : soldOut ? 'Out of stock' : 'Add to cart'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

