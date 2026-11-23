import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcProvider, type JsonRpcPayload } from 'ethers';
import {
  ApiRpcProvider,
  getRpcPerformanceMetrics,
  resetRpcPerformanceMetrics,
  isRpcRateLimitError,
  type RpcTransportConfiguration,
} from './rpc-provider.js';

describe('Shared API RPC transport', () => {
  it('recognizes nested provider rate limits without confusing ordinary reverts', () => {
    expect(isRpcRateLimitError({code:'SERVER_ERROR',error:{code:429,message:'The RPC provider is rate limited.'}})).toBe(true);
    expect(isRpcRateLimitError({code:3,message:'execution reverted'})).toBe(false);
  });
  const providers: ApiRpcProvider[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    resetRpcPerformanceMetrics();
  });
  afterEach(() => {
    providers.forEach((provider) => provider.destroy());
    providers.length = 0;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  function provider(configuration?: Partial<RpcTransportConfiguration>) {
    const p = new ApiRpcProvider(
      'http://127.0.0.1:1',
      11155111,
      {
        staticNetwork: true,
        batchMaxCount: 1,
      },
      {
        batchMaxCount: 20,
        batchStallTimeMs: 10,
        bulkConcurrency: 6,
        concurrency: 8,
        maxRetries: 2,
        minRequestIntervalMs: 10,
        retryBaseDelayMs: 1_000,
        ...configuration,
      },
    );
    providers.push(p);
    return p;
  }
  const payload = (id: number, method = 'eth_call'): JsonRpcPayload => ({
    jsonrpc: '2.0',
    id,
    method,
    params: ['same-call'],
  });
  it('shares identical pending reads and preserves each request ID', async () => {
    const send = vi
      .spyOn(JsonRpcProvider.prototype, '_send')
      .mockImplementation(async (p) => [
        { jsonrpc: '2.0', id: (p as JsonRpcPayload).id, result: '0x1' },
      ]);
    const p = provider();
    const first = p._send(payload(1));
    const second = p._send(payload(2));
    await vi.runAllTimersAsync();
    expect((await first)[0].id).toBe(1);
    expect((await second)[0].id).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
    const next = p._send(payload(3));
    await vi.runAllTimersAsync();
    await next;
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('retries throttled reads with bounded backoff and spaces requests', async () => {
    const times: number[] = [];
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (p) => {
      times.push(Date.now());
      return times.length < 3
        ? ([
            {
              jsonrpc: '2.0',
              id: (p as JsonRpcPayload).id,
              error: { code: -32005, message: 'Too Many Requests' },
            },
          ] as any)
        : [{ jsonrpc: '2.0', id: (p as JsonRpcPayload).id, result: 'ok' }];
    });
    const result = provider()._send(payload(1));
    await vi.runAllTimersAsync();
    expect((await result)[0]).toMatchObject({ result: 'ok' });
    expect(send).toHaveBeenCalledTimes(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(2000);
  });
  it('never automatically retries or deduplicates transaction submissions', async () => {
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(
      async (entry) =>
        [
          {
            id: (entry as JsonRpcPayload).id,
            error: { code: -32005, message: 'Too Many Requests' },
          },
        ] as any,
    );
    const p = provider();
    const results = [
      p._send(payload(1, 'eth_sendRawTransaction')),
      p._send(payload(2, 'eth_sendRawTransaction')),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(results);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('honors Retry-After for a rate-limited read without retrying the whole batch', async () => {
    const times: number[] = [];
    vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (entry) => {
      times.push(Date.now());
      if (times.length === 1) throw { info: { error: { code: 429, retryAfterMs: 5000 } } };
      return [{ jsonrpc: '2.0', id: (entry as JsonRpcPayload).id, result: 'ok' }];
    });
    const result = provider()._send(payload(1));
    await vi.runAllTimersAsync();
    expect((await result)[0].result).toBe('ok');
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(5000);
  });
  it.each([
    { code: -32000, message: 'RPC busy' },
    { info: { responseStatus: '503 Service Unavailable' } },
    { cause: { code: 'ECONNRESET' } },
    { code: 'TIMEOUT', message: 'request timeout' },
  ])('recovers temporary read failures with bounded backoff: %j', async (failure) => {
    const send = vi
      .spyOn(JsonRpcProvider.prototype, '_send')
      .mockRejectedValueOnce(failure)
      .mockImplementation(async (entry) => [
        { jsonrpc: '2.0', id: (entry as JsonRpcPayload).id, result: 'ok' },
      ]);
    const result = provider()._send(payload(1));
    await vi.runAllTimersAsync();
    expect((await result)[0].result).toBe('ok');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('retries only busy entries in a partially successful batch and preserves result IDs', async () => {
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (entry) => {
      if (Array.isArray(entry))
        return [
          { jsonrpc: '2.0', id: entry[0].id, result: 'first-result' },
          { jsonrpc: '2.0', id: entry[1].id, error: { code: -32000, message: 'Server busy' } },
        ] as any;
      return [{ jsonrpc: '2.0', id: entry.id, result: 'second-result' }];
    });
    const result = provider()._send([payload(1), { ...payload(2), params: ['different-read'] }]);
    await vi.runAllTimersAsync();
    expect((await result).map((entry) => [entry.id, entry.result])).toEqual([
      [1, 'first-result'],
      [2, 'second-result'],
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toMatchObject({ id: 2 });
  });
  it('pauses other queued reads during a provider cooldown', async () => {
    const calls: Array<{ id: number | string; at: number }> = [];
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (input) => {
      const entry = input as JsonRpcPayload;
      calls.push({ id: entry.id, at: Date.now() });
      return calls.length === 1
        ? ([{ jsonrpc: '2.0', id: entry.id, error: { code: -32000, message: 'RPC busy' } }] as any)
        : [{ jsonrpc: '2.0', id: entry.id, result: 'ok' }];
    });
    const p = provider({ concurrency: 1, bulkConcurrency: 1, minRequestIntervalMs: 0 });
    const first = p._send(payload(1));
    await vi.advanceTimersByTimeAsync(0);
    const second = p._send({ ...payload(2), params: ['other-read'] });
    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(1000);
  });
  it('returns busy failures after the retry budget and never retries contract reverts', async () => {
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(
      async (entry) =>
        [
          {
            jsonrpc: '2.0',
            id: (entry as JsonRpcPayload).id,
            error: { code: -32000, message: 'RPC busy' },
          },
        ] as any,
    );
    const result = provider()._send(payload(1));
    await vi.runAllTimersAsync();
    expect((await result)[0]).toHaveProperty('error');
    expect(send).toHaveBeenCalledTimes(3);
    send.mockClear().mockImplementation(
      async (entry) =>
        [
          {
            jsonrpc: '2.0',
            id: (entry as JsonRpcPayload).id,
            error: { code: 3, message: 'execution reverted: permission denied' },
          },
        ] as any,
    );
    const denied = provider()._send(payload(2));
    await vi.runAllTimersAsync();
    expect((await denied)[0]).toHaveProperty('error');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('returns non-throttling errors without retry and keeps different calls distinct', async () => {
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(
      async (entry) =>
        [
          {
            id: (entry as JsonRpcPayload).id,
            error: { code: -32602, message: 'Invalid params' },
          },
        ] as any,
    );
    const p = provider();
    const results = [p._send(payload(1)), p._send({ ...payload(2), params: ['other-wallet'] })];
    await vi.runAllTimersAsync();
    await Promise.all(results);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('stops retrying after three throttled attempts', async () => {
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(
      async (entry) =>
        [
          {
            id: (entry as JsonRpcPayload).id,
            error: { code: -32005, message: 'Too Many Requests' },
          },
        ] as any,
    );
    const result = provider()._send(payload(1));
    await vi.runAllTimersAsync();
    await result;
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('sends safe read batches in one transport and records measured counters', async () => {
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (p) => {
      const entries = Array.isArray(p) ? p : [p];
      return entries.map((entry) => ({ jsonrpc: '2.0', id: entry.id, result: 'ok' }));
    });
    const result = provider({ minRequestIntervalMs: 0 })._send([
      payload(1),
      { ...payload(2), params: ['other'] },
    ]);
    await vi.runAllTimersAsync();
    expect(await result).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(getRpcPerformanceMetrics()).toMatchObject({
      batches: 1,
      logicalRequests: 2,
      transports: 1,
    });
  });
  it('benchmarks a twenty-read provider batch without serialized queue delay', async () => {
    vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (p) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const entries = Array.isArray(p) ? p : [p];
      return entries.map((entry) => ({ jsonrpc: '2.0', id: entry.id, result: 'ok' }));
    });
    const entries = Array.from({ length: 20 }, (_, index) => ({
      ...payload(index + 1),
      params: [`call-${index}`],
    }));
    const startedAt = Date.now();
    const result = provider({ minRequestIntervalMs: 0 })._send(entries);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toHaveLength(20);
    expect(Date.now() - startedAt).toBe(25);
    expect(getRpcPerformanceMetrics()).toMatchObject({
      logicalRequests: 20,
      maxQueueWaitMs: 0,
      requestDurationMs: 25,
      transports: 1,
    });
  });
  it('falls back to individual reads when an RPC endpoint rejects batches', async () => {
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (p) => {
      if (Array.isArray(p)) throw { code: -32600, message: 'Batch requests are not supported' };
      return [{ jsonrpc: '2.0', id: p.id, result: 'ok' }];
    });
    const result = provider({ minRequestIntervalMs: 0 })._send([
      payload(1),
      { ...payload(2), params: ['other'] },
    ]);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(3);
  });
  it.each([
    { code: -32005, message: 'Too Many Requests' },
    { jsonrpc: '2.0', id: null, error: { code: -32005, message: 'Too Many Requests' } },
  ])('recovers uncorrelated batch errors using individual reads: %j', async (failure) => {
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (input) => {
      if (Array.isArray(input)) return [failure] as any;
      return [{ jsonrpc: '2.0', id: input.id, result: `value-${input.id}` }];
    });
    const p = provider();
    const first = p._send([payload(1), { ...payload(2), params: ['other'] }]);
    await vi.runAllTimersAsync();
    expect((await first).map((r) => [r.id, r.result])).toEqual([
      [1, 'value-1'],
      [2, 'value-2'],
    ]);
    const next = p._send([payload(3), { ...payload(4), params: ['next'] }]);
    await vi.runAllTimersAsync();
    await next;
    expect(send.mock.calls.filter(([input]) => Array.isArray(input))).toHaveLength(1);
    expect(send.mock.calls.some(([input]) => Array.isArray(input) && !input.length)).toBe(false);
    expect(getRpcPerformanceMetrics().batchFallbacks).toBe(1);
  });
  it('normalizes and retries a bare single-request rate limit error', async () => {
    const send = vi
      .spyOn(JsonRpcProvider.prototype, '_send')
      .mockResolvedValueOnce([{ code: -32005, message: 'Too Many Requests' }] as any)
      .mockResolvedValueOnce([{ jsonrpc: '2.0', id: 1, result: 'ok' }]);
    const result = provider()._send(payload(1));
    await vi.runAllTimersAsync();
    expect(await result).toEqual([{ jsonrpc: '2.0', id: 1, result: 'ok' }]);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('recovers only omitted batch results without assigning values by position', async () => {
    const send = vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (input) => {
      if (Array.isArray(input)) return [{ jsonrpc: '2.0', id: 2, result: 'second' }];
      return [{ jsonrpc: '2.0', id: input.id, result: 'first' }];
    });
    const result = provider()._send([payload(1), { ...payload(2), params: ['other'] }]);
    await vi.runAllTimersAsync();
    expect((await result).map((r) => r.result)).toEqual(['first', 'second']);
    expect(send.mock.calls[1][0]).toMatchObject({ id: 1 });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('never retries malformed transaction responses', async () => {
    const send = vi
      .spyOn(JsonRpcProvider.prototype, '_send')
      .mockResolvedValue([{ code: -32005, message: 'Too Many Requests' }] as any);
    const result = provider()._send(payload(1, 'eth_sendRawTransaction'));
    await vi.runAllTimersAsync();
    await result;
    expect(send).toHaveBeenCalledTimes(1);
    expect(getRpcPerformanceMetrics().batchFallbacks).toBe(0);
  });
  it('reserves capacity for normal reads while bulk log reads are queued', async () => {
    let releaseLog!: () => void;
    const firstLog = new Promise<void>((resolve) => {
      releaseLog = resolve;
    });
    const methods: string[] = [];
    vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (p) => {
      const entry = p as JsonRpcPayload;
      methods.push(entry.method);
      if (
        entry.method === 'eth_getLogs' &&
        methods.filter((method) => method === entry.method).length === 1
      )
        await firstLog;
      return [{ jsonrpc: '2.0', id: entry.id, result: 'ok' }];
    });
    const p = provider({ bulkConcurrency: 1, concurrency: 2, minRequestIntervalMs: 0 });
    const first = p._send({ ...payload(1, 'eth_getLogs'), params: ['first'] });
    const second = p._send({ ...payload(2, 'eth_getLogs'), params: ['second'] });
    const auth = p._send({ ...payload(3), params: ['authorization'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(methods).toEqual(['eth_getLogs', 'eth_call']);
    releaseLog();
    await vi.runAllTimersAsync();
    await Promise.all([first, second, auth]);
  });
  it('paces costly log queries separately from ordinary reads', async () => {
    const times: number[] = [];
    vi.spyOn(JsonRpcProvider.prototype, '_send').mockImplementation(async (input) => {
      const entry = input as JsonRpcPayload;
      times.push(Date.now());
      return [{ jsonrpc: '2.0', id: entry.id, result: [] }];
    });
    const p = provider({
      concurrency: 1,
      bulkConcurrency: 1,
      minRequestIntervalMs: 10,
      bulkMinRequestIntervalMs: 1000,
    });
    const reads = [
      p._send({ ...payload(1, 'eth_getLogs'), params: ['first'] }),
      p._send({ ...payload(2, 'eth_getLogs'), params: ['second'] }),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(reads);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
  });
});
