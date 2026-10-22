// Helpers that decide whether a medicine can be sold right now.
//
// `exp` is stored as a plain YYYY-MM-DD string, so a medicine stays sellable
// for the whole of its expiry day and becomes unavailable the next day.

/** Today as YYYY-MM-DD (UTC, matching how the frontend date inputs store it). */
function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** True when the medicine's expiry date is before today. */
function isExpired(medicine, now = new Date()) {
  return Boolean(medicine && medicine.exp && medicine.exp < todayISO(now));
}

/**
 * Why this medicine cannot be sold, or null when it can.
 * @returns {string|null}
 */
function sellabilityIssue(medicine, now = new Date()) {
  if (!medicine) return 'This medicine is no longer available.';
  if (isExpired(medicine, now)) return `"${medicine.name}" has expired and cannot be sold.`;
  if (medicine.stock <= 0) return `"${medicine.name}" is out of stock.`;
  return null;
}

module.exports = { todayISO, isExpired, sellabilityIssue };
