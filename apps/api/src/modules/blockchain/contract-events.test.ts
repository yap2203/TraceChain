import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Interface, zeroPadValue, type BaseContract, type EventLog } from 'ethers';
import { configureEventIndexStore, queryContractEvents } from './contract-events.js';

const abi = new Interface([
  'event Supplied(address indexed supplier, uint256 amount)',
  'event Noted(uint256 value)',
]);
const supplierA = '0x1000000000000000000000000000000000000001';
const supplierB = '0x2000000000000000000000000000000000000002';
const suppliedTopic = abi.getEvent('Supplied')!.topicHash;
const notedTopic = abi.getEvent('Noted')!.topicHash;
const supplierAFilter = { topics: [suppliedTopic, zeroPadValue(supplierA, 32)] };
const notedFilter = { topics: [notedTopic] };

function encoded(name: 'Supplied' | 'Noted', values: unknown[], block: number, index: number) {
  const { data, topics } = abi.encodeEventLog(abi.getEvent(name)!, values);
  return {
    address: '0x00000000000000000000000000000000000000aa',
    blockNumber: block,
    blockHash: `0x${block.toString(16).padStart(64, '0')}`,
    transactionHash: `0x${(block * 10 + index).toString(16).padStart(64, '0')}`,
    transactionIndex: 0,
    index,
    data,
    topics,
    removed: false,
  };
}

function fixture(deployedAt = 12_000, chainId = 11155111n) {
  let tip = 24_005;
  let hashVersion = 1;
  // Each page holds one log per supplier plus one unrelated event.
  // Recorded as ['*', from, to] per scanned range; the provider receives one multi-address filter.
  const queryFilter = vi.fn(async (_filter: unknown, from: number, to: number) => {
    if (to - from + 1 > 10_000) throw new Error('RPC range exceeded');
    return [
      encoded('Supplied', [supplierA, from], from, 0),
      encoded('Supplied', [supplierB, from], from, 1),
      encoded('Noted', [to], to, 2),
    ];
  });
  const provider = {
    getBlockNumber: vi.fn(async () => tip),
    getNetwork: vi.fn(async () => ({ chainId })),
    getBlock: vi.fn(async (block: number) => ({ hash: `hash-${hashVersion}-${block}` })),
    getCode: vi.fn(async (_address: string, block: number) =>
      block >= deployedAt ? '0x1234' : '0x',
    ),
    getLogs: vi.fn(async (filter: { fromBlock: number; toBlock: number }) =>
      queryFilter('*', filter.fromBlock, filter.toBlock),
    ),
  };
  const contract = {
    runner: { provider },
    interface: abi,
    getAddress: async () => '0x00000000000000000000000000000000000000aa',
    queryFilter,
  } as unknown as BaseContract;
  return {
    provider,
    contract,
    queryFilter,
    setTip: (value: number) => {
      tip = value;
    },
    reorg: () => {
      hashVersion += 1;
    },
  };
}

describe('Public chain event pagination', () => {
  it('splits the reported inclusive 5000-block range and shares simultaneous scans', async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', String(0xb9fab4));
    vi.stubEnv('CHAIN_EVENT_CONFIRMATIONS', '0');
    const f = fixture();
    f.setTip(0xba0e3b);
    const successful: Array<[number, number]> = [];
    f.provider.getLogs.mockImplementation(async (filter: any) => {
      if (filter.toBlock - filter.fromBlock + 1 > 1000)
        throw {
          info: { error: { code: -32005, message: 'block range exceeds maximum 1000 blocks' } },
        };
      successful.push([filter.fromBlock, filter.toBlock]);
      return f.queryFilter('*', filter.fromBlock, filter.toBlock);
    });
    const rows = await Promise.all(
      Array.from({ length: 7 }, () => queryContractEvents(f.contract, notedFilter)),
    );
    expect(rows.every((row) => row.length === 8)).toBe(true);
    expect(successful[0][0]).toBe(0xb9fab4);
    expect(successful.at(-1)![1]).toBe(0xba0e3b);
    expect(successful.reduce((count, [from, to]) => count + to - from + 1, 0)).toBe(5000);
    for (let i = 1; i < successful.length; i++)
      expect(successful[i][0]).toBe(successful[i - 1][1] + 1);
    const calls = f.provider.getLogs.mock.calls.length;
    await queryContractEvents(f.contract, notedFilter);
    expect(f.provider.getLogs).toHaveBeenCalledTimes(calls);
  });
  it('never checkpoints or returns partial success when a split child range fails', async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '24000');
    vi.stubEnv('CHAIN_EVENT_CONFIRMATIONS', '0');
    const f = fixture();
    f.provider.getLogs.mockImplementation(async (filter: any) => {
      if (filter.toBlock - filter.fromBlock + 1 > 3)
        throw { error: { code: -32005, message: 'too many results' } };
      if (filter.fromBlock === 24003) throw new Error('network offline');
      return f.queryFilter('*', filter.fromBlock, filter.toBlock);
    });
    await expect(queryContractEvents(f.contract, notedFilter)).rejects.toMatchObject({
      code: 'BLOCKCHAIN_SERVICE_UNAVAILABLE',
      cause: { message: 'network offline' },
    });
    f.provider.getLogs.mockImplementation(async (filter: any) =>
      f.queryFilter('*', filter.fromBlock, filter.toBlock),
    );
    await expect(queryContractEvents(f.contract, notedFilter)).resolves.toHaveLength(1);
    expect(f.queryFilter.mock.calls.at(-1)).toEqual(['*', 24000, 24005]);
  });
  beforeEach(() => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '');
    vi.stubEnv('CHAIN_EVENT_CONFIRMATIONS', '0');
    vi.stubEnv('CHAIN_EVENT_HEAD_CACHE_MS', '0');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('uses a configured deployment lower bound without historical code reads', async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '12000');
    const f = fixture();
    await queryContractEvents(f.contract, supplierAFilter);
    expect(f.provider.getCode).not.toHaveBeenCalled();
    expect(f.queryFilter.mock.calls[0]).toEqual(['*', 12_000, 16_999]);
  });
  it.each(['abc', '-1', '999999999999999999', '25000'])(
    'rejects an invalid start block: %s',
    async (value) => {
      vi.stubEnv('CHAIN_EVENT_START_BLOCK', value);
      const f = fixture();
      await expect(queryContractEvents(f.contract, supplierAFilter)).rejects.toThrow(
        'CHAIN_EVENT_START_BLOCK',
      );
      expect(f.queryFilter).not.toHaveBeenCalled();
    },
  );
  it('starts at creation, reads every block once in bounded pages and filters by topic', async () => {
    const f = fixture();
    const logs = (await queryContractEvents(f.contract, supplierAFilter)) as EventLog[];
    expect(f.queryFilter.mock.calls).toEqual([
      ['*', 12_000, 16_999],
      ['*', 17_000, 21_999],
      ['*', 22_000, 24_005],
    ]);
    expect(logs).toHaveLength(3);
    expect(logs.map((log) => log.args.supplier)).toEqual([supplierA, supplierA, supplierA]);
    expect(logs.map((log) => Number(log.args.amount))).toEqual([12_000, 17_000, 22_000]);
    expect(logs[0].eventName).toBe('Supplied');
  });
  it('resumes after a failed log page without rescanning completed pages', async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '12000');
    const f = fixture();
    const read = f.provider.getLogs.getMockImplementation()!;
    let fail = true;
    f.provider.getLogs.mockImplementation(async (filter) => {
      if (filter.fromBlock === 22000 && fail) {
        fail = false;
        throw new Error('All configured RPC providers are temporarily unavailable.');
      }
      return read(filter);
    });
    await expect(queryContractEvents(f.contract, supplierAFilter)).rejects.toThrow('unavailable');
    const logs = await queryContractEvents(f.contract, supplierAFilter);
    expect(logs).toHaveLength(3);
    expect(f.provider.getLogs.mock.calls.map(([filter]) => filter.fromBlock)).toEqual([
      12000, 17000, 22000, 22000,
    ]);
  });
  it('shares one contract scan across event types and filters', async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '12000');
    const f = fixture();
    await queryContractEvents(f.contract, supplierAFilter);
    const scans = f.queryFilter.mock.calls.length;
    const noted = (await queryContractEvents(f.contract, notedFilter)) as EventLog[];
    expect(f.queryFilter).toHaveBeenCalledTimes(scans);
    expect(noted.map((log) => Number(log.args.value))).toEqual([16_999, 21_999, 24_005]);
  });
  it('lets concurrent callers share a single refresh', async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '12000');
    const f = fixture();
    const [first, second] = await Promise.all([
      queryContractEvents(f.contract, supplierAFilter),
      queryContractEvents(f.contract, notedFilter),
    ]);
    expect(f.queryFilter).toHaveBeenCalledTimes(3);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
  });
  it('caches creation lookup, but fetches new events on subsequent reads', async () => {
    const f = fixture();
    await queryContractEvents(f.contract, supplierAFilter);
    const calls = f.provider.getCode.mock.calls.length;
    f.setTip(25_000);
    await queryContractEvents(f.contract, supplierAFilter);
    expect(f.provider.getCode).toHaveBeenCalledTimes(calls);
    expect(f.queryFilter.mock.calls.at(-1)).toEqual(['*', 24_006, 25_000]);
  });
  it('propagates failed log reads instead of returning an empty inventory', async () => {
    const f = fixture();
    f.queryFilter.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(queryContractEvents(f.contract, supplierAFilter)).rejects.toMatchObject({
      code: 'BLOCKCHAIN_SERVICE_UNAVAILABLE',
      cause: { message: 'RPC unavailable' },
    });
  });
  it('retries a failed deployment lookup', async () => {
    const f = fixture();
    f.provider.getCode.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(queryContractEvents(f.contract, supplierAFilter)).rejects.toThrow(
      'RPC unavailable',
    );
    await expect(queryContractEvents(f.contract, supplierAFilter)).resolves.toHaveLength(3);
  });
  it('rejects missing contracts', async () => {
    const f = fixture(30_000);
    await expect(queryContractEvents(f.contract, supplierAFilter)).rejects.toThrow('not deployed');
    expect(f.queryFilter).not.toHaveBeenCalled();
  });
  it('reads local chains from genesis without cached creation lookups after resets', async () => {
    const f = fixture(12_000, 31337n);
    await queryContractEvents(f.contract, supplierAFilter);
    f.setTip(4);
    await queryContractEvents(f.contract, supplierAFilter);
    expect(f.queryFilter.mock.calls.at(-1)).toEqual(['*', 0, 4]);
    expect(f.provider.getCode).not.toHaveBeenCalled();
  });
  it('reads only newly confirmed blocks after the initial index build', async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '12000');
    vi.stubEnv('CHAIN_EVENT_CONFIRMATIONS', '2');
    const f = fixture();
    await queryContractEvents(f.contract, supplierAFilter);
    expect(f.queryFilter.mock.calls.at(-1)).toEqual(['*', 22_000, 24_003]);
    f.setTip(24_008);
    await queryContractEvents(f.contract, supplierAFilter);
    expect(f.queryFilter.mock.calls.at(-1)).toEqual(['*', 24_004, 24_006]);
  });
  it('rebuilds the complete index when the confirmed checkpoint changes', async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '12000');
    const f = fixture();
    await queryContractEvents(f.contract, supplierAFilter);
    f.reorg();
    await queryContractEvents(f.contract, supplierAFilter);
    expect(f.queryFilter.mock.calls.at(-3)).toEqual(['*', 12_000, 16_999]);
  });
});

describe('Shared multi-contract scan', () => {
  const second = '0x00000000000000000000000000000000000000bb';
  beforeEach(() => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '24000');
    vi.stubEnv('CHAIN_EVENT_CONFIRMATIONS', '0');
  });
  afterEach(() => vi.unstubAllEnvs());
  function twoContracts() {
    const f = fixture();
    const other = {
      ...(f.contract as unknown as Record<string, unknown>),
      getAddress: async () => second,
    } as unknown as BaseContract;
    // Logs for both addresses arrive in one response and must be split by address.
    f.provider.getLogs.mockImplementation(async (filter: any) => {
      await f.queryFilter('*', filter.fromBlock, filter.toBlock);
      return [
        { ...encoded('Noted', [1], filter.toBlock, 0) },
        { ...encoded('Noted', [2], filter.toBlock, 1), address: second },
      ];
    });
    return { f, other };
  }

  it('advances every contract with one log request per new range', async () => {
    vi.stubEnv('CHAIN_EVENT_HEAD_CACHE_MS', '0');
    const { f, other } = twoContracts();
    await Promise.all([
      queryContractEvents(f.contract, notedFilter),
      queryContractEvents(other, notedFilter),
    ]);
    const before = f.provider.getLogs.mock.calls.length;
    f.setTip(24_010);
    const [a, b] = (await Promise.all([
      queryContractEvents(f.contract, notedFilter),
      queryContractEvents(other, notedFilter),
    ])) as EventLog[][];
    expect(f.provider.getLogs.mock.calls.length - before).toBe(1);
    expect(f.provider.getLogs.mock.calls.at(-1)![0]).toMatchObject({
      address: ['0x00000000000000000000000000000000000000aa', second],
      fromBlock: 24_006,
      toBlock: 24_010,
    });
    expect(a.map((log) => Number(log.args.value))).toEqual([1, 1]);
    expect(b.map((log) => Number(log.args.value))).toEqual([2, 2]);
  });

  it('asks for the chain head once per short window instead of once per contract', async () => {
    const { f, other } = twoContracts();
    await queryContractEvents(f.contract, notedFilter);
    await queryContractEvents(other, notedFilter);
    await queryContractEvents(f.contract, notedFilter);
    expect(f.provider.getBlockNumber).toHaveBeenCalledTimes(1);
  });

  it.each(['query returned more than 10000 results', 'block range exceeds limit'])(
    'halves a rejected range: %s',
    async (message) => {
      vi.stubEnv('CHAIN_EVENT_HEAD_CACHE_MS', '0');
      const f = fixture();
      f.provider.getLogs
        .mockRejectedValueOnce(new Error(message))
        .mockImplementation(async (filter: any) =>
          f.queryFilter('*', filter.fromBlock, filter.toBlock),
        );
      await queryContractEvents(f.contract, notedFilter);
      expect(f.queryFilter.mock.calls).toEqual([
        ['*', 24_000, 24_002],
        ['*', 24_003, 24_005],
      ]);
    },
  );
});

describe('Persisted contract event index', () => {
  let directory: string;
  beforeEach(async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '12000');
    vi.stubEnv('CHAIN_EVENT_CONFIRMATIONS', '0');
    vi.stubEnv('CHAIN_EVENT_HEAD_CACHE_MS', '0');
    directory = await mkdtemp(join(tmpdir(), 'tracechain-events-'));
    configureEventIndexStore(directory);
  });
  afterEach(async () => {
    configureEventIndexStore(undefined);
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  const savedFile = () =>
    join(
      directory,
      'event-index',
      '11155111-0x00000000000000000000000000000000000000aa-12000.json',
    );

  it('restores a saved index after a restart without rescanning history', async () => {
    await queryContractEvents(fixture().contract, supplierAFilter);
    await vi.waitFor(() => expect(existsSync(savedFile())).toBe(true));
    const restarted = fixture();
    const logs = (await queryContractEvents(restarted.contract, supplierAFilter)) as EventLog[];
    expect(restarted.queryFilter).not.toHaveBeenCalled();
    expect(logs.map((log) => log.args.supplier)).toEqual([supplierA, supplierA, supplierA]);
  });
  it('rebuilds a saved index whose checkpoint no longer matches the chain', async () => {
    await queryContractEvents(fixture().contract, supplierAFilter);
    await vi.waitFor(() => expect(existsSync(savedFile())).toBe(true));
    const restarted = fixture();
    restarted.reorg();
    await queryContractEvents(restarted.contract, supplierAFilter);
    expect(restarted.queryFilter.mock.calls[0]).toEqual(['*', 12_000, 16_999]);
  });
  it('never persists local development chains', async () => {
    await queryContractEvents(fixture(12_000, 31337n).contract, supplierAFilter);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(join(directory, 'event-index'))).toBe(false);
  });
});
