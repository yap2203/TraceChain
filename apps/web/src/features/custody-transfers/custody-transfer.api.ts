import type { ResolvedCustodyTransfer } from './custody-transfer.types';

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
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/custody-transfers/resolve-qr`, {
      body: JSON.stringify({ qrPayload }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
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

  return response.json() as Promise<ResolvedCustodyTransfer>;
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
    TRANSFER_NOT_FOUND: 'The referenced custody transfer was not found.',
  };

  return messages[error.code] ?? error.message;
}
