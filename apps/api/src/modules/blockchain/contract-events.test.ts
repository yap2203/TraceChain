import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseContract } from 'ethers';
import { queryContractEvents } from './contract-events.js';

function fixture(deployedAt = 12_000, chainId = 11155111n) {
  let tip = 24_005;
  const provider = {
    getBlockNumber: vi.fn(async () => tip),
    getNetwork: vi.fn(async () => ({ chainId })),
    getCode: vi.fn(async (_address: string, block: number) =>
      block >= deployedAt ? '0x1234' : '0x',
    ),
  };
  const filter = { topics: ['supplier-filter'] };
  const queryFilter = vi.fn(async (_filter: unknown, from: number, to: number) => {
    if (to - from + 1 > 10_000) throw new Error('RPC range exceeded');
    return [{ blockNumber: from }, { blockNumber: to }];
  });
  const contract = {
    runner: { provider },
    getAddress: async () => 'registry',
    queryFilter,
  } as unknown as BaseContract;
  return {
    provider,
    contract,
    filter,
    queryFilter,
    setTip: (value: number) => {
      tip = value;
    },
  };
}

describe('Public chain event pagination', () => {
  beforeEach(() => vi.stubEnv('CHAIN_EVENT_START_BLOCK', ''));
  afterEach(() => vi.unstubAllEnvs());
  it('uses a configured deployment lower bound without historical code reads', async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '12000');
    const f = fixture();
    await queryContractEvents(f.contract, f.filter);
    expect(f.provider.getCode).not.toHaveBeenCalled();
    expect(f.queryFilter.mock.calls[0]).toEqual([f.filter, 12_000, 16_999]);
  });
  it.each(['abc', '-1', '999999999999999999', '25000'])(
    'rejects an invalid start block: %s',
    async (value) => {
      vi.stubEnv('CHAIN_EVENT_START_BLOCK', value);
      const f = fixture();
      await expect(queryContractEvents(f.contract, f.filter)).rejects.toThrow(
        'CHAIN_EVENT_START_BLOCK',
      );
      expect(f.queryFilter).not.toHaveBeenCalled();
    },
  );
  it('starts at creation, preserves filters and reads every block once in bounded pages', async () => {
    const f = fixture();
    const logs = await queryContractEvents(f.contract, f.filter);
    expect(f.queryFilter.mock.calls).toEqual([
      [f.filter, 12_000, 16_999],
      [f.filter, 17_000, 21_999],
      [f.filter, 22_000, 24_005],
    ]);
    expect(logs).toHaveLength(6);
  });
  it('caches creation lookup, but fetches new events on subsequent reads', async () => {
    const f = fixture();
    await queryContractEvents(f.contract, f.filter);
    const calls = f.provider.getCode.mock.calls.length;
    f.setTip(25_000);
    await queryContractEvents(f.contract, f.filter);
    expect(f.provider.getCode).toHaveBeenCalledTimes(calls);
    expect(f.queryFilter.mock.calls.at(-1)).toEqual([f.filter, 22_000, 25_000]);
  });
  it('propagates failed log reads instead of returning an empty inventory', async () => {
    const f = fixture();
    f.queryFilter.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(queryContractEvents(f.contract, f.filter)).rejects.toThrow('RPC unavailable');
  });
  it('retries a failed deployment lookup', async () => {
    const f = fixture();
    f.provider.getCode.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(queryContractEvents(f.contract, f.filter)).rejects.toThrow('RPC unavailable');
    await expect(queryContractEvents(f.contract, f.filter)).resolves.toHaveLength(6);
  });
  it('rejects missing contracts', async () => {
    const f = fixture(30_000);
    await expect(queryContractEvents(f.contract, f.filter)).rejects.toThrow('not deployed');
    expect(f.queryFilter).not.toHaveBeenCalled();
  });
  it('reads local chains from genesis without cached creation lookups after resets', async () => {
    const f = fixture(12_000, 31337n);
    await queryContractEvents(f.contract, f.filter);
    f.setTip(4);
    await queryContractEvents(f.contract, f.filter);
    expect(f.queryFilter.mock.calls.at(-1)).toEqual([f.filter, 0, 4]);
    expect(f.provider.getCode).not.toHaveBeenCalled();
  });
});
