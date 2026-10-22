// Sandbox payment provider.
//
// It behaves like a gateway (latency, deterministic success/failure) without
// touching the network. It receives the raw card details only long enough to
// validate them and returns *no* sensitive data — the order stores just the
// brand and the last four digits.
//
// Demo rules
//   card  4242 4242 4242 4242  → success (Visa)
//   card  any number ending 02 → declined (Luhn must still pass)
//   card  expired date          → declined
//   upi   name@bank             → success
//   upi   fail@bank             → declined
//   cod                         → succeeds, payment stays pending
const crypto = require('crypto');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Standard Luhn checksum used by real card networks. */
function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function decline(reason, method) {
  return {
    status: 'failed',
    method,
    transactionId: null,
    last4: null,
    brand: null,
    failureReason: reason,
  };
}

function success({ method, last4 = null, brand = null }) {
  return {
    status: 'succeeded',
    method,
    transactionId: `${method}_${crypto.randomBytes(8).toString('hex')}`,
    last4,
    brand,
    failureReason: null,
  };
}

function mockDelayMs() {
  const value = Number(process.env.PAYMENT_MOCK_DELAY_MS);
  return Number.isFinite(value) && value >= 0 ? value : 700;
}

/**
 * Charge an order.
 *
 * @param {object} params
 * @param {object} params.order    the order being paid
 * @param {'card'|'upi'|'cod'} params.method
 * @param {object} [params.details] `{ number, expiry, cvv }` or `{ vpa }`
 * @returns {Promise<{ status: 'succeeded'|'failed', method: string,
 *   transactionId: string|null, last4: string|null, brand: string|null,
 *   failureReason: string|null }>}
 */
async function charge({ order, method, details = {} }) {
  await delay(mockDelayMs());

  if (method === 'cod') {
    if (order.totals.total > 5000) {
      return decline('Cash on delivery is not available for orders above ₹5,000.', method);
    }
    return success({ method: 'cod', brand: 'cod' });
  }

  if (method === 'upi') {
    const vpa = String(details.vpa || '').trim();
    if (!/^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(vpa)) {
      return decline('Enter a valid UPI ID, for example name@bank.', method);
    }
    if (/^fail@/i.test(vpa)) {
      return decline('The UPI collect request was declined.', method);
    }
    return success({ method: 'upi', brand: 'upi', last4: vpa.split('@')[0].slice(-4) });
  }

  if (method === 'card') {
    const number = String(details.number || '').replace(/[^0-9]/g, '');
    const expiry = String(details.expiry || '').trim();
    const cvv = String(details.cvv || '').trim();

    if (number.length < 12 || number.length > 19 || !luhnValid(number)) {
      return decline('Enter a valid card number.', method);
    }

    const match = expiry.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
    if (!match) {
      return decline('Expiry must be in MM/YY format.', method);
    }
    const expiryMonth = Number(match[1]);
    const expiryYear = 2000 + Number(match[2]);
    // First day of the month *after* the expiry month.
    if (new Date(expiryYear, expiryMonth, 1) <= new Date()) {
      return decline('This card has expired.', method);
    }

    if (!/^\d{3,4}$/.test(cvv)) {
      return decline('Enter a valid CVV.', method);
    }

    // Deterministic test decline: any card ending in 02 fails after validation.
    if (number.endsWith('02')) {
      return decline('Your card was declined by the issuing bank.', method);
    }

    const brand = number.startsWith('4')
      ? 'visa'
      : /^5[1-5]/.test(number)
        ? 'mastercard'
        : 'card';

    return success({ method: 'card', brand, last4: number.slice(-4) });
  }

  return decline('Unsupported payment method.', method);
}

module.exports = { charge, name: 'mock' };
