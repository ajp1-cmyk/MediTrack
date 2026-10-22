// Display helpers for money, dates and order statuses.

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,234.50 */
export function formatCurrency(value) {
  return currencyFormatter.format(Number(value) || 0);
}

/** "22 Oct 2026" (or include the time when asked). */
export function formatDate(value, { withTime = false } = {}) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

/** Minutes left until an ISO timestamp (never negative). */
export function minutesLeft(value) {
  if (!value) return 0;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60000));
}

export const ORDER_STATUS_LABELS = {
  pending_payment: 'Awaiting payment',
  processing: 'Confirmed (pay on delivery)',
  paid: 'Paid',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export const PAYMENT_STATUS_LABELS = {
  pending: 'Pending',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status;
}
