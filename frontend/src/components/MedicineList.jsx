export default function MedicineList({ medicines }) {
  if (medicines.length === 0) {
    return (
      <p className="empty">
        No medicines in stock yet. Click the 'Add Medicine' button to add your first one.
      </p>
    );
  }

  return (
    <div className="medicine-grid">
      {medicines.map((m) => (
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
            <p><span>Price:</span> ₹{Number(m.price).toFixed(2)}</p>
            <p><span>Stock:</span> {m.stock} units</p>
          </div>
        </div>
      ))}
    </div>
  );
}
