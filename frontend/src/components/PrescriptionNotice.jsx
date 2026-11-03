import { Link } from 'react-router-dom';
import { formatDate } from '../lib/format.js';

/**
 * FR-1.4 / FR-2.1: explains why a cart with prescription-only medicines can or
 * cannot be checked out. The API computes `prescription` with the customer's
 * current status (`none`, `pending`, `verified`, `rejected`, `expired`).
 */
export default function PrescriptionNotice({ prescription, requiresPrescription }) {
  if (!requiresPrescription) return null;

  const status = (prescription && prescription.status) || 'none';

  if (status === 'verified') {
    return (
      <p className="notice notice-info">
        Prescription verified — valid until {formatDate(prescription.validUntil)}. It covers the
        prescription-only items in your cart.
      </p>
    );
  }

  if (status === 'pending') {
    return (
      <p className="notice notice-warn">
        Your prescription is waiting for staff verification, so the prescription-only items cannot
        be ordered yet. <Link to="/prescriptions">View the status</Link>.
      </p>
    );
  }

  if (status === 'rejected') {
    return (
      <p className="notice notice-warn">
        Your last prescription was rejected
        {prescription.rejectionReason ? ` (${prescription.rejectionReason})` : ''}.{' '}
        <Link to="/prescriptions">Upload a new prescription</Link> to order these items.
      </p>
    );
  }

  if (status === 'expired') {
    return (
      <p className="notice notice-warn">
        Your prescription expired on {formatDate(prescription.validUntil)}.{' '}
        <Link to="/prescriptions">Upload a new prescription</Link> to order these items.
      </p>
    );
  }

  return (
    <p className="notice notice-warn">
      Your cart contains prescription-only medicines. <Link to="/prescriptions">Upload a
      prescription</Link> and wait for staff verification before checking out.
    </p>
  );
}
