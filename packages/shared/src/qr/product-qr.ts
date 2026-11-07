import { getAddress, isHexString } from 'ethers';

const PRODUCT_TRACE_PATH = '/trace/product';
const PRODUCT_QR_MAX_LENGTH = 1_024;
const REQUIRED_PARAMETERS = ['v', 'chainId', 'registry', 'batchId'] as const;

export const ProductQrErrorCode = {
  MALFORMED_QR_PAYLOAD: 'MALFORMED_QR_PAYLOAD',
  UNSUPPORTED_QR_VERSION: 'UNSUPPORTED_QR_VERSION',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  DUPLICATE_PARAMETER: 'DUPLICATE_PARAMETER',
  UNKNOWN_PARAMETER: 'UNKNOWN_PARAMETER',
  INVALID_PUBLIC_APP_URL: 'INVALID_PUBLIC_APP_URL',
  INVALID_CHAIN_ID: 'INVALID_CHAIN_ID',
  INVALID_REGISTRY_ADDRESS: 'INVALID_REGISTRY_ADDRESS',
  INVALID_BATCH_ID: 'INVALID_BATCH_ID',
  PAYLOAD_TOO_LONG: 'PAYLOAD_TOO_LONG',
} as const;

export type ProductQrErrorCodeValue = (typeof ProductQrErrorCode)[keyof typeof ProductQrErrorCode];

export interface ProductQrPayload {
  version: 1;
  chainId: number;
  productRegistryAddress: string;
  batchId: `0x${string}`;
}

export interface ProductQrEncodingInput extends ProductQrPayload {
  publicAppUrl: string;
}

export class ProductQrError extends Error {
  constructor(
    readonly code: ProductQrErrorCodeValue,
    message: string,
  ) {
    super(message);
    this.name = 'ProductQrError';
  }
}

function fail(code: ProductQrErrorCodeValue, message: string): never {
  throw new ProductQrError(code, message);
}

function normalizePublicAppUrl(value: unknown) {
  if (typeof value !== 'string')
    return fail(
      ProductQrErrorCode.INVALID_PUBLIC_APP_URL,
      'The public application URL is invalid.',
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(
      ProductQrErrorCode.INVALID_PUBLIC_APP_URL,
      'The public application URL is invalid.',
    );
  }
  const localDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  ) {
    return fail(
      ProductQrErrorCode.INVALID_PUBLIC_APP_URL,
      'The public application URL must be an HTTPS origin.',
    );
  }
  return url.origin;
}

function normalizeChainId(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    return fail(ProductQrErrorCode.INVALID_CHAIN_ID, 'The product QR chain ID is invalid.');
  return value;
}

function parseChainId(value: string) {
  if (!/^[1-9]\d*$/.test(value))
    return fail(ProductQrErrorCode.INVALID_CHAIN_ID, 'The product QR chain ID is invalid.');
  return normalizeChainId(Number(value));
}

function normalizeRegistry(value: unknown) {
  if (typeof value !== 'string')
    return fail(
      ProductQrErrorCode.INVALID_REGISTRY_ADDRESS,
      'The ProductRegistry address is invalid.',
    );
  try {
    return getAddress(value);
  } catch {
    return fail(
      ProductQrErrorCode.INVALID_REGISTRY_ADDRESS,
      'The ProductRegistry address is invalid.',
    );
  }
}

function normalizeBatchId(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !isHexString(value, 32))
    return fail(ProductQrErrorCode.INVALID_BATCH_ID, 'The product batch ID must be 32 bytes.');
  return value.toLowerCase() as `0x${string}`;
}

export function encodeProductQrPayload(input: ProductQrEncodingInput) {
  if (input.version !== 1)
    return fail(
      ProductQrErrorCode.UNSUPPORTED_QR_VERSION,
      'The product QR version is not supported.',
    );
  const origin = normalizePublicAppUrl(input.publicAppUrl);
  const chainId = normalizeChainId(input.chainId);
  const registry = normalizeRegistry(input.productRegistryAddress);
  const batchId = normalizeBatchId(input.batchId);
  return `${origin}${PRODUCT_TRACE_PATH}?v=1&chainId=${chainId}&registry=${registry}&batchId=${batchId}`;
}

export function decodeProductQrPayload(value: string): ProductQrPayload {
  if (typeof value !== 'string')
    return fail(ProductQrErrorCode.MALFORMED_QR_PAYLOAD, 'The product QR payload is malformed.');
  if (value.length > PRODUCT_QR_MAX_LENGTH)
    return fail(ProductQrErrorCode.PAYLOAD_TOO_LONG, 'The product QR payload is too long.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(ProductQrErrorCode.MALFORMED_QR_PAYLOAD, 'The product QR payload is malformed.');
  }
  const localDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) ||
    url.pathname !== PRODUCT_TRACE_PATH ||
    url.username ||
    url.password ||
    url.hash
  ) {
    return fail(
      ProductQrErrorCode.MALFORMED_QR_PAYLOAD,
      'The product QR payload has an invalid location.',
    );
  }
  const allowed = new Set<string>(REQUIRED_PARAMETERS);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key))
      return fail(
        ProductQrErrorCode.UNKNOWN_PARAMETER,
        'The product QR contains an unknown parameter.',
      );
  }
  for (const key of REQUIRED_PARAMETERS) {
    const values = url.searchParams.getAll(key);
    if (!values.length)
      return fail(ProductQrErrorCode.MISSING_PARAMETER, 'The product QR is missing a parameter.');
    if (values.length > 1)
      return fail(
        ProductQrErrorCode.DUPLICATE_PARAMETER,
        'The product QR contains a duplicate parameter.',
      );
  }
  if (url.searchParams.get('v') !== '1')
    return fail(
      ProductQrErrorCode.UNSUPPORTED_QR_VERSION,
      'The product QR version is not supported.',
    );
  return {
    version: 1,
    chainId: parseChainId(url.searchParams.get('chainId')!),
    productRegistryAddress: normalizeRegistry(url.searchParams.get('registry')),
    batchId: normalizeBatchId(url.searchParams.get('batchId')),
  };
}
