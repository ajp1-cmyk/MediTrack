import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Accessible modal built on the native <dialog> element.
 *
 * Native `showModal()` gives us the focus trap, the top layer and ESC handling
 * for free; we only add backdrop-click closing, body scroll lock and focus
 * restoration (handled by the browser when the dialog closes).
 */
export default function Modal({ open, onClose, labelledBy, className = '', children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return undefined;

    if (!dialog.open) dialog.showModal();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const handleCancel = (event) => {
      event.preventDefault(); // let React close it so state stays in sync
      onClose?.();
    };
    const handleClick = (event) => {
      // A click that lands on the dialog itself is a backdrop click.
      if (event.target === dialog) onClose?.();
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('click', handleClick);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('click', handleClick);
    };
  }, [onClose]);

  if (!open) return null;

  return createPortal(
    <dialog ref={dialogRef} className={`modal ${className}`.trim()} aria-labelledby={labelledBy}>
      <div className="modal-content">{children}</div>
    </dialog>,
    document.body
  );
}
