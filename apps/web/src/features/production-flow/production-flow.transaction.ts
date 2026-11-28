import { BrowserProvider, getAddress } from 'ethers';
import { notify } from '../../components/ui/feedback';

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
    readonly phase?: 'simulation' | 'mined' | 'submission',
  ) {
    super(message);
  }
}

export class WorkflowRefreshPendingError<TPrepared = unknown> extends Error {
  readonly code = 'CONFIRMATION_REFRESH_PENDING';
  readonly confirmationSucceeded = true;

  constructor(readonly prepared?: TPrepared) {
    super(
      'The blockchain transaction was confirmed, but TraceChain could not refresh the authoritative record. Use Refresh records; do not submit the transaction again.',
    );
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
    if (!receipt)
      throw new ProductionTransactionError(
        'RPC_ERROR',
        'The transaction was sent, but its confirmation is unavailable. Check MetaMask activity and refresh records before submitting again.',
        'submission',
      );
    if (receipt.status !== 1)
      throw new ProductionTransactionError(
        'REVERTED',
        'The mined blockchain transaction failed. Refresh the record before deciding whether to retry.',
        'mined',
      );
    notify('Blockchain transaction confirmed.', 'success');
    for (const next of transaction.nextTransactions ?? []) {
      notify('Confirm the shared proof reference in MetaMask to complete publication.', 'info');
      await submitProductionTransaction(next, actorWallet);
    }
  } catch (error) {
    if (error instanceof ProductionTransactionError) throw error;
    const candidate = error as {
      code?: number | string;
      info?: { error?: { code?: number } };
      message?: string;
      shortMessage?: string;
      action?: string;
      receipt?: { status?: number };
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
    if (candidate.code === 'CALL_EXCEPTION') {
      const phase =
        candidate.receipt?.status === 0
          ? 'mined'
          : candidate.action === 'estimateGas' || candidate.action === 'call'
            ? 'simulation'
            : 'submission';
      throw new ProductionTransactionError(
        'REVERTED',
        phase === 'mined'
          ? 'The mined blockchain transaction failed. Refresh the record before deciding whether to retry.'
          : phase === 'simulation'
            ? 'Transaction simulation failed before submission. Refresh the record and check its stock, times, locations and permissions. No transaction was submitted.'
            : 'The blockchain rejected the transaction request. Check MetaMask activity and refresh the record before retrying.',
        phase,
      );
    }
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
  let confirmed: T;
  try {
    confirmed = await prepare();
  } catch {
    throw new WorkflowRefreshPendingError(first);
  }
  if (confirmed.state !== 'COMPLETE') throw new WorkflowRefreshPendingError(first);
  return confirmed;
}
