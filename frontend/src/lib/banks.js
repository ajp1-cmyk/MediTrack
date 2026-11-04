// Banks offered for net banking.
//
// `id` is what the API records on the order (`payment.brand`) and what the
// payment provider validates against, so it must stay in sync with
// backend/lib/providers/mockPayment.js. The label is display text only.
//
// The last entry always declines, which keeps a rejected payment reachable in
// the checkout flow without any special tooling.
export const BANKS = [
  { id: 'hdfc', label: 'HDFC Bank' },
  { id: 'icici', label: 'ICICI Bank' },
  { id: 'sbi', label: 'State Bank of India' },
  { id: 'axis', label: 'Axis Bank' },
  { id: 'kotak', label: 'Kotak Mahindra Bank' },
  { id: 'failbank', label: 'Sunrise Bank' },
];

const BANK_LABELS = new Map(BANKS.map((bank) => [bank.id, bank.label]));

/**
 * Display name for a stored bank code, e.g. `hdfc` → "HDFC Bank".
 * @param {string} id
 * @returns {string}
 */
export function bankLabel(id) {
  if (!id) return '';
  return BANK_LABELS.get(id) || String(id);
}
