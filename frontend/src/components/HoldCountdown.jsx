import { useEffect, useRef, useState } from 'react';

/** Whole seconds left until `until` (0 once the moment has passed). */
function secondsUntil(until) {
  if (!until) return 0;
  return Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
}

/** "14:59" — the mm:ss label used for a stock hold. */
export function formatCountdown(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Live mm:ss countdown for a cart hold (FR-1.2).
 *
 * `onExpire` fires once when the deadline passes, so the caller can re-read the
 * cart and let the server release the hold (FR-1.3).
 */
export default function HoldCountdown({ until, onExpire, className = '' }) {
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(until));

  // Keep the callback in a ref: an inline arrow from the parent would otherwise
  // restart the interval on every render.
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    setSecondsLeft(secondsUntil(until));
    if (!until) return undefined;

    let fired = false;
    const timer = setInterval(() => {
      const next = secondsUntil(until);
      setSecondsLeft(next);
      if (next > 0) return;

      clearInterval(timer);
      if (!fired) {
        fired = true;
        if (onExpireRef.current) onExpireRef.current();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [until]);

  return (
    <span className={`hold-countdown ${className}`.trim()}>{formatCountdown(secondsLeft)}</span>
  );
}
