import {
  decodeProductQrPayload,
  encodeProductQrPayload,
  normalizePublicAppUrl,
} from './product-qr.js';

export function encodeShipmentQr(input: {
  shipmentId: `0x${string}`;
  kind: 'ingredient' | 'product';
  chainId: number;
  ordersAddress: string;
  publicAppUrl: string;
}) {
  const url = new URL(encodeIngredientDeliveryQr({ ...input, orderId: input.shipmentId }));
  url.pathname = '/receive/shipment';
  url.searchParams.set('shipmentId', input.shipmentId);
  url.searchParams.delete('orderId');
  url.searchParams.set('kind', input.kind);
  return url.href;
}

export function decodeShipmentQr(
  payload: string,
  expected: {
    chainId: number;
    ordersAddress: string;
    publicAppUrl: string;
    shipmentId?: string;
    kind?: string;
  },
) {
  let url: URL;
  try {
    url = new URL(payload);
  } catch {
    throw new Error('The selected QR does not contain a valid shipment link.');
  }

  const kind = url.searchParams.get('kind');
  const shipmentId = url.searchParams.get('shipmentId');
  const allowed = new Set(['v', 'chainId', 'registry', 'shipmentId', 'kind']);
  if (
    payload.length > 1024 ||
    url.pathname !== '/receive/shipment' ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
    ['v', 'chainId', 'registry', 'shipmentId', 'kind'].some(
      (key) => url.searchParams.getAll(key).length !== 1,
    ) ||
    !['ingredient', 'product'].includes(kind ?? '')
  ) {
    throw new Error('The selected QR is not a valid TraceChain shipment label.');
  }
  if (url.origin !== normalizePublicAppUrl(expected.publicAppUrl)) {
    throw new Error('This shipment QR belongs to a different TraceChain application.');
  }
  if (expected.kind && expected.kind !== kind) {
    throw new Error('This QR is for a different shipment kind.');
  }

  const productUrl = new URL(url);
  productUrl.pathname = '/trace/product';
  productUrl.searchParams.delete('kind');
  productUrl.searchParams.delete('shipmentId');
  productUrl.searchParams.set('batchId', shipmentId ?? '');
  const decoded = decodeProductQrPayload(productUrl.href);

  if (decoded.chainId !== expected.chainId) {
    throw new Error('This shipment QR is for a different blockchain network.');
  }
  if (decoded.productRegistryAddress.toLowerCase() !== expected.ordersAddress.toLowerCase()) {
    throw new Error('This shipment QR belongs to a different Orders contract.');
  }
  if (expected.shipmentId && decoded.batchId.toLowerCase() !== expected.shipmentId.toLowerCase()) {
    throw new Error('This QR belongs to a different shipment.');
  }
  return { shipmentId: decoded.batchId, kind: kind as 'ingredient' | 'product' };
}

export function encodeIngredientDeliveryQr(input: {
  orderId: `0x${string}`;
  chainId: number;
  ordersAddress: string;
  publicAppUrl: string;
}) {
  const url = new URL(
    encodeProductQrPayload({
      version: 1,
      batchId: input.orderId,
      chainId: input.chainId,
      productRegistryAddress: input.ordersAddress,
      publicAppUrl: input.publicAppUrl,
    }),
  );
  url.pathname = '/receive/ingredient';
  url.searchParams.set('orderId', url.searchParams.get('batchId')!);
  url.searchParams.delete('batchId');
  return url.href;
}

/** Untrusted locator, never authority to receive goods or select a contract. */
export function decodeIngredientDeliveryQr(
  payload: string,
  expected: {
    chainId: number;
    ordersAddress: string;
    publicAppUrl: string;
    orderId?: string;
  },
) {
  const url = new URL(payload);
  if (
    payload.length > 1024 ||
    url.origin !== new URL(expected.publicAppUrl).origin ||
    url.pathname !== '/receive/ingredient' ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.getAll('orderId').length !== 1 ||
    url.searchParams.has('batchId')
  ) {
    throw new Error('Invalid ingredient delivery QR or application origin.');
  }
  url.pathname = '/trace/product';
  url.searchParams.set('batchId', url.searchParams.get('orderId')!);
  url.searchParams.delete('orderId');
  const result = decodeProductQrPayload(url.href);
  if (
    result.chainId !== expected.chainId ||
    result.productRegistryAddress.toLowerCase() !== expected.ordersAddress.toLowerCase() ||
    (expected.orderId && result.batchId.toLowerCase() !== expected.orderId.toLowerCase())
  ) {
    throw new Error('This QR belongs to a different request, chain or registry.');
  }
  return { orderId: result.batchId };
}
