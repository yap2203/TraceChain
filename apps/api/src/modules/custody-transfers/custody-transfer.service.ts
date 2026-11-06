import { TransferQrError, decodeTransferQrPayload } from '@tracechain/shared';
import { getAddress, id } from 'ethers';

import type { AuthService } from '../auth/auth.service.js';
import type { CustodyTransferGateway } from './custody-transfer.gateway.js';
import {
  prepareReceiptConfirmationRequestSchema,
  resolveTransferQrRequestSchema,
  transferIdParameterSchema,
} from './custody-transfer.schema.js';
import type {
  CustodyTransferConfiguration,
  CustodyTransferRecord,
  CustodyTransferSummary,
  PreparedCustodyTransferTransaction,
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
    const session = await this.requireAuthorizedSession(sessionId);

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

    const transfer = await this.lookupTransfer(qr.transferId);

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

    return safeSummary(qr.transferId, transfer);
  }

  async getTransfer(
    sessionId: string | undefined,
    parameters: unknown,
  ): Promise<CustodyTransferSummary> {
    const session = await this.requireAuthorizedSession(sessionId);
    const inputResult = transferIdParameterSchema.safeParse(parameters);
    if (!inputResult.success) {
      throw new CustodyTransferApiError('INVALID_REQUEST', 'The transfer ID is invalid.', 400);
    }

    const transfer = await this.lookupTransfer(inputResult.data.transferId);
    this.requireRecipient(session.address, transfer.recipient);
    return safeSummary(inputResult.data.transferId, transfer);
  }

  async prepareReceiptConfirmation(
    sessionId: string | undefined,
    body: unknown,
  ): Promise<PreparedCustodyTransferTransaction> {
    const session = await this.requireAuthorizedSession(sessionId);
    const inputResult = prepareReceiptConfirmationRequestSchema.safeParse(body);
    if (!inputResult.success) {
      throw new CustodyTransferApiError(
        'INVALID_REQUEST',
        inputResult.error.issues[0]?.message ?? 'The confirmation request is invalid.',
        400,
      );
    }

    const transferId = inputResult.data.transferId;
    const transfer = await this.lookupTransfer(transferId);
    if (transfer.status !== AWAITING_RECEIPT_STATUS) {
      throw new CustodyTransferApiError(
        'TRANSFER_NOT_AWAITING_RECEIPT',
        'The custody transfer is not awaiting receipt.',
        409,
      );
    }
    this.requireRecipient(session.address, transfer.recipient);

    const configuration = this.dependencies.configuration();
    return this.dependencies.gateway.prepareReceiptConfirmation({
      chainId: configuration.chainId,
      contractAddress: configuration.contractAddress,
      quantity: transfer.quantity,
      receiptHash: id(`tracechain:receipt:v1:${transferId}:${getAddress(transfer.recipient)}`),
      transferId,
    });
  }

  private async requireAuthorizedSession(sessionId: string | undefined) {
    const session = await this.dependencies.authService.requireSession(sessionId);
    const authorization = session.onChainAuthorization;
    if (authorization?.status !== 'AUTHORIZED') {
      throw new CustodyTransferApiError(
        'ON_CHAIN_AUTHORIZATION_REQUIRED',
        'Current on-chain company authorization is required.',
        403,
      );
    }
    return session;
  }

  private async lookupTransfer(transferId: string) {
    let transfer;
    try {
      transfer = await this.dependencies.gateway.getTransfer(transferId);
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
    return transfer;
  }

  private requireRecipient(sessionAddress: string, recipient: string) {
    if (getAddress(sessionAddress) !== getAddress(recipient)) {
      throw new CustodyTransferApiError(
        'INTENDED_RECIPIENT_REQUIRED',
        'Only the intended transfer recipient may access this transfer.',
        403,
      );
    }
  }
}

function safeSummary(transferId: string, transfer: CustodyTransferRecord): CustodyTransferSummary {
  return {
    dispatchedAt: safeTimestamp(transfer.dispatchedAt),
    expectedAt: safeTimestamp(transfer.expectedAt),
    productBatchId: transfer.productBatchId,
    quantity: transfer.quantity.toString(),
    recipient: getAddress(transfer.recipient),
    sender: getAddress(transfer.sender),
    status: transfer.status,
    transferId,
  };
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
