import { BrowserProvider, getAddress, Interface } from 'ethers';
import { BlockchainTimeWaitError, waitForMinedBlockTime } from '@tracechain/shared';
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
  options: {
    signal?: AbortSignal;
    onPhase?: (phase: 'waiting' | 'simulating' | 'submitting') => void;
  } = {},
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
  let submissionStarted = false;
  try {
    const provider = new BrowserProvider(window.ethereum);
    if ((await provider.getNetwork()).chainId !== BigInt(transaction.chainId))
      throw new ProductionTransactionError(
        'WRONG_NETWORK',
        `Switch MetaMask to ${chainConfig.name}.`,
      );
    let signer = await provider.getSigner();
    if (getAddress(await signer.getAddress()) !== getAddress(actorWallet))
      throw new ProductionTransactionError(
        'WRONG_WALLET',
        'Select the wallet used for the authenticated TraceChain session.',
      );
    if (transaction.notBeforeTimestamp !== undefined) {
      const block = await waitForMinedBlockTime(
        async () => {
          const header = await provider.send('eth_getBlockByNumber', ['latest', false]);
          return {
            number: Number(BigInt(header.number)),
            timestamp: Number(BigInt(header.timestamp)),
          };
        },
        transaction.notBeforeTimestamp,
        { signal: options.signal, onWaiting: () => options.onPhase?.('waiting') },
      );
      options.signal?.throwIfAborted();
      options.onPhase?.('simulating');
      if ((await provider.getNetwork()).chainId !== BigInt(transaction.chainId))
        throw new ProductionTransactionError(
          'WRONG_NETWORK',
          `Switch MetaMask to ${chainConfig.name}.`,
        );
      signer = await provider.getSigner();
      if (getAddress(await signer.getAddress()) !== getAddress(actorWallet))
        throw new ProductionTransactionError(
          'WRONG_WALLET',
          'Select the wallet used for the authenticated TraceChain session.',
        );
      try {
        await provider.send('eth_call', [
          {
            from: actorWallet,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
          },
          `0x${block.number.toString(16)}`,
        ]);
      } catch (error) {
        const failure = error as { data?: string; info?: { error?: { data?: string } } };
        let name: string | undefined;
        try {
          name = new Interface(transaction.simulationErrors ?? []).parseError(
            failure.data ?? failure.info?.error?.data ?? '0x',
          )?.name;
        } catch {
          /* No known ABI error: preserve RPC/revert classification below. */
        }
        const reasons: Record<string, string> = {
          InvalidInput:
            'Check product validity, production/arrival times, locations and whether this transfer already exists.',
          InvalidState: 'Refresh the product and pickup location state.',
          InsufficientInventory: 'Refresh available stock at the pickup location.',
          Unauthorized: 'Check current sender/recipient roles, credentials and permissions.',
        };
        if (name && reasons[name])
          throw new ProductionTransactionError(
            'REVERTED',
            `Handoff simulation rejected (${name}). ${reasons[name]} No transaction was submitted.`,
            'simulation',
          );
        throw error;
      }
    }
    options.signal?.throwIfAborted();
    options.onPhase?.('submitting');
    submissionStarted = true;
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
    if (options.signal?.aborted && !submissionStarted)
      throw new BlockchainTimeWaitError('HANDOFF_CANCELLED');
    if (error instanceof BlockchainTimeWaitError) throw error;
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
