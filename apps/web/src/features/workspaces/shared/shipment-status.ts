import { BADGE, type BadgeVariant } from './ui/Badge';

/**
 * The one shipment status → badge colour mapping (enforce-ui-consistency, section 3):
 * green done, teal ready to check (awaiting receipt), purple moving (in transit),
 * amber waiting or needs action, red failed, grey void.
 */
export function shipmentStatusVariant(label: string): BadgeVariant {
  const value = label.toLocaleLowerCase();
  if (/rejected|discrepancy|failed/.test(value)) return 'rejected';
  if (/cancelled|closed/.test(value)) return 'expired';
  if (/^received|received by|returned|completed/.test(value)) return 'verified';
  if (/awaiting.*receipt|arrived|partially|ready to confirm/.test(value)) return 'shared';
  if (/transit|dispatched|sent to/.test(value)) return 'moving';
  return 'pending';
}

/** Card accent (left edge) in the same colour as the status badge, so they never disagree. */
export const shipmentStatusAccent = (label: string) => ({
  borderLeftColor: BADGE[shipmentStatusVariant(label)].dot,
});
