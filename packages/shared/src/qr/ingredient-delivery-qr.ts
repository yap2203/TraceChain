import { decodeProductQrPayload, encodeProductQrPayload } from './product-qr.js';
export function encodeShipmentQr(input: { shipmentId: `0x${string}`; kind: 'ingredient' | 'product'; chainId: number; ordersAddress: string; publicAppUrl: string }) {
  const url = new URL(encodeIngredientDeliveryQr({ ...input, orderId: input.shipmentId }));
  url.pathname = '/receive/shipment'; url.searchParams.set('shipmentId', input.shipmentId); url.searchParams.delete('orderId'); url.searchParams.set('kind', input.kind); return url.href;
}
export function decodeShipmentQr(payload: string, expected: { chainId: number; ordersAddress: string; publicAppUrl: string; shipmentId?: string; kind?: string }) {
  const url = new URL(payload), kind = url.searchParams.get('kind'), shipmentId = url.searchParams.get('shipmentId');
  if (payload.length > 1024 || url.pathname !== '/receive/shipment' || url.searchParams.getAll('kind').length !== 1 || url.searchParams.getAll('shipmentId').length !== 1 || !['ingredient','product'].includes(kind ?? '') || url.searchParams.has('orderId') || (expected.kind && expected.kind !== kind)) throw new Error('Invalid shipment label.');
  url.pathname = '/receive/ingredient'; url.searchParams.delete('kind'); url.searchParams.delete('shipmentId'); url.searchParams.set('orderId', shipmentId ?? '');
  const result = decodeIngredientDeliveryQr(url.href, { ...expected, orderId: expected.shipmentId });
  return { shipmentId: result.orderId, kind: kind as 'ingredient' | 'product' };
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
  )
    throw new Error('Invalid ingredient delivery QR or application origin.');
  url.pathname = '/trace/product';
  url.searchParams.set('batchId', url.searchParams.get('orderId')!);
  url.searchParams.delete('orderId');
  const result = decodeProductQrPayload(url.href);
  if (
    result.chainId !== expected.chainId ||
    result.productRegistryAddress.toLowerCase() !== expected.ordersAddress.toLowerCase() ||
    (expected.orderId && result.batchId.toLowerCase() !== expected.orderId.toLowerCase())
  )
    throw new Error('This QR belongs to a different request, chain or registry.');
  return { orderId: result.batchId };
}
