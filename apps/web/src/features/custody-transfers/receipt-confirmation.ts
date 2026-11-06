import { BrowserProvider, getAddress } from 'ethers';

import { sendPreparedTransaction } from '../blockchain/blockchain.api';
import type {
  PreparedReceiptConfirmation,
  ResolvedCustodyTransfer,
} from './custody-transfer.types';
import { loadTransferQrConfiguration } from './transfer-qr';

export class ReceiptConfirmationError extends Error {
  constructor(
    readonly code:
      | 'METAMASK_UNAVAILABLE'
      | 'WRONG_NETWORK'
      | 'WRONG_WALLET'
      | 'REJECTED'
      | 'REVERTED'
      | 'RPC_ERROR',
    message: string,
  ) {
    super(message);
  }
}

export async function submitReceiptConfirmation(
  transaction: PreparedReceiptConfirmation,
  transfer: ResolvedCustodyTransfer,
) {
  if (!window.ethereum) {
    throw new ReceiptConfirmationError(
      'METAMASK_UNAVAILABLE',
      'MetaMask is not available in this browser.',
    );
  }

  const configuration = loadTransferQrConfiguration();
  if (
    transaction.chainId !== configuration.chainId ||
    getAddress(transaction.to) !== getAddress(configuration.contractAddress)
  ) {
    throw new ReceiptConfirmationError(
      'WRONG_NETWORK',
      'The prepared transaction does not match the configured TraceChain network.',
    );
  }

  try {
    const provider = new BrowserProvider(window.ethereum);
    if ((await provider.getNetwork()).chainId !== BigInt(configuration.chainId)) {
      throw new ReceiptConfirmationError(
        'WRONG_NETWORK',
        `MetaMask must be connected to ${configuration.chainId} before confirming receipt.`,
      );
    }
    const signer = await provider.getSigner();
    if (getAddress(await signer.getAddress()) !== getAddress(transfer.recipient)) {
      throw new ReceiptConfirmationError(
        'WRONG_WALLET',
        'MetaMask is using a different wallet. Select the transfer recipient account and retry.',
      );
    }

    const pending = await sendPreparedTransaction(signer, transaction);
    const receipt = await pending.wait();
    if (!receipt || receipt.status !== 1) {
      throw new ReceiptConfirmationError(
        'REVERTED',
        'The receipt transaction reverted and the transfer was not confirmed.',
      );
    }
  } catch (error) {
    if (error instanceof ReceiptConfirmationError) throw error;
    if (isUserRejection(error)) {
      throw new ReceiptConfirmationError(
        'REJECTED',
        'The MetaMask transaction was cancelled. The transfer remains awaiting receipt.',
      );
    }
    if (isRevert(error)) {
      throw new ReceiptConfirmationError(
        'REVERTED',
        'The receipt transaction reverted and the transfer was not confirmed.',
      );
    }
    throw new ReceiptConfirmationError(
      'RPC_ERROR',
      'MetaMask or the blockchain RPC could not complete the receipt transaction.',
    );
  }
}

export function receiptConfirmationMessage(error: unknown) {
  if (error instanceof ReceiptConfirmationError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The receipt could not be confirmed. Try again.';
}

function isUserRejection(error: unknown) {
  const candidate = error as { code?: number | string; info?: { error?: { code?: number } } };
  return (
    candidate?.code === 4001 ||
    candidate?.code === 'ACTION_REJECTED' ||
    candidate?.info?.error?.code === 4001
  );
}

function isRevert(error: unknown) {
  const candidate = error as { code?: string; message?: string; shortMessage?: string };
  return (
    candidate?.code === 'CALL_EXCEPTION' ||
    /revert/i.test(candidate?.shortMessage ?? '') ||
    /revert/i.test(candidate?.message ?? '')
  );
}
