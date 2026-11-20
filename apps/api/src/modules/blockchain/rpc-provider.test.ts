import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcProvider, type JsonRpcPayload } from 'ethers';
import {
  ApiRpcProvider,
  getRpcPerformanceMetrics,
  resetRpcPerformanceMetrics,
  type RpcTransportConfiguration,
} from './rpc-provider.js';

describe('Shared API RPC transport', () => {
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
    const send = vi
      .spyOn(JsonRpcProvider.prototype, '_send')
      .mockResolvedValue([{ error: { code: -32005, message: 'Too Many Requests' } }] as any);
    const p = provider();
    const results = [
      p._send(payload(1, 'eth_sendRawTransaction')),
      p._send(payload(2, 'eth_sendRawTransaction')),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(results);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('returns non-throttling errors without retry and keeps different calls distinct', async () => {
    const send = vi
      .spyOn(JsonRpcProvider.prototype, '_send')
      .mockResolvedValue([{ error: { code: -32602, message: 'Invalid params' } }] as any);
    const p = provider();
    const results = [p._send(payload(1)), p._send({ ...payload(2), params: ['other-wallet'] })];
    await vi.runAllTimersAsync();
    await Promise.all(results);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('stops retrying after three throttled attempts', async () => {
    const send = vi
      .spyOn(JsonRpcProvider.prototype, '_send')
      .mockResolvedValue([{ error: { code: -32005, message: 'Too Many Requests' } }] as any);
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
});
