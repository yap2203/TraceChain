import type {
  AdminCustodyDiscrepancy,
  PreparedDiscrepancyResolution,
  PreparedReceiptAction,
  ReceiptEvidenceUpload,
  ResolvedCustodyTransfer,
} from './custody-transfer.types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export class CustodyTransferResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function resolveTransferQr(qrPayload: string): Promise<ResolvedCustodyTransfer> {
  return custodyTransferRequest('/resolve-qr', {
    body: JSON.stringify({ qrPayload }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

export function prepareReceiptConfirmation(input: {
  actualArrivalAt?: string;
  actualQuantity: string;
  damagedQuantity: string;
  evidence: ReceiptEvidenceUpload[];
  notes: string;
  rejectedQuantity: string;
  transferId: string;
}): Promise<PreparedReceiptAction> {
  return custodyTransferRequest('/transactions/confirm-receipt', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

export function prepareTransferRejection(input: {
  evidence: ReceiptEvidenceUpload[];
  reason: string;
  reasonType: 'COMPLETE_REJECTION' | 'SHIPMENT_REFUSED' | 'WRONG_PRODUCT';
  transferId: string;
}): Promise<PreparedReceiptAction> {
  return custodyTransferRequest('/transactions/reject', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

export function getCustodyTransfer(transferId: string): Promise<ResolvedCustodyTransfer> {
  return custodyTransferRequest(`/${encodeURIComponent(transferId)}`);
}

export async function getCustodyDiscrepancies(): Promise<AdminCustodyDiscrepancy[]> {
  const response = await custodyTransferRequest<{ discrepancies: AdminCustodyDiscrepancy[] }>(
    '/discrepancies',
  );
  return response.discrepancies;
}

export function prepareDiscrepancyResolution(input: {
  acceptActual: boolean;
  reason: string;
  transferId: string;
}): Promise<PreparedDiscrepancyResolution> {
  return custodyTransferRequest('/transactions/resolve-discrepancy', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

async function custodyTransferRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/custody-transfers${path}`, {
      ...init,
      credentials: 'include',
    });
  } catch {
    throw new CustodyTransferResolutionError(
      'NETWORK_ERROR',
      'TraceChain could not reach the transfer service.',
      0,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new CustodyTransferResolutionError(
      body.error?.code ?? 'TRANSFER_RESOLUTION_FAILED',
      body.error?.message ?? 'The transfer could not be verified.',
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

export function transferResolutionMessage(error: unknown) {
  if (!(error instanceof CustodyTransferResolutionError)) {
    return 'The transfer could not be verified. Try again.';
  }

  const messages: Record<string, string> = {
    AUTHENTICATION_REQUIRED: 'Your wallet session has expired. Sign in again before scanning.',
    CREDENTIAL_AUTHORIZATION_REQUIRED:
      'Your wallet does not currently have an authorized Company Role Credential.',
    INTENDED_RECIPIENT_REQUIRED: 'This transfer is assigned to a different recipient wallet.',
    INVALID_REQUEST: 'The QR request is invalid. Select or paste a complete QR payload.',
    INVALID_TRANSFER_QR: 'This is not a valid TraceChain custody-transfer QR code.',
    NETWORK_ERROR: 'TraceChain could not reach the transfer service. Check your connection.',
    QR_CHAIN_MISMATCH: 'This QR code belongs to a different blockchain network.',
    QR_CONTRACT_MISMATCH: 'This QR code belongs to a different CustodyTransfer deployment.',
    TRANSFER_LOOKUP_UNAVAILABLE:
      'The blockchain transfer service is temporarily unavailable. Try again later.',
    TRANSFER_NOT_AWAITING_RECEIPT: 'This transfer has already been processed or is no longer open.',
    TRANSFER_ALREADY_RECEIVED: 'This shipment has already been received on-chain.',
    TRANSFER_CANCELLED: 'This shipment was cancelled and cannot be received.',
    TRANSFER_REJECTED: 'This shipment was rejected and cannot be received.',
    TRANSFER_DISCREPANCY_REPORTED: 'A receipt discrepancy is already under review.',
    RECEIPT_ROLE_REQUIRED: 'An active Distributor or Retailer recipient credential is required.',
    RECEIVE_TRANSFER_PERMISSION_REQUIRED:
      'Your company is not currently permitted to receive transfers.',
    RECEIPT_AUTHORIZATION_UNAVAILABLE:
      'TraceChain could not check receipt permission. Try again later.',
    TRANSFER_NOT_FOUND: 'The referenced custody transfer was not found.',
  };

  return messages[error.code] ?? error.message;
}
