import { decodeBytes32String, isHexString } from 'ethers';

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

const knownUnits: Record<string, { quantity: string; price: string }> = {
  each: { quantity: 'each', price: 'each' },
  g: { quantity: 'g', price: 'g' },
  kg: { quantity: 'kg', price: 'kg' },
  litre: { quantity: 'litres', price: 'litre' },
  ml: { quantity: 'ml', price: 'ml' },
};

export interface OperationalUnit {
  canonical?: string;
  quantityLabel: string;
  priceLabel?: string;
  raw: string;
}

/** Decode safe named contract units. Malformed values stay technical and use a neutral label. */
export function operationalUnit(value: unknown): OperationalUnit {
  const raw = String(value ?? '');
  let decoded = raw.trim().toLowerCase();
  if (isHexString(raw, 32)) {
    try {
      decoded = decodeBytes32String(raw).trim().toLowerCase();
    } catch {
      return { quantityLabel: 'units', priceLabel: 'units', raw };
    }
  }
  const known = knownUnits[decoded];
  if (known)
    return { canonical: decoded, quantityLabel: known.quantity, priceLabel: known.price, raw };
  if (/^[a-z0-9._/-]{1,31}$/.test(decoded))
    return { canonical: decoded, quantityLabel: decoded, priceLabel: decoded, raw };
  return { quantityLabel: 'units', priceLabel: 'units', raw };
}

export function formatOperationalQuantity(quantity: unknown, unit: unknown) {
  const formatted = operationalUnit(unit);
  return `${String(quantity ?? '0')} ${formatted.quantityLabel}`;
}

export function formatOperationalPrice(currency: unknown, price: unknown, unit: unknown) {
  const formatted = operationalUnit(unit);
  if (price === undefined || price === null || price === '') return 'Unavailable';
  const amount = Number(price);
  const value = Number.isFinite(amount) ? amount.toFixed(2) : String(price);
  return `${String(currency || 'MYR')} ${value} / ${formatted.priceLabel ?? 'units'}`;
}

/** Only genuine absence is hidden; zero and explicit unavailable/undisclosed values stay visible. */
export function hasPresentationValue(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}
