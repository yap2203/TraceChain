import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { JsonRpcPayload, JsonRpcResult } from 'ethers';

// A short stand-in for the independently checked deployment runtime in transport tests.
vi.mock('ethers', async (importOriginal) => {
  const real = await importOriginal<typeof import('ethers')>();
  return {
    ...real,
    keccak256: (code: string) =>
      code === '0x1234'
        ? '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891'
        : real.keccak256(code),
  };
});
import { Interface } from 'ethers';
import { MulticallReads, MULTICALL_ADDRESS, multicallInterface } from './multicall-reads.js';

const address = '0x1000000000000000000000000000000000000001';
const getters = new Interface([
  'function administrator() view returns(address)',
  'function applicationCount() view returns(uint256)',
]);
const payload = (id: number, name = 'applicationCount'): JsonRpcPayload => ({
  jsonrpc: '2.0',
  id,
  method: 'eth_call',
  params: [{ to: address, data: getters.encodeFunctionData(name) }, 'latest'],
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture(code = '0x1234', failSecond = false) {
  let result = '0x11';
  const send = vi.fn(async (p: JsonRpcPayload): Promise<JsonRpcResult[]> => {
    if (p.method === 'eth_getCode') return [{ id: p.id, result: code }];
    const [tx] = p.params as Array<{ to: string; data: string }>;
    if (tx.to === MULTICALL_ADDRESS) {
      const [calls] = multicallInterface.decodeFunctionData('aggregate3', tx.data);
      return [
        {
          id: p.id,
          result: multicallInterface.encodeFunctionResult('aggregate3', [
            calls.map((_entry: unknown, i: number) => ({
              success: !failSecond || i !== 1,
              returnData: result,
            })),
          ]),
        },
      ];
    }
    return [{ id: p.id, result }];
  });
  const record = vi.fn();
  return {
    reader: new MulticallReads(new Set([address]), send, record),
    send,
    record,
    setResult: (value: string) => {
      result = value;
    },
  };
}

it('combines getters, verifies code once and retains request IDs without caching results', async () => {
  const f = fixture();
  const first = Promise.all([
    f.reader.read(payload(1)),
    f.reader.read(payload(2, 'administrator')),
  ]);
  await vi.runAllTimersAsync();
  expect(await first).toEqual([
    { id: 1, jsonrpc: '2.0', result: '0x11' },
    { id: 2, jsonrpc: '2.0', result: '0x11' },
  ]);
  expect(f.send).toHaveBeenCalledTimes(2); // runtime check + aggregate
  f.setResult('0x22');
  const next = Promise.all([f.reader.read(payload(3)), f.reader.read(payload(4))]);
  await vi.runAllTimersAsync();
  expect((await next)[0].result).toBe('0x22');
  expect(f.send).toHaveBeenCalledTimes(3);
  expect(f.record).toHaveBeenLastCalledWith(2);
});

it('preserves a failed getter as a revert without fabricating a successful authorization result', async () => {
  const f = fixture('0x1234', true);
  const result = Promise.all([f.reader.read(payload(1)), f.reader.read(payload(2))]);
  await vi.runAllTimersAsync();
  const replies = await result;
  expect(replies[0]).toMatchObject({ id: 1, result: '0x11' });
  expect(replies[1]).toMatchObject({ id: 2, error: { code: 3, data: '0x11' } });
});

it('falls back to individual reads if the runtime code does not match the pinned deployment', async () => {
  const f = fixture('0x');
  const result = Promise.all([f.reader.read(payload(1)), f.reader.read(payload(2))]);
  await vi.runAllTimersAsync();
  await result;
  expect(f.record).not.toHaveBeenCalled();
  expect(f.send).toHaveBeenCalledTimes(3);
});

it('does not aggregate caller-dependent simulations, unknown targets/selectors, overrides or writes', async () => {
  const f = fixture();
  const first = payload(1);
  const [tx] = first.params as Array<Record<string, unknown>>;
  const inputs: JsonRpcPayload[] = [
    { ...first, params: [{ ...tx, from: address }, 'latest'] },
    { ...payload(2), params: [{ ...tx, value: '0x1' }, 'latest'] },
    { ...payload(3), params: [tx, 'pending'] },
    { ...payload(4), params: [tx, 'latest', {}] },
    {
      ...payload(5),
      params: [{ ...tx, to: '0x2000000000000000000000000000000000000002' }, 'latest'],
    },
    { ...payload(6), params: [{ ...tx, data: '0x12345678' }, 'latest'] },
    { ...payload(7), method: 'eth_sendRawTransaction' },
  ];
  await Promise.all(inputs.map((p) => f.reader.read(p)));
  expect(f.record).not.toHaveBeenCalled();
  expect(f.send).toHaveBeenCalledTimes(inputs.length);
  expect(f.send.mock.calls.every(([p]) => p.method !== 'eth_getCode')).toBe(true);
});

it('does not retry all individual reads if aggregate transport fails', async () => {
  const f = fixture();
  f.send.mockImplementation(async (p) => {
    if (p.method === 'eth_getCode') return [{ id: p.id, result: '0x1234' }];
    throw new Error('RPC unavailable');
  });
  const result = Promise.allSettled([f.reader.read(payload(1)), f.reader.read(payload(2))]);
  await vi.runAllTimersAsync();
  expect((await result).every((r) => r.status === 'rejected')).toBe(true);
  expect(f.send).toHaveBeenCalledTimes(2);
});
