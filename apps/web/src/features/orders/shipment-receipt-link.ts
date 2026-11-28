import { decodeShipmentQr, normalizePublicAppUrl } from '@tracechain/shared';
import { chainConfig } from '../../config/network';

/** Omitted public URL uses the loaded application origin, never an origin from QR input. */
export function shipmentAppOrigin() {
  try {
    return normalizePublicAppUrl(
      import.meta.env.VITE_PUBLIC_APP_URL?.trim() || window.location.origin,
    );
  } catch {
    throw new Error(
      'VITE_PUBLIC_APP_URL must be an HTTPS origin (or HTTP localhost for development).',
    );
  }
}

export function parseShipmentReceiptLink(value: string) {
  const publicAppUrl = shipmentAppOrigin();
  let url: URL;
  try {
    url = new URL(value, publicAppUrl);
  } catch {
    throw new Error('This shipment receipt link is invalid or incomplete.');
  }
  // Navigation validation only. The receipt page checks the registry again against the API.
  decodeShipmentQr(url.href, {
    publicAppUrl,
    chainId: chainConfig.chainId,
    ordersAddress: url.searchParams.get('registry') ?? '',
  });
  return { href: url.href, publicAppUrl, returnTo: `${url.pathname}${url.search}` };
}

export function safeShipmentReturnTo(value: string | null) {
  if (!value) return null;
  try {
    return parseShipmentReceiptLink(value).returnTo;
  } catch {
    return null;
  }
}
