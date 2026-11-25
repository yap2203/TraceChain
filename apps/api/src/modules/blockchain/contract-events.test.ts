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
  const provider = {
    getBlockNumber: vi.fn(async () => tip),
    getNetwork: vi.fn(async () => ({ chainId })),
    getBlock: vi.fn(async (block: number) => ({ hash: `hash-${hashVersion}-${block}` })),
    getCode: vi.fn(async (_address: string, block: number) =>
      block >= deployedAt ? '0x1234' : '0x',
    ),
  };
  // Each page holds one log per supplier plus one unrelated event.
  const queryFilter = vi.fn(async (_filter: unknown, from: number, to: number) => {
    if (to - from + 1 > 10_000) throw new Error('RPC range exceeded');
    return [
      encoded('Supplied', [supplierA, from], from, 0),
      encoded('Supplied', [supplierB, from], from, 1),
      encoded('Noted', [to], to, 2),
    ];
  });
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
  beforeEach(() => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '');
    vi.stubEnv('CHAIN_EVENT_CONFIRMATIONS', '0');
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
    await expect(queryContractEvents(f.contract, supplierAFilter)).rejects.toThrow(
      'RPC unavailable',
    );
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

describe('Persisted contract event index', () => {
  let directory: string;
  beforeEach(async () => {
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '12000');
    vi.stubEnv('CHAIN_EVENT_CONFIRMATIONS', '0');
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
