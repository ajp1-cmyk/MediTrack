import { useState } from 'react';
import { apiFetch } from '../lib/api.js';

const emptyForm = {
  name: '',
  mfd: '',
  exp: '',
  price: '',
  stock: '',
  image: null,
};

export default function MedicineForm({ onCreated }) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const update = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const data = new FormData();
      data.append('name', form.name);
      data.append('mfd', form.mfd);
      data.append('exp', form.exp);
      data.append('price', form.price);
      data.append('stock', form.stock);
      if (form.image) data.append('image', form.image);

      const result = await apiFetch('/api/medicines', {
        method: 'POST',
        body: data, // FormData — apiFetch adds the JWT but not Content-Type
      });

      onCreated(result);
      setForm(emptyForm);
      e.target.reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="medicine-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="name">Medicine name</label>
        <input
          id="name"
          type="text"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="e.g. Dettol Liquid"
          required
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="mfd">MFD (Manufacturing date)</label>
          <input
            id="mfd"
            type="date"
            value={form.mfd}
            onChange={(e) => update('mfd', e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="exp">EXP (Expiry date)</label>
          <input
            id="exp"
            type="date"
            value={form.exp}
            onChange={(e) => update('exp', e.target.value)}
            required
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="price">Price (₹)</label>
          <input
            id="price"
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={(e) => update('price', e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="stock">Stock (quantity)</label>
          <input
            id="stock"
            type="number"
            min="0"
            step="1"
            value={form.stock}
            onChange={(e) => update('stock', e.target.value)}
            placeholder="0"
            required
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="image">Medicine image (optional)</label>
        <input
          id="image"
          type="file"
          accept="image/*"
          onChange={(e) => update('image', e.target.files[0] || null)}
        />
        {form.image && <p className="file-hint">Selected: {form.image.name}</p>}
      </div>

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={submitting}
      >
        {submitting ? 'Saving…' : 'Add Medicine'}
      </button>

      {error && <p className="error">{error}</p>}
    </form>
  );
}
