export const recordStatuses = ['Unknown', 'Active', 'Suspended', 'Recalled'] as const;
export const transferStatuses = [
  'Unknown',
  'Awaiting Receipt',
  'Received',
  'Rejected',
  'Cancelled',
  'Discrepancy',
] as const;
export const evidenceStatuses = [
  'Unknown',
  'Awaiting Response',
  'Evidence Received',
  'Accepted',
  'Declined',
  'Rejected',
  'Cancelled',
] as const;
export const shortChainId = (value: string) =>
  value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
export const chainDate = (seconds: number) =>
  seconds ? new Date(seconds * 1_000).toLocaleDateString() : '—';
