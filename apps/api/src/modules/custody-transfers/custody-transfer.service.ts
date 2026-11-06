import { TransferQrError, decodeTransferQrPayload } from '@tracechain/shared';
import { getAddress } from 'ethers';

import type { AuthService } from '../auth/auth.service.js';
import type { CustodyTransferGateway } from './custody-transfer.gateway.js';
import { resolveTransferQrRequestSchema } from './custody-transfer.schema.js';
import type {
  CustodyTransferConfiguration,
  CustodyTransferSummary,
} from './custody-transfer.types.js';

const AWAITING_RECEIPT_STATUS = 1;

export class CustodyTransferApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface CustodyTransferServiceDependencies {
  authService: AuthService;
  configuration: () => CustodyTransferConfiguration;
  gateway: CustodyTransferGateway;
}

export class CustodyTransferService {
  constructor(private readonly dependencies: CustodyTransferServiceDependencies) {}

  async resolveQr(sessionId: string | undefined, body: unknown): Promise<CustodyTransferSummary> {
    const session = await this.dependencies.authService.requireSession(sessionId);
    const authorization = session.credentialVerification;
    if (
      !authorization?.locallyVerified ||
      !authorization.onChainStatusChecked ||
      !authorization.authorizationReady
    ) {
      throw new CustodyTransferApiError(
        'CREDENTIAL_AUTHORIZATION_REQUIRED',
        'An active Company Role Credential and blockchain authorization are required.',
        403,
      );
    }

    const inputResult = resolveTransferQrRequestSchema.safeParse(body);
    if (!inputResult.success) {
      throw new CustodyTransferApiError(
        'INVALID_REQUEST',
        inputResult.error.issues[0]?.message ?? 'The QR resolution request is invalid.',
        400,
      );
    }

    const input = inputResult.data;
    let qr;
    try {
      qr = decodeTransferQrPayload(input.qrPayload);
    } catch (error) {
      if (error instanceof TransferQrError) {
        throw new CustodyTransferApiError(
          'INVALID_TRANSFER_QR',
          'The custody-transfer QR payload is invalid.',
          400,
        );
      }
      throw error;
    }

    const configuration = this.dependencies.configuration();
    if (qr.chainId !== configuration.chainId) {
      throw new CustodyTransferApiError(
        'QR_CHAIN_MISMATCH',
        'The QR code is for a different blockchain network.',
        400,
      );
    }

    if (getAddress(qr.custodyTransferAddress) !== getAddress(configuration.contractAddress)) {
      throw new CustodyTransferApiError(
        'QR_CONTRACT_MISMATCH',
        'The QR code does not reference the configured CustodyTransfer contract.',
        400,
      );
    }

    let transfer;
    try {
      transfer = await this.dependencies.gateway.getTransfer(qr.transferId);
    } catch {
      throw new CustodyTransferApiError(
        'TRANSFER_LOOKUP_UNAVAILABLE',
        'The custody transfer could not be retrieved.',
        502,
      );
    }

    if (!transfer) {
      throw new CustodyTransferApiError(
        'TRANSFER_NOT_FOUND',
        'The referenced custody transfer does not exist.',
        404,
      );
    }

    if (transfer.status !== AWAITING_RECEIPT_STATUS) {
      throw new CustodyTransferApiError(
        'TRANSFER_NOT_AWAITING_RECEIPT',
        'The custody transfer is not awaiting receipt.',
        409,
      );
    }

    if (getAddress(session.address) !== getAddress(transfer.recipient)) {
      throw new CustodyTransferApiError(
        'INTENDED_RECIPIENT_REQUIRED',
        'Only the intended transfer recipient may resolve this QR code.',
        403,
      );
    }

    return {
      dispatchedAt: safeTimestamp(transfer.dispatchedAt),
      expectedAt: safeTimestamp(transfer.expectedAt),
      productBatchId: transfer.productBatchId,
      quantity: transfer.quantity.toString(),
      recipient: getAddress(transfer.recipient),
      sender: getAddress(transfer.sender),
      status: AWAITING_RECEIPT_STATUS,
      transferId: qr.transferId,
    };
  }
}

function safeTimestamp(value: bigint) {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new CustodyTransferApiError(
      'INVALID_TRANSFER_RECORD',
      'The custody transfer record is invalid.',
      502,
    );
  }
  return timestamp;
}
