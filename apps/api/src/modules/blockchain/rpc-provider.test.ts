import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcProvider, type JsonRpcPayload } from 'ethers';
import { ApiRpcProvider } from './rpc-provider.js';

describe('Shared API RPC transport', () => {
  const providers: ApiRpcProvider[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    providers.forEach((provider) => provider.destroy());
    providers.length = 0;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  function provider() {
    const p = new ApiRpcProvider('http://127.0.0.1:1', 11155111, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
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
});
