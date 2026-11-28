import {
  FetchRequest,
  JsonRpcProvider,
  type JsonRpcApiProviderOptions,
  type JsonRpcPayload,
  type JsonRpcResult,
} from 'ethers';
import {
  countRead,
  currentConfirmedReadBlock,
  pinsConfirmedReads,
  recordRpcEndpoint,
  setConfirmedReadBlock,
} from './read-timing.js';
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
  failovers: number;
  circuitOpens: number;
  endpoints: Record<string, RpcEndpointMetrics>;
}

export interface RpcEndpointMetrics {
  logicalRequests: number;
  transports: number;
  batches: number;
  multicallBatches: number;
  multicallReads: number;
  deduplicatedRequests: number;
  successes: number;
  rateLimitErrors: number;
  timeouts: number;
  retries: number;
  failoverIn: number;
  failoverOut: number;
  circuitOpens: number;
  requestDurationMs: number;
  averageDurationMs: number;
  queueWaitMs: number;
  rollingDurationMs: number;
  lastObservedBlock?: number;
  lastSuccessAt?: string;
  health: 'healthy' | 'open' | 'probing' | 'unknown';
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
  requestTimeoutMs?: number;
}

const metrics: RpcPerformanceMetrics = emptyMetrics();

/** A process-local snapshot suitable for diagnostics and regression benchmarks. */
export function getRpcPerformanceMetrics(): RpcPerformanceMetrics {
  return {
    ...metrics,
    endpoints: Object.fromEntries(
      Object.entries(metrics.endpoints).map(([label, value]) => [label, { ...value }]),
    ),
  };
}

/** Test/benchmark helper; production code should normally retain process-lifetime totals. */
export function resetRpcPerformanceMetrics() {
  Object.assign(metrics, emptyMetrics());
}

/** One measured transport per configured network, shared by all API contract gateways. */
export function blockchainProvider(url: string, chainId: number): JsonRpcProvider {
  const configuration = rpcConfiguration(chainId);
  const endpointConfiguration = resolveEndpointConfiguration(url);
  const key = `${chainId}:${JSON.stringify(endpointConfiguration)}:${JSON.stringify(configuration)}`;
  let provider = providers.get(key);
  if (!provider) {
    provider = endpointConfiguration.multi
      ? new MultiRpcProvider(endpointConfiguration, chainId, configuration)
      : new ApiRpcProvider(
          endpointConfiguration.primary,
          chainId,
          {
            staticNetwork: true,
            batchMaxCount: configuration.batchMaxCount,
            batchStallTime: configuration.batchStallTimeMs,
          },
          configuration,
          'primary',
        );
    providers.set(key, provider);
  }
  return provider;
}

export async function validateBlockchainRpcStartup(
  url: string,
  chainId: number,
  contractAddresses: string[],
) {
  try {
    const provider = blockchainProvider(url, chainId);
    if (provider instanceof MultiRpcProvider) {
      await provider.validate(contractAddresses);
      return;
    }
    const [actualChain, block] = await Promise.all([
      provider.send('eth_chainId', []),
      provider.send('eth_blockNumber', []),
    ]);
    if (Number(BigInt(String(actualChain))) !== chainId)
      throw new Error(
        'RPC_STARTUP_FAILED: The primary endpoint is configured for the wrong chain.',
      );
    const latest = Number(BigInt(String(block)));
    for (const address of contractAddresses)
      if ((await provider.getCode(address, latest)) === '0x')
        throw new Error('RPC_STARTUP_FAILED: Required contract bytecode is missing.');
    if (contractAddresses[0])
      await provider.send('eth_getLogs', [
        {
          address: contractAddresses[0],
          fromBlock: `0x${latest.toString(16)}`,
          toBlock: `0x${latest.toString(16)}`,
        },
      ]);
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('RPC_')) throw cause;
    throw new Error(
      'RPC_STARTUP_FAILED: The configured RPC endpoints could not be validated. Check provider availability, chain ID and deployed contract addresses.',
    );
  }
}

export function registerRpcMulticallTarget(provider: JsonRpcProvider, address: string) {
  const candidate = provider as JsonRpcProvider & {
    registerMulticallTarget?: (target: string) => void;
  };
  candidate.registerMulticallTarget?.(address);
}

export class ApiRpcProvider extends JsonRpcProvider {
  registerMulticallTarget(address: string) {
    this.multicall?.registerTarget(address);
  }
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
    readonly endpointLabel = 'primary',
  ) {
    const connection = new FetchRequest(url);
    connection.timeout = configuration.requestTimeoutMs ?? 15_000;
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
    endpointMetrics(endpointLabel);
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
          endpointMetrics(this.endpointLabel).multicallBatches++;
          endpointMetrics(this.endpointLabel).multicallReads += count;
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
        endpointMetrics(this.endpointLabel).deduplicatedRequests += 1;
        promises.set(payload.id, pending);
      } else if (fresh.has(key)) {
        metrics.deduplicatedRequests += 1;
        endpointMetrics(this.endpointLabel).deduplicatedRequests += 1;
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
      if (useBatch) {
        metrics.batches += 1;
        endpointMetrics(this.endpointLabel).batches += 1;
      }
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
    endpointMetrics(this.endpointLabel).logicalRequests += logicalRequests;
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
      endpointMetrics(this.endpointLabel).transports += 1;
      recordRpcEndpoint(this.endpointLabel);
      countRead('rpc');
      try {
        const current = pending.length === 1 ? pending[0] : pending;
        measured = await this.scheduler.run(() => super._send(current), bulk);
      } catch (error) {
        reportRpcFailure(this.endpointLabel, pending, error);
        if (!read || !isThrottled(error)) throw error;
        metrics.rateLimitErrors += 1;
        endpointMetrics(this.endpointLabel).rateLimitErrors += 1;
        if (isTimeout(error)) endpointMetrics(this.endpointLabel).timeouts += 1;
        if (attempt >= this.configuration.maxRetries || retryAfterDelay(error) > 60_000)
          throw error;
        metrics.retries += 1;
        endpointMetrics(this.endpointLabel).retries += 1;
        await pause(attempt, error);
        continue;
      }
      metrics.queueWaitMs += measured.queueWaitMs;
      metrics.maxQueueWaitMs = Math.max(metrics.maxQueueWaitMs, measured.queueWaitMs);
      metrics.requestDurationMs += measured.durationMs;
      const endpoint = endpointMetrics(this.endpointLabel);
      endpoint.requestDurationMs += measured.durationMs;
      endpoint.queueWaitMs += measured.queueWaitMs;
      endpoint.rollingDurationMs = endpoint.rollingDurationMs
        ? endpoint.rollingDurationMs * 0.8 + measured.durationMs * 0.2
        : measured.durationMs;
      endpoint.lastSuccessAt = new Date().toISOString();
      endpoint.successes += 1;
      endpoint.averageDurationMs = endpoint.requestDurationMs / endpoint.successes;
      endpoint.health = 'healthy';
      if (!read) return measured.value;
      let replies = measured.value;
      for (const reply of replies)
        if (rpcError(reply))
          reportRpcFailure(
            this.endpointLabel,
            pending.filter((request) => request.id === reply.id || reply.id == null),
            reply,
          );
      // Some endpoints return bare {code,message} errors or id:null errors for an
      // entire batch. Such entries cannot be assigned to a request by position.
      if (pending.length > 1 && replies.some((entry) => entry.id == null && rpcError(entry))) {
        const rangeFailure = replies.find(isLogRangeLimit);
        if (rangeFailure && pending.every((entry) => entry.method === 'eth_getLogs'))
          return original.map(
            (entry) =>
              completed.get(entry.id) ??
              ({
                jsonrpc: '2.0',
                id: entry.id,
                error: rpcError(rangeFailure),
              } as unknown as JsonRpcResult),
          );
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
      endpointMetrics(this.endpointLabel).rateLimitErrors += 1;
      if (attempt >= this.configuration.maxRetries) return combined();
      // Retrying successful entries increases provider pressure and delays unrelated reads.
      pending = pending.filter((entry) => retryIds.has(entry.id));
      metrics.retries += 1;
      endpointMetrics(this.endpointLabel).retries += 1;
      await pause(attempt);
    }
  }
}

type EndpointLabel = 'primary' | 'secondary' | 'emergency' | 'logs-primary' | 'logs-fallback';

interface RpcEndpointConfiguration {
  primary: string;
  secondary?: string;
  emergency?: string;
  logsPrimary?: string;
  logsFallback?: string;
  multi: boolean;
}

interface EndpointState {
  label: EndpointLabel;
  provider: ApiRpcProvider;
  consecutiveFailures: number;
  unhealthyUntil: number;
  probe?: Promise<boolean>;
  lastObservedBlock?: number;
}

/**
 * Method-aware provider pool. Endpoint transports retain the existing batching,
 * scheduling, partial retry and Multicall implementation; this wrapper only
 * chooses which healthy transport should perform a read.
 */
export class MultiRpcProvider extends JsonRpcProvider {
  private readonly ordinary: EndpointState[];
  private readonly logs: EndpointState[];
  private readonly cooldownMs = integerEnvironment(
    'RPC_ENDPOINT_COOLDOWN_MS',
    30_000,
    1_000,
    3_600_000,
  );
  private readonly fallbackLogPageSize = integerEnvironment(
    'CHAIN_EVENT_FALLBACK_PAGE_SIZE',
    10,
    1,
    100_000,
  );

  constructor(
    endpoints: RpcEndpointConfiguration,
    private readonly expectedChainId: number,
    configuration: RpcTransportConfiguration,
  ) {
    super(endpoints.primary, expectedChainId, { staticNetwork: true, batchMaxCount: 1 });
    const ordinaryCount = 1 + Number(!!endpoints.secondary) + Number(!!endpoints.emergency);
    const logCount = endpoints.logsPrimary ? 1 + Number(!!endpoints.logsFallback) : ordinaryCount;
    const create = (label: EndpointLabel, url: string, maxRetries: number): EndpointState => ({
      label,
      provider: new ApiRpcProvider(
        url,
        expectedChainId,
        {
          staticNetwork: true,
          batchMaxCount: configuration.batchMaxCount,
          batchStallTime: configuration.batchStallTimeMs,
        },
        { ...configuration, maxRetries },
        label,
      ),
      consecutiveFailures: 0,
      unhealthyUntil: 0,
    });
    this.ordinary = [
      create('primary', endpoints.primary, ordinaryCount > 1 ? 0 : configuration.maxRetries),
      ...(endpoints.secondary ? [create('secondary', endpoints.secondary, 0)] : []),
      ...(endpoints.emergency ? [create('emergency', endpoints.emergency, 0)] : []),
    ];
    this.logs = endpoints.logsPrimary
      ? [
          create(
            'logs-primary',
            endpoints.logsPrimary,
            logCount > 1 ? 0 : configuration.maxRetries,
          ),
          ...(endpoints.logsFallback ? [create('logs-fallback', endpoints.logsFallback, 0)] : []),
        ]
      : this.ordinary;
  }

  registerMulticallTarget(address: string) {
    for (const endpoint of new Set([...this.ordinary, ...this.logs]))
      endpoint.provider.registerMulticallTarget(address);
  }

  override async _send(payload: JsonRpcPayload | JsonRpcPayload[]) {
    let entries = Array.isArray(payload) ? payload : [payload];
    // Backend writes are not expected, but if one reaches this provider it is
    // sent to the primary exactly once and never failed over.
    if (entries.some((entry) => !reads.has(entry.method)))
      return this.ordinary[0].provider._send(payload);
    // Pin to a confirmed block only for page loads. Actions and workflow reads (e.g. right after
    // the user's own transaction) must see the real latest state.
    if (
      pinsConfirmedReads() &&
      entries.some(
        (entry) =>
          entry.method === 'eth_call' &&
          Array.isArray(entry.params) &&
          (entry.params.length < 2 || entry.params[1] === 'latest'),
      )
    ) {
      let confirmed = currentConfirmedReadBlock();
      if (confirmed === undefined) {
        const headReply = (
          await this.route(
            [{ jsonrpc: '2.0', id: -9_999_999, method: 'eth_blockNumber', params: [] }],
            this.ordinary,
            false,
          )
        )[0];
        if (typeof headReply.result === 'string') {
          const confirmations = integerEnvironment(
            'CHAIN_EVENT_CONFIRMATIONS',
            this.expectedChainId === 31_337 ? 0 : 2,
            0,
            1_000,
          );
          confirmed = Math.max(0, Number(BigInt(headReply.result)) - confirmations);
          setConfirmedReadBlock(confirmed);
        }
      }
      if (confirmed !== undefined) {
        const tag = `0x${confirmed.toString(16)}`;
        entries = entries.map((entry) =>
          entry.method === 'eth_call' && Array.isArray(entry.params)
            ? { ...entry, params: [entry.params[0], tag] }
            : entry,
        );
      }
    }
    const ordinary = entries.filter((entry) => entry.method !== 'eth_getLogs');
    const logs = entries.filter((entry) => entry.method === 'eth_getLogs');
    const results = [
      ...(ordinary.length ? await this.route(ordinary, this.ordinary, false) : []),
      ...(logs.length ? await this.route(logs, this.logs, true) : []),
    ];
    return entries.map((entry) => {
      const result = results.find((candidate) => candidate.id === entry.id);
      if (!result) throw new Error('The RPC provider pool omitted a response.');
      return result;
    });
  }

  /** Validate all configured endpoints without revealing their URLs. */
  async validate(contractAddresses: string[] = []) {
    const unique = [...new Set([...this.ordinary, ...this.logs])];
    const observations = await Promise.all(
      unique.map(async (endpoint) => {
        try {
          const [chain, block] = await Promise.all([
            endpoint.provider.send('eth_chainId', []),
            endpoint.provider.send('eth_blockNumber', []),
          ]);
          if (Number(BigInt(String(chain))) !== this.expectedChainId)
            throw new Error('wrong chain');
          const latest = Number(BigInt(String(block)));
          endpoint.lastObservedBlock = latest;
          endpointMetrics(endpoint.label).lastObservedBlock = latest;
          for (const address of contractAddresses)
            if ((await endpoint.provider.getCode(address, latest)) === '0x')
              throw new Error('required contract bytecode is missing');
          if (
            (endpoint.label.startsWith('logs-') || this.logs === this.ordinary) &&
            contractAddresses[0]
          )
            await endpoint.provider.send('eth_getLogs', [
              {
                address: contractAddresses[0],
                fromBlock: `0x${latest.toString(16)}`,
                toBlock: `0x${latest.toString(16)}`,
              },
            ]);
          return { endpoint, latest, usable: true };
        } catch (cause) {
          this.openCircuit(endpoint, cause, true);
          return { endpoint, latest: -1, usable: false };
        }
      }),
    );
    const best = Math.max(...observations.map((entry) => entry.latest));
    for (const observation of observations)
      if (observation.usable && best - observation.latest > 5) {
        this.openCircuit(observation.endpoint, new Error('stale endpoint'), true);
        observation.usable = false;
      }
    if (!this.ordinary.some((endpoint) => endpoint.unhealthyUntil <= Date.now()))
      throw new Error('RPC_STARTUP_FAILED: No usable ordinary-read provider is configured.');
    if (!this.logs.some((endpoint) => endpoint.unhealthyUntil <= Date.now()))
      throw new Error(
        'RPC_LOG_STARTUP_FAILED: No usable log provider or compatible log fallback is configured.',
      );
  }

  override destroy() {
    for (const endpoint of new Set([...this.ordinary, ...this.logs])) endpoint.provider.destroy();
    super.destroy();
  }

  private async route(entries: JsonRpcPayload[], endpoints: EndpointState[], logRead: boolean) {
    const completed = new Map<number | string, JsonRpcResult>();
    let pending = entries;
    let lastFailure: unknown;
    for (let index = 0; index < endpoints.length && pending.length; index++) {
      const endpoint = endpoints[index];
      if (!(await this.available(endpoint))) continue;
      const requiredBlock = requiredReadBlock(pending);
      if (requiredBlock !== undefined && !(await this.hasReached(endpoint, requiredBlock)))
        continue;
      if (index > 0) {
        metrics.failovers += 1;
        endpointMetrics(endpoint.label).failoverIn += 1;
      }
      recordRpcEndpoint(endpoint.label, index > 0);
      try {
        const replies = await this.sendToEndpoint(
          endpoint,
          pending,
          logRead && endpoint.label === 'logs-fallback',
        );
        const retry = new Set<number | string>();
        for (const request of pending) {
          const reply = replies.find((candidate) => candidate.id === request.id);
          if (!reply || isTransientFailure(reply)) retry.add(request.id);
          else {
            completed.set(request.id, reply);
            this.recordSuccess(endpoint, request, reply);
          }
        }
        if (!retry.size) {
          pending = [];
          break;
        }
        lastFailure = replies.find(isTransientFailure) ?? new Error('Malformed RPC response.');
        this.openCircuit(endpoint, lastFailure);
        endpointMetrics(endpoint.label).failoverOut += 1;
        pending = pending.filter((entry) => retry.has(entry.id));
      } catch (cause) {
        if (!isTransientFailure(cause)) throw cause;
        lastFailure = cause;
        this.openCircuit(endpoint, cause);
        endpointMetrics(endpoint.label).failoverOut += 1;
      }
    }
    if (pending.length) {
      throw new RpcServiceUnavailableError(lastFailure);
    }
    return entries.map((entry) => completed.get(entry.id)!).filter(Boolean);
  }

  private async sendToEndpoint(
    endpoint: EndpointState,
    entries: JsonRpcPayload[],
    splitLogs: boolean,
  ) {
    if (!splitLogs) return endpoint.provider._send(entries.length === 1 ? entries[0] : entries);
    const results: JsonRpcResult[] = [];
    for (const entry of entries) results.push(await this.sendSplitLog(endpoint, entry));
    return results;
  }

  private async sendSplitLog(endpoint: EndpointState, entry: JsonRpcPayload) {
    const filter = (Array.isArray(entry.params) ? entry.params[0] : {}) as Record<string, unknown>;
    const from = parseBlockNumber(filter.fromBlock);
    const to = parseBlockNumber(filter.toBlock);
    if (from === undefined || to === undefined || to < from)
      return (await endpoint.provider._send(entry))[0];
    const logs: unknown[] = [];
    for (let start = from; start <= to; start += this.fallbackLogPageSize) {
      const reply = (
        await endpoint.provider._send({
          ...entry,
          params: [
            {
              ...filter,
              fromBlock: `0x${start.toString(16)}`,
              toBlock: `0x${Math.min(to, start + this.fallbackLogPageSize - 1).toString(16)}`,
            },
          ],
        })
      )[0];
      if (rpcError(reply)) return { ...reply, id: entry.id };
      if (Array.isArray(reply.result)) logs.push(...reply.result);
    }
    return { jsonrpc: '2.0', id: entry.id, result: deduplicateRawLogs(logs) } as JsonRpcResult;
  }

  private async available(endpoint: EndpointState) {
    if (!endpoint.unhealthyUntil) return true;
    if (endpoint.unhealthyUntil > Date.now()) return false;
    if (!endpoint.probe) {
      endpointMetrics(endpoint.label).health = 'probing';
      endpoint.probe = this.probe(endpoint).finally(() => {
        endpoint.probe = undefined;
      });
    }
    return endpoint.probe;
  }

  private async hasReached(endpoint: EndpointState, requiredBlock: number) {
    if ((endpoint.lastObservedBlock ?? -1) >= requiredBlock) return true;
    try {
      const value = await endpoint.provider.send('eth_blockNumber', []);
      const latest = Number(BigInt(String(value)));
      endpoint.lastObservedBlock = latest;
      endpointMetrics(endpoint.label).lastObservedBlock = latest;
      return latest >= requiredBlock;
    } catch (cause) {
      if (isTransientFailure(cause)) this.openCircuit(endpoint, cause);
      return false;
    }
  }

  private async probe(endpoint: EndpointState) {
    try {
      const [chain, block] = await Promise.all([
        endpoint.provider.send('eth_chainId', []),
        endpoint.provider.send('eth_blockNumber', []),
      ]);
      const latest = Number(BigInt(String(block)));
      const best = Math.max(
        0,
        ...[...this.ordinary, ...this.logs].map((item) => item.lastObservedBlock ?? 0),
      );
      if (Number(BigInt(String(chain))) !== this.expectedChainId || best - latest > 5)
        throw new Error('RPC endpoint health probe failed.');
      endpoint.unhealthyUntil = 0;
      endpoint.consecutiveFailures = 0;
      endpoint.lastObservedBlock = latest;
      const observed = endpointMetrics(endpoint.label);
      observed.health = 'healthy';
      observed.lastObservedBlock = latest;
      return true;
    } catch (cause) {
      this.openCircuit(endpoint, cause, true);
      return false;
    }
  }

  private recordSuccess(endpoint: EndpointState, request: JsonRpcPayload, reply: JsonRpcResult) {
    endpoint.consecutiveFailures = 0;
    if (request.method === 'eth_blockNumber' && typeof reply.result === 'string') {
      endpoint.lastObservedBlock = Number(BigInt(reply.result));
      endpointMetrics(endpoint.label).lastObservedBlock = endpoint.lastObservedBlock;
    }
  }

  private openCircuit(endpoint: EndpointState, cause: unknown, decisive = false) {
    endpoint.consecutiveFailures += 1;
    if (!decisive && !isImmediatelyDecisive(cause) && endpoint.consecutiveFailures < 2) return;
    const retryAfter = Math.min(60_000, retryAfterDelay(cause));
    endpoint.unhealthyUntil = Date.now() + Math.max(this.cooldownMs, retryAfter);
    const observed = endpointMetrics(endpoint.label);
    observed.health = 'open';
    observed.circuitOpens += 1;
    metrics.circuitOpens += 1;
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
    requestTimeoutMs: integerEnvironment('RPC_REQUEST_TIMEOUT_MS', 15_000, 1_000, 120_000),
  };
}

function resolveEndpointConfiguration(fallbackUrl: string): RpcEndpointConfiguration {
  const primary = process.env.CHAIN_RPC_PRIMARY_URL?.trim() || fallbackUrl;
  const secondary = optionalUrl('CHAIN_RPC_SECONDARY_URL');
  const emergency = optionalUrl('CHAIN_RPC_EMERGENCY_URL');
  const logsPrimary = optionalUrl('CHAIN_LOG_RPC_URL');
  const logsFallback = optionalUrl('CHAIN_LOG_FALLBACK_URL');
  return {
    primary,
    secondary,
    emergency,
    logsPrimary,
    logsFallback,
    multi: !!(secondary || emergency || logsPrimary || logsFallback),
  };
}

function optionalUrl(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
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
    failovers: 0,
    circuitOpens: 0,
    endpoints: {},
  };
}

function endpointMetrics(label: string): RpcEndpointMetrics {
  return (metrics.endpoints[label] ??= {
    logicalRequests: 0,
    transports: 0,
    batches: 0,
    multicallBatches: 0,
    multicallReads: 0,
    deduplicatedRequests: 0,
    successes: 0,
    rateLimitErrors: 0,
    timeouts: 0,
    retries: 0,
    failoverIn: 0,
    failoverOut: 0,
    circuitOpens: 0,
    requestDurationMs: 0,
    averageDurationMs: 0,
    queueWaitMs: 0,
    rollingDurationMs: 0,
    health: 'unknown',
  });
}

function isThrottled(value: unknown): boolean {
  if (isLogRangeLimit(value)) return false;
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

/** Query capacity is not provider health. Inspect nested errors without serializing RPC payloads. */
export function isLogRangeLimit(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 5) return false;
  const error = value as any;
  return (
    /query returned more than|too many (?:results|logs)|more than \d+ results|(?:block|query) range[^.]*?(?:exceed|limit|too (?:large|wide))|(?:exceed|maximum|max|limited to|up to|at most)[^.]*?\d[\d,k]*[ -]*blocks?|response size[^.]*?(?:large|exceed)|log response size exceeded/i.test(
      String(error.message ?? ''),
    ) ||
    [error.error, error.cause, error.info?.error].some((nested) =>
      isLogRangeLimit(nested, depth + 1),
    )
  );
}

export class RpcServiceUnavailableError extends Error {
  readonly code = 'BLOCKCHAIN_SERVICE_UNAVAILABLE';
  readonly status = 503;
  constructor(cause?: unknown) {
    super('Blockchain data is temporarily unavailable. Please retry shortly.', { cause });
  }
}

function reportRpcFailure(endpoint: string, requests: JsonRpcPayload[], cause: unknown) {
  const error: any = rpcError(cause) ?? (cause as any)?.info?.error ?? cause;
  const category = isLogRangeLimit(cause)
    ? 'range_or_result_limit'
    : isTimeout(cause)
      ? 'timeout'
      : /401|403|unauthori[sz]ed|forbidden|api.?key/i.test(
            String(error?.message ?? '') + String(error?.status ?? ''),
          )
        ? 'authentication'
        : isRpcRateLimitError(cause)
          ? 'rate_limit'
          : 'network_or_rpc_error';
  // Never log raw messages, URLs, params, headers or nested server responses.
  console.warn('RPC attempt failed', {
    endpoint,
    methods: [...new Set(requests.map((request) => request.method))],
    category,
    rpcCode:
      typeof error?.code === 'number' ||
      [
        'SERVER_ERROR',
        'NETWORK_ERROR',
        'TIMEOUT',
        'ETIMEDOUT',
        'ECONNRESET',
        'ECONNREFUSED',
        'ENOTFOUND',
        'EAI_AGAIN',
        'UNKNOWN_ERROR',
        'CALL_EXCEPTION',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_SOCKET',
      ].includes(String(error?.code ?? ''))
        ? error.code
        : undefined,
    httpStatus: Number.isInteger(error?.status) ? error.status : undefined,
    ranges: requests
      .filter((request) => request.method === 'eth_getLogs')
      .map((request) => {
        const filter = (Array.isArray(request.params) ? request.params[0] : {}) as any;
        return {
          fromBlock: parseBlockNumber(filter?.fromBlock),
          toBlock: parseBlockNumber(filter?.toBlock),
          addressCount: Array.isArray(filter?.address)
            ? filter.address.length
            : filter?.address
              ? 1
              : 0,
        };
      }),
  });
}

export const isRpcLogRangeError = isLogRangeLimit;

export function isRpcUnavailableError(value: unknown) {
  return value instanceof RpcServiceUnavailableError || isTransientFailure(value);
}

function isTimeout(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const error = value as { code?: unknown; message?: string; error?: unknown; cause?: unknown };
  return (
    ['ETIMEDOUT', 'TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(String(error.code)) ||
    /timed? ?out|timeout/i.test(error.message ?? '') ||
    isTimeout(error.error) ||
    isTimeout(error.cause)
  );
}

function isTransientFailure(value: unknown): boolean {
  return (
    isThrottled(value) ||
    isAuthenticationFailure(value) ||
    (!!value &&
      typeof value === 'object' &&
      ['ENOTFOUND', 'EAI_AGAIN', 'NETWORK_ERROR'].includes(String((value as any).code))) ||
    value instanceof UncorrelatedBatchError ||
    (!!value &&
      typeof value === 'object' &&
      /malformed|omitted.*response|invalid json|unexpected end of json/i.test(
        String((value as { message?: unknown }).message ?? ''),
      ))
  );
}

function isAuthenticationFailure(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 5) return false;
  const error = value as any;
  if (
    error.code === 3 ||
    error.code === 'CALL_EXCEPTION' ||
    /execution reverted/i.test(String(error.message ?? ''))
  )
    return false;
  return (
    [401, 403].includes(Number(error.status ?? error.code)) ||
    /unauthori[sz]ed|forbidden|invalid api.?key/i.test(String(error.message ?? '')) ||
    [error.error, error.cause, error.info?.error].some((nested) =>
      isAuthenticationFailure(nested, depth + 1),
    )
  );
}

function isImmediatelyDecisive(value: unknown) {
  return isRpcRateLimitError(value) || isTimeout(value) || isBatchTransportFailure(value);
}

function isBatchTransportFailure(value: unknown) {
  return (
    !!value &&
    typeof value === 'object' &&
    /malformed|omitted.*response|invalid json|unexpected end of json/i.test(
      String((value as { message?: unknown }).message ?? ''),
    )
  );
}

function parseBlockNumber(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) return Number(BigInt(value));
  return undefined;
}

function requiredReadBlock(entries: JsonRpcPayload[]) {
  let required: number | undefined;
  for (const entry of entries) {
    if (entry.method !== 'eth_call' || !Array.isArray(entry.params)) continue;
    const block = parseBlockNumber(entry.params[1]);
    if (block !== undefined) required = Math.max(required ?? 0, block);
  }
  return required;
}

function deduplicateRawLogs(values: unknown[]) {
  const seen = new Set<string>();
  return values
    .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object')
    .sort((left, right) => {
      const block =
        Number(BigInt(String(left.blockNumber ?? '0'))) -
        Number(BigInt(String(right.blockNumber ?? '0')));
      return (
        block ||
        Number(BigInt(String(left.logIndex ?? '0'))) - Number(BigInt(String(right.logIndex ?? '0')))
      );
    })
    .filter((log) => {
      const key = `${log.blockHash ?? ''}:${log.transactionHash ?? ''}:${log.logIndex ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function isRpcRateLimitError(value: unknown): boolean {
  if (isLogRangeLimit(value)) return false;
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
