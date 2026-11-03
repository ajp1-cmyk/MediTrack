import { formatDate } from '../lib/format.js';

/**
 * NFR-2.2: shows the fair-use daily allowance the API computed for the cart.
 * `remaining` is what was left *before* the current cart, so it is compared
 * with `cartItemCount` here rather than decremented on the client.
 */
export default function PurchaseLimitNotice({ purchaseLimit, cartItemCount = 0 }) {
  if (!purchaseLimit || !purchaseLimit.enabled) return null;

  const remaining = purchaseLimit.remaining ?? 0;
  const overBy = Math.max(0, cartItemCount - remaining);

  return (
    <p className={`notice ${overBy > 0 ? 'notice-warn' : 'notice-info'}`}>
      Daily purchase limit: {purchaseLimit.used} of {purchaseLimit.limit} unit
      {purchaseLimit.limit === 1 ? '' : 's'} already ordered today.{' '}
      {remaining > 0
        ? `You can order ${remaining} more today.`
        : 'No units are left in today’s allowance.'}{' '}
      {overBy > 0 &&
        `This cart has ${cartItemCount} units — remove ${overBy} to stay within the limit. `}
      The allowance resets {formatDate(purchaseLimit.resetsAt, { withTime: true })}.
    </p>
  );
}
