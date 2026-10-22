import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from './Modal.jsx';
import QuantityStepper from './QuantityStepper.jsx';
import { useCart } from '../context/CartContext.jsx';
import { formatCurrency } from '../lib/format.js';

/**
 * Confirm dialog shown when "Add to cart" is clicked.
 *
 * State lives in CartContext (`addTarget`) so any page can open it; this
 * component is rendered once in App.
 */
export default function AddToCartDialog() {
  const { addTarget, closeAddDialog, addItem } = useCart();

  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [addedQuantity, setAddedQuantity] = useState(0);

  // Reset whenever a different medicine is opened.
  useEffect(() => {
    setQuantity(1);
    setAdding(false);
    setError('');
    setAddedQuantity(0);
  }, [addTarget?.id]);

  if (!addTarget) return null;

  const today = new Date().toISOString().slice(0, 10);
  const expired = Boolean(addTarget.exp && addTarget.exp < today);
  const soldOut = addTarget.stock <= 0;
  const maxQuantity = Math.max(1, Math.min(99, addTarget.stock));
  const unavailable = expired || soldOut;

  const handleAdd = async () => {
    setAdding(true);
    setError('');
    try {
      await addItem(addTarget.id, quantity);
      setAddedQuantity(quantity);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal open onClose={closeAddDialog} labelledBy="add-to-cart-title">
      <div className="modal-head">
        <h2 id="add-to-cart-title">{addedQuantity ? 'Added to cart' : 'Add to cart'}</h2>
        <button
          type="button"
          className="modal-close"
          onClick={closeAddDialog}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>

      {addedQuantity > 0 ? (
        <div className="modal-body modal-success">
          <div className="success-mark" aria-hidden="true">
            ✓
          </div>
          <p>
            <strong>
              {addedQuantity} × {addTarget.name}
            </strong>{' '}
            is now in your cart.
          </p>
          <div className="modal-actions">
            <Link to="/cart" className="btn btn-primary" onClick={closeAddDialog}>
              View cart
            </Link>
            <button type="button" className="btn btn-secondary" onClick={closeAddDialog}>
              Keep shopping
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="modal-body">
            <div className="modal-item">
              {addTarget.image ? (
                <img
                  className="modal-thumb"
                  src={`/uploads/${addTarget.image}`}
                  alt={addTarget.name}
                />
              ) : (
                <div className="modal-thumb placeholder">💊</div>
              )}
              <div>
                <h3>{addTarget.name}</h3>
                <p className="muted">{formatCurrency(addTarget.price)} each</p>
                <p className="muted">
                  {expired
                    ? 'This medicine has expired.'
                    : soldOut
                      ? 'Out of stock.'
                      : `${addTarget.stock} in stock`}
                </p>
              </div>
            </div>

            <div className="modal-qty">
              <span>Quantity</span>
              <QuantityStepper
                value={quantity}
                min={1}
                max={maxQuantity}
                onChange={setQuantity}
                disabled={adding || unavailable}
              />
            </div>

            <div className="modal-line-total">
              <span>Item total</span>
              <strong>{formatCurrency(addTarget.price * quantity)}</strong>
            </div>

            {error && <p className="error">{error}</p>}
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeAddDialog}
              disabled={adding}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAdd}
              disabled={adding || unavailable}
            >
              {adding ? 'Adding…' : unavailable ? 'Unavailable' : `Add ${quantity} to cart`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
