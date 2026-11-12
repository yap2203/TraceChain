import { getAddress, isHexString } from 'ethers';

const TRANSFER_RECEIPT_PATH = '/receive/transfer';
const LEGACY_PROTOCOL = 'tracechain:';
const TRANSFER_QR_MAX_LENGTH = 1_024;
const REQUIRED_PARAMETERS = ['v', 'chainId', 'contract', 'transferId'] as const;

export const TransferQrErrorCode = {
  MALFORMED_QR_PAYLOAD: 'MALFORMED_QR_PAYLOAD',
  UNSUPPORTED_QR_VERSION: 'UNSUPPORTED_QR_VERSION',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  DUPLICATE_PARAMETER: 'DUPLICATE_PARAMETER',
  UNKNOWN_PARAMETER: 'UNKNOWN_PARAMETER',
  NON_CANONICAL_PARAMETER_ORDER: 'NON_CANONICAL_PARAMETER_ORDER',
  INVALID_PUBLIC_APP_URL: 'INVALID_PUBLIC_APP_URL',
  PUBLIC_APP_ORIGIN_MISMATCH: 'PUBLIC_APP_ORIGIN_MISMATCH',
  INVALID_CHAIN_ID: 'INVALID_CHAIN_ID',
  INVALID_CONTRACT_ADDRESS: 'INVALID_CONTRACT_ADDRESS',
  INVALID_TRANSFER_ID: 'INVALID_TRANSFER_ID',
  PAYLOAD_TOO_LONG: 'PAYLOAD_TOO_LONG',
} as const;

export type TransferQrErrorCodeValue =
  (typeof TransferQrErrorCode)[keyof typeof TransferQrErrorCode];

export interface TransferQrPayload {
  version: 1;
  chainId: number;
  custodyTransferAddress: string;
  transferId: `0x${string}`;
}

export interface TransferQrEncodingInput extends TransferQrPayload {
  publicAppUrl: string;
}

export interface TransferQrDecodingOptions {
  allowLegacy?: boolean;
  publicAppUrl: string;
}

export class TransferQrError extends Error {
  constructor(
    readonly code: TransferQrErrorCodeValue,
    message: string,
  ) {
    super(message);
    this.name = 'TransferQrError';
  }
}

function fail(code: TransferQrErrorCodeValue, message: string): never {
  throw new TransferQrError(code, message);
}

function normalizePublicAppUrl(value: unknown) {
  if (typeof value !== 'string')
    return fail(
      TransferQrErrorCode.INVALID_PUBLIC_APP_URL,
      'The public application URL is invalid.',
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(
      TransferQrErrorCode.INVALID_PUBLIC_APP_URL,
      'The public application URL is invalid.',
    );
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    return fail(
      TransferQrErrorCode.INVALID_PUBLIC_APP_URL,
      'The public application URL must be an HTTPS origin (or localhost HTTP for development).',
    );
  return url.origin;
}

function normalizeChainId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    return fail(TransferQrErrorCode.INVALID_CHAIN_ID, 'The QR chain ID is invalid.');
  return value;
}

function parseChainId(value: string) {
  if (!/^[1-9]\d*$/.test(value))
    return fail(TransferQrErrorCode.INVALID_CHAIN_ID, 'The QR chain ID is invalid.');
  return normalizeChainId(Number(value));
}

function normalizeContractAddress(value: unknown): string {
  if (typeof value !== 'string')
    return fail(
      TransferQrErrorCode.INVALID_CONTRACT_ADDRESS,
      'The CustodyTransfer address is invalid.',
    );
  try {
    return getAddress(value);
  } catch {
    return fail(
      TransferQrErrorCode.INVALID_CONTRACT_ADDRESS,
      'The CustodyTransfer address is invalid.',
    );
  }
}

function normalizeTransferId(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !isHexString(value, 32))
    return fail(
      TransferQrErrorCode.INVALID_TRANSFER_ID,
      'The custody transfer ID must be exactly 32 bytes.',
    );
  return value.toLowerCase() as `0x${string}`;
}

export function encodeTransferQrPayload(input: TransferQrEncodingInput): string {
  if (input.version !== 1)
    return fail(
      TransferQrErrorCode.UNSUPPORTED_QR_VERSION,
      'The custody transfer QR version is not supported.',
    );
  const origin = normalizePublicAppUrl(input.publicAppUrl);
  const chainId = normalizeChainId(input.chainId);
  const contract = normalizeContractAddress(input.custodyTransferAddress);
  const transferId = normalizeTransferId(input.transferId);
  return `${origin}${TRANSFER_RECEIPT_PATH}?v=1&chainId=${chainId}&contract=${contract}&transferId=${transferId}`;
}

export function decodeTransferQrPayload(
  value: string,
  options: TransferQrDecodingOptions,
): TransferQrPayload {
  if (typeof value !== 'string')
    return fail(
      TransferQrErrorCode.MALFORMED_QR_PAYLOAD,
      'The custody transfer QR payload is malformed.',
    );
  if (value.length > TRANSFER_QR_MAX_LENGTH)
    return fail(
      TransferQrErrorCode.PAYLOAD_TOO_LONG,
      'The custody transfer QR payload is too long.',
    );
  if (value.startsWith(`${LEGACY_PROTOCOL}//`)) {
    if (!options.allowLegacy)
      return fail(
        TransferQrErrorCode.MALFORMED_QR_PAYLOAD,
        'Legacy transfer links are accepted only by manual paste.',
      );
    return decodeLegacy(value);
  }
  const expectedOrigin = normalizePublicAppUrl(options.publicAppUrl);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(
      TransferQrErrorCode.MALFORMED_QR_PAYLOAD,
      'The custody transfer QR payload is malformed.',
    );
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.pathname !== TRANSFER_RECEIPT_PATH ||
    url.username ||
    url.password ||
    url.hash
  )
    return fail(
      TransferQrErrorCode.MALFORMED_QR_PAYLOAD,
      'The transfer link has an invalid location.',
    );
  if (url.origin !== expectedOrigin)
    return fail(
      TransferQrErrorCode.PUBLIC_APP_ORIGIN_MISMATCH,
      'The transfer link belongs to a different TraceChain deployment.',
    );
  validateParameters(url, REQUIRED_PARAMETERS);
  const keys = [...url.searchParams.keys()];
  if (keys.some((key, index) => key !== REQUIRED_PARAMETERS[index]))
    return fail(
      TransferQrErrorCode.NON_CANONICAL_PARAMETER_ORDER,
      'The transfer link parameters are not in canonical order.',
    );
  if (url.searchParams.get('v') !== '1')
    return fail(
      TransferQrErrorCode.UNSUPPORTED_QR_VERSION,
      'The custody transfer QR version is not supported.',
    );
  return parsedPayload(url);
}

function decodeLegacy(value: string): TransferQrPayload {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(
      TransferQrErrorCode.MALFORMED_QR_PAYLOAD,
      'The legacy transfer payload is malformed.',
    );
  }
  if (
    url.protocol !== LEGACY_PROTOCOL ||
    url.hostname !== 'transfer' ||
    url.pathname !== '/v1' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    return fail(
      TransferQrErrorCode.MALFORMED_QR_PAYLOAD,
      'The legacy transfer payload has an invalid location.',
    );
  validateParameters(url, ['chainId', 'contract', 'transferId']);
  return parsedPayload(url);
}

function validateParameters(url: URL, required: readonly string[]) {
  const allowed = new Set(required);
  for (const key of url.searchParams.keys())
    if (!allowed.has(key))
      return fail(
        TransferQrErrorCode.UNKNOWN_PARAMETER,
        'The transfer link contains an unknown parameter.',
      );
  for (const key of required) {
    const values = url.searchParams.getAll(key);
    if (!values.length)
      return fail(
        TransferQrErrorCode.MISSING_PARAMETER,
        'The transfer link is missing a required parameter.',
      );
    if (values.length > 1)
      return fail(
        TransferQrErrorCode.DUPLICATE_PARAMETER,
        'The transfer link contains a duplicate parameter.',
      );
  }
}

function parsedPayload(url: URL): TransferQrPayload {
  return {
    version: 1,
    chainId: parseChainId(url.searchParams.get('chainId')!),
    custodyTransferAddress: normalizeContractAddress(url.searchParams.get('contract')),
    transferId: normalizeTransferId(url.searchParams.get('transferId')),
  };
}
