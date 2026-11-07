import { BrowserProvider, getAddress } from 'ethers';

import { chainConfig } from '../../config/network';
import { sendPreparedTransaction, type PreparedTransaction } from '../blockchain/blockchain.api';

export class ProductionTransactionError extends Error {
  constructor(
    readonly code:
      | 'METAMASK_UNAVAILABLE'
      | 'REJECTED'
      | 'REVERTED'
      | 'RPC_ERROR'
      | 'WRONG_NETWORK'
      | 'WRONG_WALLET',
    message: string,
  ) {
    super(message);
  }
}

export async function submitProductionTransaction(
  transaction: PreparedTransaction,
  actorWallet: string,
) {
  if (!window.ethereum)
    throw new ProductionTransactionError(
      'METAMASK_UNAVAILABLE',
      'MetaMask is not available in this browser.',
    );
  if (transaction.chainId !== chainConfig.chainId)
    throw new ProductionTransactionError(
      'WRONG_NETWORK',
      `This transaction requires ${chainConfig.name}.`,
    );
  try {
    const provider = new BrowserProvider(window.ethereum);
    if ((await provider.getNetwork()).chainId !== BigInt(transaction.chainId))
      throw new ProductionTransactionError(
        'WRONG_NETWORK',
        `Switch MetaMask to ${chainConfig.name}.`,
      );
    const signer = await provider.getSigner();
    if (getAddress(await signer.getAddress()) !== getAddress(actorWallet))
      throw new ProductionTransactionError(
        'WRONG_WALLET',
        'Select the wallet used for the authenticated TraceChain session.',
      );
    const pending = await sendPreparedTransaction(signer, transaction);
    const receipt = await pending.wait();
    if (!receipt || receipt.status !== 1)
      throw new ProductionTransactionError(
        'REVERTED',
        'The blockchain transaction reverted. You can safely retry this workflow.',
      );
  } catch (error) {
    if (error instanceof ProductionTransactionError) throw error;
    const candidate = error as {
      code?: number | string;
      info?: { error?: { code?: number } };
      message?: string;
      shortMessage?: string;
    };
    if (
      candidate.code === 4001 ||
      candidate.code === 'ACTION_REJECTED' ||
      candidate.info?.error?.code === 4001
    )
      throw new ProductionTransactionError(
        'REJECTED',
        'The MetaMask request was cancelled. No later workflow step was submitted.',
      );
    if (
      candidate.code === 'CALL_EXCEPTION' ||
      /revert/i.test(candidate.message ?? '') ||
      /revert/i.test(candidate.shortMessage ?? '')
    )
      throw new ProductionTransactionError(
        'REVERTED',
        'The transaction reverted. Refresh the on-chain records and retry.',
      );
    throw new ProductionTransactionError(
      'RPC_ERROR',
      'MetaMask or the blockchain RPC could not complete the transaction.',
    );
  }
}

export async function completePreparedWorkflow<
  T extends { actorWallet: string; state: string; transaction?: PreparedTransaction },
>(prepare: () => Promise<T>): Promise<T> {
  const first = await prepare();
  if (first.state === 'COMPLETE') return first;
  if (!first.transaction) throw new Error('The API did not return the required transaction.');
  await submitProductionTransaction(first.transaction, first.actorWallet);
  const confirmed = await prepare();
  if (confirmed.state !== 'COMPLETE')
    throw new Error(
      'The transaction was mined, but the authoritative contract record was not found. Refresh and retry.',
    );
  return confirmed;
}
