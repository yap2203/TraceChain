import { getAddress, isHexString } from 'ethers';

const TRANSFER_QR_PROTOCOL = 'tracechain:';
const TRANSFER_QR_RESOURCE = 'transfer';
const TRANSFER_QR_PATH = '/v1';
const TRANSFER_QR_MAX_LENGTH = 512;
const REQUIRED_PARAMETERS = ['chainId', 'contract', 'transferId'] as const;

export const TransferQrErrorCode = {
  MALFORMED_QR_PAYLOAD: 'MALFORMED_QR_PAYLOAD',
  UNSUPPORTED_QR_VERSION: 'UNSUPPORTED_QR_VERSION',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  DUPLICATE_PARAMETER: 'DUPLICATE_PARAMETER',
  UNKNOWN_PARAMETER: 'UNKNOWN_PARAMETER',
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

export class TransferQrError extends Error {
  readonly code: TransferQrErrorCodeValue;

  constructor(code: TransferQrErrorCodeValue, message: string) {
    super(message);
    this.name = 'TransferQrError';
    this.code = code;
  }
}

function fail(code: TransferQrErrorCodeValue, message: string): never {
  throw new TransferQrError(code, message);
}

function normalizeChainId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return fail(TransferQrErrorCode.INVALID_CHAIN_ID, 'The QR chain ID is invalid.');
  }

  return value;
}

function parseChainId(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    return fail(TransferQrErrorCode.INVALID_CHAIN_ID, 'The QR chain ID is invalid.');
  }

  return normalizeChainId(Number(value));
}

function normalizeContractAddress(value: unknown): string {
  if (typeof value !== 'string') {
    return fail(
      TransferQrErrorCode.INVALID_CONTRACT_ADDRESS,
      'The CustodyTransfer contract address is invalid.',
    );
  }

  try {
    return getAddress(value);
  } catch {
    return fail(
      TransferQrErrorCode.INVALID_CONTRACT_ADDRESS,
      'The CustodyTransfer contract address is invalid.',
    );
  }
}

function normalizeTransferId(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !isHexString(value, 32)) {
    return fail(
      TransferQrErrorCode.INVALID_TRANSFER_ID,
      'The custody transfer ID must be exactly 32 bytes.',
    );
  }

  return value.toLowerCase() as `0x${string}`;
}

export function encodeTransferQrPayload(payload: TransferQrPayload): string {
  if (payload.version !== 1) {
    return fail(
      TransferQrErrorCode.UNSUPPORTED_QR_VERSION,
      'The custody transfer QR version is not supported.',
    );
  }

  const chainId = normalizeChainId(payload.chainId);
  const contractAddress = normalizeContractAddress(payload.custodyTransferAddress);
  const transferId = normalizeTransferId(payload.transferId);

  return `${TRANSFER_QR_PROTOCOL}//${TRANSFER_QR_RESOURCE}${TRANSFER_QR_PATH}?chainId=${chainId}&contract=${contractAddress}&transferId=${transferId}`;
}

export function decodeTransferQrPayload(value: string): TransferQrPayload {
  if (typeof value !== 'string') {
    return fail(
      TransferQrErrorCode.MALFORMED_QR_PAYLOAD,
      'The custody transfer QR payload is malformed.',
    );
  }

  if (value.length > TRANSFER_QR_MAX_LENGTH) {
    return fail(
      TransferQrErrorCode.PAYLOAD_TOO_LONG,
      'The custody transfer QR payload is too long.',
    );
  }

  if (!value.startsWith(`${TRANSFER_QR_PROTOCOL}//${TRANSFER_QR_RESOURCE}`)) {
    return fail(
      TransferQrErrorCode.MALFORMED_QR_PAYLOAD,
      'The custody transfer QR payload has an invalid location.',
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(
      TransferQrErrorCode.MALFORMED_QR_PAYLOAD,
      'The custody transfer QR payload is malformed.',
    );
  }

  if (
    url.protocol !== TRANSFER_QR_PROTOCOL ||
    url.hostname !== TRANSFER_QR_RESOURCE ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.hash !== ''
  ) {
    return fail(
      TransferQrErrorCode.MALFORMED_QR_PAYLOAD,
      'The custody transfer QR payload has an invalid location.',
    );
  }

  if (url.pathname !== TRANSFER_QR_PATH) {
    return fail(
      TransferQrErrorCode.UNSUPPORTED_QR_VERSION,
      'The custody transfer QR version is not supported.',
    );
  }

  const allowedParameters = new Set<string>(REQUIRED_PARAMETERS);
  for (const key of url.searchParams.keys()) {
    if (!allowedParameters.has(key)) {
      return fail(
        TransferQrErrorCode.UNKNOWN_PARAMETER,
        'The custody transfer QR payload contains an unknown parameter.',
      );
    }
  }

  for (const key of REQUIRED_PARAMETERS) {
    const values = url.searchParams.getAll(key);
    if (values.length === 0) {
      return fail(
        TransferQrErrorCode.MISSING_PARAMETER,
        'The custody transfer QR payload is missing a required parameter.',
      );
    }
    if (values.length > 1) {
      return fail(
        TransferQrErrorCode.DUPLICATE_PARAMETER,
        'The custody transfer QR payload contains a duplicate parameter.',
      );
    }
  }

  const chainId = parseChainId(url.searchParams.get('chainId')!);
  const custodyTransferAddress = normalizeContractAddress(url.searchParams.get('contract'));
  const transferId = normalizeTransferId(url.searchParams.get('transferId'));

  return {
    version: 1,
    chainId,
    custodyTransferAddress,
    transferId,
  };
}
