/** Small −/+ quantity control shared by the dialog and the cart page. */
export default function QuantityStepper({
  value,
  min = 1,
  max = 99,
  onChange,
  disabled = false,
  label = 'Quantity',
}) {
  const clamp = (next) => Math.min(max, Math.max(min, next));

  return (
    <div className="qty-stepper">
      <button
        type="button"
        className="qty-btn"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
      >
        −
      </button>
      <input
        className="qty-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(clamp(Math.trunc(next)));
        }}
      />
      <button
        type="button"
        className="qty-btn"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}
