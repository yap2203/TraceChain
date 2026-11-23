import {
  FetchRequest,
  JsonRpcProvider,
  type JsonRpcApiProviderOptions,
  type JsonRpcPayload,
  type JsonRpcResult,
} from 'ethers';
import { countRead } from './read-timing.js';
import { MulticallReads } from './multicall-reads.js';

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
  multicallBatches: number;
  multicallReads: number;
  batches: number;
  deduplicatedRequests: number;
  logicalRequests: number;
  maxQueueWaitMs: number;
  queueWaitMs: number;
  rateLimitErrors: number;
  requestDurationMs: number;
  retries: number;
  transports: number;
  batchFallbacks: number;
}

export interface RpcTransportConfiguration {
  multicallEnabled?: boolean;
  bulkMinRequestIntervalMs?: number;
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
  registerMulticallTarget(address: string) { this.multicall?.registerTarget(address); }
  private readonly multicall?: MulticallReads;
  private readonly inFlight = new Map<string, Promise<JsonRpcResult>>();
  private batchDisabledUntil = 0;
  private readonly scheduler: PriorityRpcScheduler;
  private readonly configuration: RpcTransportConfiguration;

  constructor(
    url: string,
    network: number,
    options: JsonRpcApiProviderOptions = {},
    configuration: RpcTransportConfiguration = rpcConfiguration(network),
  ) {
    const connection = new FetchRequest(url);
    connection.timeout = 15_000;
    // Keep retry ownership here, including writes (which must never be resubmitted).
    connection.retryFunc = async () => false;
    connection.processFunc = async (_request, response) => {
      if (response.statusCode === 429) {
        const header = response.headers['retry-after'];
        const retryAfterMs =
          header && /^\d+(?:\.\d+)?$/.test(header)
            ? Number(header) * 1000
            : header
              ? Math.max(0, Date.parse(header) - Date.now())
              : 0;
        throw Object.assign(new Error('The RPC provider is rate limited.'), {
          code: 429,
          retryAfterMs,
        });
      }
      return response;
    };
    super(connection, network, options);
    this.configuration = configuration;
    this.scheduler = new PriorityRpcScheduler(configuration);
    if (network === 11155111 && configuration.multicallEnabled) {
      const targets = new Set(
        [
          'STAKEHOLDER_REGISTRY_ADDRESS',
          'CREDENTIAL_REGISTRY_ADDRESS',
          'INGREDIENT_REGISTRY_ADDRESS',
          'PRODUCT_REGISTRY_ADDRESS',
          'CUSTODY_TRANSFER_ADDRESS',
          'EVIDENCE_REGISTRY_ADDRESS',
          'SUPPLY_ORDERS_ADDRESS',
          'COMPANY_PROOF_REGISTRY_ADDRESS',
        ]
          .map((key) => process.env[key]?.toLowerCase())
          .filter((value): value is string => !!value),
      );
      this.multicall = new MulticallReads(
        targets,
        (payload) => this.perform(payload, true, false, 0),
        (count) => {
          metrics.multicallBatches++;
          metrics.multicallReads += count;
        },
      );
    }
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
      const aggregate = !bulk && this.multicall;
      const useBatch = !aggregate && payloads.length > 1 && Date.now() >= this.batchDisabledUntil;
      if (aggregate) metrics.logicalRequests += payloads.length;
      let operation = aggregate
        ? Promise.all(payloads.map((entry) => aggregate.read(entry)))
        : useBatch
          ? this.perform(payloads, true, bulk, payloads.length)
          : Promise.all(payloads.map((entry) => this.perform(entry, true, bulk, 1))).then((r) =>
              r.flat(),
            );
      if (useBatch)
        operation = operation
          .then(async (results) => {
            const unsupported = results.find(isBatchUnsupported);
            if (unsupported) throw unsupported;
            const missing = payloads.filter(
              (entry) => !results.some((result) => result.id === entry.id),
            );
            if (missing.length) {
              this.disableBatching();
              const recovered = await Promise.all(
                missing.map((entry) => this.perform(entry, true, bulk, 0)),
              );
              return [...results, ...recovered.flat()];
            }
            return results;
          })
          .catch(async (error) => {
            if (!isBatchUnsupported(error)) throw error;
            this.disableBatching();
            const individual = await Promise.all(
              payloads.map((entry) => this.perform(entry, true, bulk, 0)),
            );
            return individual.flat();
          });
      if (useBatch) metrics.batches += 1;
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

  private disableBatching() {
    this.batchDisabledUntil = Date.now() + 60_000;
    metrics.batchFallbacks += 1;
  }

  private async perform(
    payload: JsonRpcPayload | JsonRpcPayload[],
    read: boolean,
    bulk: boolean,
    logicalRequests: number,
  ): Promise<Array<JsonRpcResult>> {
    metrics.logicalRequests += logicalRequests;
    const original = Array.isArray(payload) ? payload : [payload];
    const completed = new Map<number | string, JsonRpcResult>();
    let pending = original;
    const pause = async (attempt: number, error?: unknown) => {
      const delay = Math.max(
        this.configuration.retryBaseDelayMs * 2 ** attempt,
        retryAfterDelay(error),
      );
      this.scheduler.cooldown(delay);
      await wait(delay);
    };
    for (let attempt = 0; ; attempt++) {
      let measured: ScheduledResult<Array<JsonRpcResult>>;
      metrics.transports += 1;
      countRead('rpc');
      try {
        const current = pending.length === 1 ? pending[0] : pending;
        measured = await this.scheduler.run(() => super._send(current), bulk);
      } catch (error) {
        if (!read || !isThrottled(error)) throw error;
        metrics.rateLimitErrors += 1;
        if (attempt >= this.configuration.maxRetries || retryAfterDelay(error) > 60_000)
          throw error;
        metrics.retries += 1;
        await pause(attempt, error);
        continue;
      }
      metrics.queueWaitMs += measured.queueWaitMs;
      metrics.maxQueueWaitMs = Math.max(metrics.maxQueueWaitMs, measured.queueWaitMs);
      metrics.requestDurationMs += measured.durationMs;
      if (!read) return measured.value;
      let replies = measured.value;
      // Some endpoints return bare {code,message} errors or id:null errors for an
      // entire batch. Such entries cannot be assigned to a request by position.
      if (pending.length > 1 && replies.some((entry) => entry.id == null && rpcError(entry))) {
        if (replies.some(isThrottled)) {
          metrics.rateLimitErrors += 1;
          this.scheduler.cooldown(this.configuration.retryBaseDelayMs);
        }
        throw new UncorrelatedBatchError();
      }
      if (
        pending.length === 1 &&
        replies.length === 1 &&
        replies[0].id == null &&
        rpcError(replies[0])
      ) {
        replies = [
          {
            jsonrpc: '2.0',
            id: pending[0].id,
            error: rpcError(replies[0]),
          } as unknown as JsonRpcResult,
        ];
      }
      const retryIds = new Set<number | string>();
      for (const entry of replies) {
        if (!pending.some((request) => request.id === entry.id)) continue;
        completed.set(entry.id, entry);
        if (isThrottled(entry)) retryIds.add(entry.id);
      }
      const combined = () => original.map((entry) => completed.get(entry.id)!).filter(Boolean);
      if (!retryIds.size) return combined();
      metrics.rateLimitErrors += 1;
      if (attempt >= this.configuration.maxRetries) return combined();
      // Retrying successful entries increases provider pressure and delays unrelated reads.
      pending = pending.filter((entry) => retryIds.has(entry.id));
      metrics.retries += 1;
      await pause(attempt);
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

  cooldown(delayMs: number) {
    this.nextStartAt = Math.max(this.nextStartAt, Date.now() + delayMs);
  }

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
    this.nextStartAt =
      startedAt +
      Math.max(
        this.configuration.minRequestIntervalMs,
        entry.bulk ? (this.configuration.bulkMinRequestIntervalMs ?? 0) : 0,
      );
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
  const concurrency = integerEnvironment('RPC_READ_CONCURRENCY', local ? 16 : 4, 1, 64);
  return {
    multicallEnabled: chainId === 11155111 && process.env.RPC_MULTICALL_ENABLED === 'true',
    batchMaxCount: integerEnvironment('RPC_BATCH_MAX_COUNT', local ? 50 : 10, 1, 100),
    batchStallTimeMs: integerEnvironment('RPC_BATCH_STALL_TIME_MS', 10, 0, 1_000),
    bulkMinRequestIntervalMs: integerEnvironment(
      'RPC_BULK_MIN_REQUEST_INTERVAL_MS',
      local ? 0 : 1000,
      0,
      10000,
    ),
    bulkConcurrency: integerEnvironment(
      'RPC_BULK_READ_CONCURRENCY',
      Math.max(1, concurrency - 2),
      1,
      concurrency,
    ),
    concurrency,
    maxRetries: integerEnvironment('RPC_READ_MAX_RETRIES', 3, 0, 10),
    minRequestIntervalMs: integerEnvironment(
      'RPC_MIN_REQUEST_INTERVAL_MS',
      local ? 0 : 100,
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
    multicallBatches: 0,
    multicallReads: 0,
    batches: 0,
    deduplicatedRequests: 0,
    logicalRequests: 0,
    maxQueueWaitMs: 0,
    queueWaitMs: 0,
    rateLimitErrors: 0,
    requestDurationMs: 0,
    retries: 0,
    transports: 0,
    batchFallbacks: 0,
  };
}

function isThrottled(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const error = value as {
    code?: number | string;
    message?: string;
    error?: unknown;
    cause?: unknown;
    status?: number;
    info?: { responseStatus?: string; error?: unknown };
  };
  return (
    error.code === 429 ||
    error.code === -32005 ||
    [429, 502, 503, 504].includes(Number(error.status)) ||
    [
      'ECONNRESET',
      'ETIMEDOUT',
      'TIMEOUT',
      'ECONNREFUSED',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
    ].includes(String(error.code)) ||
    /too many requests|rate.?limit|\b429\b|(?:rpc|server|provider|node) (?:is |temporarily )?(?:busy|overloaded)|temporarily unavailable|compute units?[^.]*exceed|throughput[^.]*(?:exceed|limit)/i.test(
      error.message ?? '',
    ) ||
    /\b(?:429|502|503|504)\b/.test(error.info?.responseStatus ?? '') ||
    isThrottled(error.error) ||
    isThrottled(error.cause) ||
    isThrottled(error.info?.error)
  );
}

export function isRpcRateLimitError(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const error = value as {
    code?: number;
    status?: number;
    message?: string;
    error?: unknown;
    cause?: unknown;
    info?: { error?: unknown; responseStatus?: string };
  };
  return (
    error.code === 429 ||
    error.code === -32005 ||
    error.status === 429 ||
    /too many requests|rate.?limit|\b429\b/i.test(error.message ?? '') ||
    /\b429\b/.test(error.info?.responseStatus ?? '') ||
    isRpcRateLimitError(error.error) ||
    isRpcRateLimitError(error.cause) ||
    isRpcRateLimitError(error.info?.error)
  );
}

function isBatchUnsupported(value: unknown): boolean {
  if (value instanceof UncorrelatedBatchError) return true;
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

class UncorrelatedBatchError extends Error {
  constructor() {
    super('The RPC endpoint returned batch errors without request IDs.');
  }
}
function rpcError(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const response = value as {
    error?: unknown;
    code?: unknown;
    message?: unknown;
    result?: unknown;
  };
  if ('result' in response) return undefined;
  return (
    response.error ??
    (typeof response.code === 'number' && typeof response.message === 'string'
      ? response
      : undefined)
  );
}

function retryAfterDelay(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const error = value as {
    retryAfterMs?: number;
    error?: unknown;
    cause?: unknown;
    info?: { error?: unknown };
  };
  return Math.max(
    Number.isFinite(error.retryAfterMs) ? Math.max(0, error.retryAfterMs!) : 0,
    retryAfterDelay(error.error),
    retryAfterDelay(error.cause),
    retryAfterDelay(error.info?.error),
  );
}
