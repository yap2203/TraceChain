export interface MinedBlockTime {
  number: number;
  timestamp: number;
}

export class BlockchainTimeWaitError extends Error {
  readonly status = 409;
  constructor(readonly code: 'BLOCKCHAIN_TIME_TIMEOUT' | 'HANDOFF_CANCELLED') {
    super(
      code === 'HANDOFF_CANCELLED'
        ? 'Handoff preparation cancelled. The captured handoff time is preserved for retry.'
        : 'Blockchain time has not caught up yet. Retry the handoff using its saved time; no transaction was submitted.',
    );
  }
}

/** Wait for mined time without changing the physical event time or retrying a transaction. */
export async function waitForMinedBlockTime(
  readLatest: () => Promise<MinedBlockTime>,
  occurredAt: number,
  options: {
    signal?: AbortSignal;
    onWaiting?: () => void;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<MinedBlockTime> {
  if (!Number.isSafeInteger(occurredAt) || occurredAt <= 0)
    throw new Error('Invalid handoff timestamp.');
  const controller = new AbortController();
  const cancel = () => controller.abort(new BlockchainTimeWaitError('HANDOFF_CANCELLED'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(
    () => controller.abort(new BlockchainTimeWaitError('BLOCKCHAIN_TIME_TIMEOUT')),
    options.timeoutMs ?? 30_000,
  );
  const signal = controller.signal;
  // Release listeners even if a provider completes its read after cancellation/timeout.
  const cancellable = async <T>(work: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    let abort!: () => void;
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([work(), stopped]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  };
  let notified = false;
  try {
    while (true) {
      const block = await cancellable(readLatest);
      signal.throwIfAborted();
      if (
        !Number.isSafeInteger(block.number) ||
        block.number < 0 ||
        !Number.isSafeInteger(block.timestamp) ||
        block.timestamp <= 0
      )
        throw new Error('The latest mined block is unavailable.');
      if (block.timestamp >= occurredAt) return block;
      if (!notified) {
        options.onWaiting?.();
        notified = true;
      }
      let delay: ReturnType<typeof setTimeout> | undefined;
      try {
        await cancellable(
          () =>
            new Promise<void>((resolve) => {
              delay = setTimeout(resolve, Math.max(1_000, options.pollIntervalMs ?? 3_000));
            }),
        );
      } finally {
        clearTimeout(delay);
      }
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
