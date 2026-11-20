import {
  JsonRpcProvider,
  type JsonRpcApiProviderOptions,
  type JsonRpcPayload,
  type JsonRpcResult,
} from 'ethers';

const providers = new Map<string, JsonRpcProvider>();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const reads = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_getCode',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getBalance',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
]);

export interface RpcPerformanceMetrics {
  batches: number;
  deduplicatedRequests: number;
  logicalRequests: number;
  maxQueueWaitMs: number;
  queueWaitMs: number;
  rateLimitErrors: number;
  requestDurationMs: number;
  retries: number;
  transports: number;
}

export interface RpcTransportConfiguration {
  batchMaxCount: number;
  batchStallTimeMs: number;
  bulkConcurrency: number;
  concurrency: number;
  maxRetries: number;
  minRequestIntervalMs: number;
  retryBaseDelayMs: number;
}

const metrics: RpcPerformanceMetrics = emptyMetrics();

/** A process-local snapshot suitable for diagnostics and regression benchmarks. */
export function getRpcPerformanceMetrics(): RpcPerformanceMetrics {
  return { ...metrics };
}

/** Test/benchmark helper; production code should normally retain process-lifetime totals. */
export function resetRpcPerformanceMetrics() {
  Object.assign(metrics, emptyMetrics());
}

/** One measured transport per configured network, shared by all API contract gateways. */
export function blockchainProvider(url: string, chainId: number): JsonRpcProvider {
  const configuration = rpcConfiguration(chainId);
  const key = `${chainId}:${url}:${JSON.stringify(configuration)}`;
  let provider = providers.get(key);
  if (!provider) {
    provider = new ApiRpcProvider(
      url,
      chainId,
      {
        staticNetwork: true,
        batchMaxCount: configuration.batchMaxCount,
        batchStallTime: configuration.batchStallTimeMs,
      },
      configuration,
    );
    providers.set(key, provider);
  }
  return provider;
}

export class ApiRpcProvider extends JsonRpcProvider {
  private readonly inFlight = new Map<string, Promise<JsonRpcResult>>();
  private readonly scheduler: PriorityRpcScheduler;
  private readonly configuration: RpcTransportConfiguration;

  constructor(
    url: string,
    network: number,
    options: JsonRpcApiProviderOptions = {},
    configuration: RpcTransportConfiguration = rpcConfiguration(network),
  ) {
    super(url, network, options);
    this.configuration = configuration;
    this.scheduler = new PriorityRpcScheduler(configuration);
  }

  override async _send(
    payload: JsonRpcPayload | Array<JsonRpcPayload>,
  ): Promise<Array<JsonRpcResult>> {
    const entries = Array.isArray(payload) ? payload : [payload];
    if (entries.some((entry) => !reads.has(entry.method))) {
      // Never batch, retry or coalesce transaction submissions. Each JSON-RPC
      // request reaches the node at most once from this transport.
      const results: JsonRpcResult[] = [];
      for (const entry of entries) {
        if (reads.has(entry.method)) results.push(...(await this.sendReads([entry])));
        else results.push(...(await this.perform(entry, false, false, 1)));
      }
      return results;
    }
    return this.sendReads(entries);
  }

  private async sendReads(entries: JsonRpcPayload[]): Promise<JsonRpcResult[]> {
    const promises = new Map<number | string, Promise<JsonRpcResult>>();
    const fresh = new Map<string, JsonRpcPayload>();
    for (const payload of entries) {
      const key = requestKey(payload);
      const pending = this.inFlight.get(key);
      if (pending) {
        metrics.deduplicatedRequests += 1;
        promises.set(payload.id, pending);
      } else if (fresh.has(key)) {
        metrics.deduplicatedRequests += 1;
      } else fresh.set(key, payload);
    }

    for (const bulk of [false, true]) {
      const group = [...fresh.entries()].filter(
        ([, payload]) => (payload.method === 'eth_getLogs') === bulk,
      );
      if (!group.length) continue;
      const payloads = group.map(([, payload]) => payload);
      let operation = this.perform(
        payloads.length === 1 ? payloads[0] : payloads,
        true,
        bulk,
        payloads.length,
      );
      if (payloads.length > 1)
        operation = operation
          .then((results) => {
            const unsupported = results.find(isBatchUnsupported);
            if (unsupported) throw unsupported;
            return results;
          })
          .catch(async (error) => {
            if (!isBatchUnsupported(error)) throw error;
            const individual = await Promise.all(
              payloads.map((entry) => this.perform(entry, true, bulk, 0)),
            );
            return individual.flat();
          });
      if (payloads.length > 1) metrics.batches += 1;
      for (const [key, payload] of group) {
        const pending = operation.then((results) => {
          const result =
            results.find((candidate) => candidate.id === payload.id) ??
            (payloads.length === 1 ? results[0] : undefined);
          if (!result) throw new Error('The RPC provider omitted a batched response.');
          return result;
        });
        this.inFlight.set(key, pending);
        promises.set(payload.id, pending);
        const cleanup = () => {
          if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
        };
        void pending.then(cleanup, cleanup);
      }
    }

    // Point duplicate entries in the same batch to the first fresh request.
    for (const payload of entries) {
      if (promises.has(payload.id)) continue;
      const source = fresh.get(requestKey(payload));
      const pending = source ? promises.get(source.id) : this.inFlight.get(requestKey(payload));
      if (pending) promises.set(payload.id, pending);
    }
    return Promise.all(
      entries.map(async (payload) => {
        const result = await promises.get(payload.id);
        if (!result) throw new Error('The RPC request was not scheduled.');
        return { ...result, id: payload.id };
      }),
    );
  }

  private async perform(
    payload: JsonRpcPayload | JsonRpcPayload[],
    read: boolean,
    bulk: boolean,
    logicalRequests: number,
  ): Promise<Array<JsonRpcResult>> {
    metrics.logicalRequests += logicalRequests;
    for (let attempt = 0; ; attempt++) {
      let measured: ScheduledResult<Array<JsonRpcResult>>;
      metrics.transports += 1;
      try {
        measured = await this.scheduler.run(() => super._send(payload), bulk);
      } catch (error) {
        if (!read || !isThrottled(error)) throw error;
        metrics.rateLimitErrors += 1;
        if (attempt >= this.configuration.maxRetries) throw error;
        metrics.retries += 1;
        await wait(this.configuration.retryBaseDelayMs * 2 ** attempt);
        continue;
      }
      metrics.queueWaitMs += measured.queueWaitMs;
      metrics.maxQueueWaitMs = Math.max(metrics.maxQueueWaitMs, measured.queueWaitMs);
      metrics.requestDurationMs += measured.durationMs;
      if (!read || !measured.value.some((entry) => isThrottled(entry))) return measured.value;
      metrics.rateLimitErrors += 1;
      if (attempt >= this.configuration.maxRetries) return measured.value;
      metrics.retries += 1;
      await wait(this.configuration.retryBaseDelayMs * 2 ** attempt);
    }
  }
}

interface ScheduledResult<T> {
  durationMs: number;
  queueWaitMs: number;
  value: T;
}

interface QueueEntry<T> {
  bulk: boolean;
  enqueuedAt: number;
  reject(error: unknown): void;
  resolve(value: ScheduledResult<T>): void;
  task(): Promise<T>;
}

class PriorityRpcScheduler {
  private active = 0;
  private activeBulk = 0;
  private nextStartAt = 0;
  private queue: QueueEntry<unknown>[] = [];
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly configuration: RpcTransportConfiguration) {}

  run<T>(task: () => Promise<T>, bulk: boolean): Promise<ScheduledResult<T>> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        bulk,
        enqueuedAt: Date.now(),
        reject,
        resolve: (value) => resolve(value as ScheduledResult<T>),
        task,
      });
      this.drain();
    });
  }

  private drain() {
    if (this.timer || this.active >= this.configuration.concurrency) return;
    const index = this.queue.findIndex(
      (entry) => !entry.bulk || this.activeBulk < this.configuration.bulkConcurrency,
    );
    if (index < 0) return;
    const delay = Math.max(0, this.nextStartAt - Date.now());
    if (delay) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.drain();
      }, delay);
      return;
    }
    const entry = this.queue.splice(index, 1)[0];
    this.active += 1;
    if (entry.bulk) this.activeBulk += 1;
    const startedAt = Date.now();
    this.nextStartAt = startedAt + this.configuration.minRequestIntervalMs;
    void entry
      .task()
      .then((value) =>
        entry.resolve({
          durationMs: Date.now() - startedAt,
          queueWaitMs: startedAt - entry.enqueuedAt,
          value,
        }),
      )
      .catch(entry.reject)
      .finally(() => {
        this.active -= 1;
        if (entry.bulk) this.activeBulk -= 1;
        this.drain();
      });
    this.drain();
  }
}

function rpcConfiguration(chainId: number): RpcTransportConfiguration {
  const local = chainId === 31_337;
  const concurrency = integerEnvironment('RPC_READ_CONCURRENCY', local ? 16 : 8, 1, 64);
  return {
    batchMaxCount: integerEnvironment('RPC_BATCH_MAX_COUNT', local ? 50 : 20, 1, 100),
    batchStallTimeMs: integerEnvironment('RPC_BATCH_STALL_TIME_MS', 10, 0, 1_000),
    bulkConcurrency: integerEnvironment(
      'RPC_BULK_READ_CONCURRENCY',
      Math.max(1, concurrency - 2),
      1,
      concurrency,
    ),
    concurrency,
    maxRetries: integerEnvironment('RPC_READ_MAX_RETRIES', 2, 0, 10),
    minRequestIntervalMs: integerEnvironment(
      'RPC_MIN_REQUEST_INTERVAL_MS',
      local ? 0 : 10,
      0,
      10_000,
    ),
    retryBaseDelayMs: integerEnvironment('RPC_RETRY_BASE_DELAY_MS', 1_000, 1, 60_000),
  };
}

function integerEnvironment(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

function requestKey(payload: JsonRpcPayload) {
  return JSON.stringify([payload.method, payload.params]);
}

function emptyMetrics(): RpcPerformanceMetrics {
  return {
    batches: 0,
    deduplicatedRequests: 0,
    logicalRequests: 0,
    maxQueueWaitMs: 0,
    queueWaitMs: 0,
    rateLimitErrors: 0,
    requestDurationMs: 0,
    retries: 0,
    transports: 0,
  };
}

function isThrottled(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const error = value as {
    code?: number;
    message?: string;
    error?: unknown;
    info?: { responseStatus?: string; error?: unknown };
  };
  return (
    error.code === 429 ||
    error.code === -32005 ||
    /too many requests|rate.?limit|\b429\b/i.test(error.message ?? '') ||
    /\b429\b/.test(error.info?.responseStatus ?? '') ||
    isThrottled(error.error) ||
    isThrottled(error.info?.error)
  );
}

function isBatchUnsupported(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const error = value as { code?: number; message?: string; error?: unknown };
  return (
    error.code === -32600 ||
    /batch(?:ed|ing)? (?:requests? )?(?:are |is )?not supported|invalid batch/i.test(
      error.message ?? '',
    ) ||
    isBatchUnsupported(error.error)
  );
}
