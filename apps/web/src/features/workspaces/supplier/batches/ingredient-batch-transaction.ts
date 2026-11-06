import { BrowserProvider, getAddress } from 'ethers';

import { chainConfig } from '../../../../config/network';
import {
  sendPreparedTransaction,
  type PreparedTransaction,
} from '../../../blockchain/blockchain.api';

export class IngredientBatchTransactionError extends Error {
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

export async function submitIngredientBatchTransaction(
  transaction: PreparedTransaction,
  supplierWallet: string,
) {
  if (!window.ethereum) {
    throw new IngredientBatchTransactionError(
      'METAMASK_UNAVAILABLE',
      'MetaMask is not available in this browser.',
    );
  }
  if (transaction.chainId !== chainConfig.chainId) {
    throw new IngredientBatchTransactionError(
      'WRONG_NETWORK',
      `This transaction requires ${chainConfig.name}. Switch MetaMask and try again.`,
    );
  }

  try {
    const provider = new BrowserProvider(window.ethereum);
    if ((await provider.getNetwork()).chainId !== BigInt(transaction.chainId)) {
      throw new IngredientBatchTransactionError(
        'WRONG_NETWORK',
        `MetaMask must be connected to ${chainConfig.name}.`,
      );
    }
    const signer = await provider.getSigner();
    if (getAddress(await signer.getAddress()) !== getAddress(supplierWallet)) {
      throw new IngredientBatchTransactionError(
        'WRONG_WALLET',
        'MetaMask is using a different wallet. Select the authenticated Supplier wallet and retry.',
      );
    }
    const pending = await sendPreparedTransaction(signer, transaction);
    const receipt = await pending.wait();
    if (!receipt || receipt.status !== 1) {
      throw new IngredientBatchTransactionError(
        'REVERTED',
        'The transaction reverted. The workflow can be resumed safely.',
      );
    }
  } catch (error) {
    if (error instanceof IngredientBatchTransactionError) throw error;
    const candidate = error as {
      code?: number | string;
      info?: { error?: { code?: number } };
      message?: string;
      shortMessage?: string;
    };
    if (
      candidate?.code === 4001 ||
      candidate?.code === 'ACTION_REJECTED' ||
      candidate?.info?.error?.code === 4001
    ) {
      throw new IngredientBatchTransactionError(
        'REJECTED',
        'The MetaMask transaction was cancelled. No later workflow step was submitted.',
      );
    }
    if (
      candidate?.code === 'CALL_EXCEPTION' ||
      /revert/i.test(candidate?.message ?? '') ||
      /revert/i.test(candidate?.shortMessage ?? '')
    ) {
      throw new IngredientBatchTransactionError(
        'REVERTED',
        'The transaction reverted. Review the Supplier permissions and batch details, then retry.',
      );
    }
    throw new IngredientBatchTransactionError(
      'RPC_ERROR',
      'MetaMask or the blockchain RPC could not complete the transaction. The workflow can be resumed.',
    );
  }
}
