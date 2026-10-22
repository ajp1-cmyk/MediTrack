// Money helpers shared by the cart and the order routes.
//
// Every calculation happens in *paise* (integer cents) so that floating point
// rounding never leaks into a customer-facing total. Values are converted back
// to rupees (2 decimals) only when they leave this module.
//
// All rates can be overridden in backend/.env:
//   TAX_RATE=0.05           → 5% GST
//   DELIVERY_FEE=40         → ₹40 delivery charge
//   FREE_DELIVERY_OVER=499  → delivery is free from ₹499 upwards

const DEFAULT_TAX_RATE = 0.05;
const DEFAULT_DELIVERY_FEE = 40;
const DEFAULT_FREE_DELIVERY_OVER = 499;

/** Read a numeric environment variable, falling back when it is missing/invalid. */
function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** The pricing rules currently in force. */
function getPricingConfig() {
  return {
    taxRate: numberFromEnv('TAX_RATE', DEFAULT_TAX_RATE),
    deliveryFee: numberFromEnv('DELIVERY_FEE', DEFAULT_DELIVERY_FEE),
    freeDeliveryOver: numberFromEnv('FREE_DELIVERY_OVER', DEFAULT_FREE_DELIVERY_OVER),
    currency: 'INR',
  };
}

/** Rupees → integer paise. */
function toPaise(amount) {
  return Math.round(Number(amount || 0) * 100);
}

/** Integer paise → rupees rounded to 2 decimals. */
function fromPaise(paise) {
  return Math.round(paise) / 100;
}

/**
 * Compute the bill for a set of lines.
 *
 * @param {Array<{ unitPrice: number, quantity: number }>} lines
 * @returns {{ subtotal: number, tax: number, deliveryFee: number, total: number,
 *             itemCount: number, currency: string, taxRate: number,
 *             freeDeliveryOver: number }}
 */
function computeTotals(lines = []) {
  const { taxRate, deliveryFee, freeDeliveryOver, currency } = getPricingConfig();

  const subtotalPaise = lines.reduce(
    (sum, line) => sum + toPaise(line.unitPrice) * line.quantity,
    0
  );
  const taxPaise = Math.round(subtotalPaise * taxRate);
  const deliveryPaise =
    subtotalPaise === 0 || subtotalPaise >= toPaise(freeDeliveryOver) ? 0 : toPaise(deliveryFee);

  const itemCount = lines.reduce((count, line) => count + line.quantity, 0);

  return {
    subtotal: fromPaise(subtotalPaise),
    tax: fromPaise(taxPaise),
    deliveryFee: fromPaise(deliveryPaise),
    total: fromPaise(subtotalPaise + taxPaise + deliveryPaise),
    itemCount,
    currency,
    taxRate,
    freeDeliveryOver,
  };
}

module.exports = { getPricingConfig, computeTotals, toPaise, fromPaise };
