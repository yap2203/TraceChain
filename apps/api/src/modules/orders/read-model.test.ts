import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyIndexUpdate,
  clearReadModel,
  configureReadModelStore,
  ReadModelGateway,
} from './read-model.js';

const order = `0x${'a1'.repeat(32)}`;
const other = `0x${'b2'.repeat(32)}`;
const batch = `0x${'c3'.repeat(32)}`;

function fakeGateway() {
  const state: Record<string, unknown> = {
    [`getOrder:${order}`]: { status: '1', batchId: batch },
    [`getOrder:${other}`]: { status: '1' },
    [`getBatch:${batch}`]: { available: '10' },
    policy: '1',
  };
  const read = vi.fn(async (_contract: string, method: string, args: unknown[] = []) =>
    structuredClone(state[args.length ? `${method}:${args[0]}` : method]),
  );
  return {
    state,
    read,
    inner: {
      chainId: 11155111,
      address: `0x${'1'.repeat(40)}`,
      read,
      events: vi.fn(async () => []),
      prepare: vi.fn(),
      syncEvents: vi.fn(async () => {}),
    },
  };
}

const scan = (topics: string[], data = '0x') =>
  applyIndexUpdate({
    key: 'k',
    kind: 'scan',
    block: 100,
    logs: [
      {
        address: '0x0',
        blockNumber: 100,
        blockHash: '0x',
        transactionHash: '0x',
        transactionIndex: 0,
        index: 0,
        data,
        topics: [`0x${'00'.repeat(32)}`, ...topics],
        removed: false,
      },
    ],
  });

afterEach(() => {
  clearReadModel();
  configureReadModelStore(undefined);
});

describe('ReadModelGateway', () => {
  it('serves repeat page reads from memory and keeps action reads live', async () => {
    const { inner, read } = fakeGateway();
    const gateway = new ReadModelGateway(inner);
    const page = () => gateway.display(() => gateway.read('orders', 'getOrder', [order]));
    expect(await page()).toEqual({ status: '1', batchId: batch });
    const copy = (await page()) as Record<string, unknown>;
    copy.status = 'mutated';
    expect(await page()).toEqual({ status: '1', batchId: batch });
    expect(read).toHaveBeenCalledTimes(1);
    await gateway.read('orders', 'getOrder', [order]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('re-reads only what a confirmed event names, plus records linked by its result', async () => {
    const { inner, read, state } = fakeGateway();
    const gateway = new ReadModelGateway(inner);
    const reads = () =>
      gateway.display(() =>
        Promise.all([
          gateway.read('orders', 'getOrder', [order]),
          gateway.read('orders', 'getOrder', [other]),
          gateway.read('ingredients', 'getBatch', [batch]),
          gateway.read('orders', 'policy'),
        ]),
      );
    await reads();
    expect(read).toHaveBeenCalledTimes(4);
    state[`getOrder:${order}`] = { status: '2', batchId: batch };
    scan([order]);
    const [changed, untouched] = await reads();
    expect(changed).toEqual({ status: '2', batchId: batch });
    expect(untouched).toEqual({ status: '1' });
    // order, its batch and the no-argument policy flag are re-read; the other order is not.
    expect(read).toHaveBeenCalledTimes(7);
    expect(
      read.mock.calls.slice(4).filter((call) => call[1] === 'getOrder' && call[2]?.[0] === other),
    ).toHaveLength(0);
  });

  it('matches identifiers carried in event data, not only indexed topics', async () => {
    const { inner, read } = fakeGateway();
    const gateway = new ReadModelGateway(inner);
    const page = () => gateway.display(() => gateway.read('orders', 'getOrder', [other]));
    await page();
    scan([], `0x${'00'.repeat(32)}${other.slice(2)}`);
    await page();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('falls back to live reads when events cannot be synced, and refresh bypasses the cache', async () => {
    const { inner, read } = fakeGateway();
    const gateway = new ReadModelGateway(inner);
    const page = (refresh = false) =>
      gateway.display(() => gateway.read('orders', 'getOrder', [order]), refresh);
    await page();
    await page(true);
    expect(read).toHaveBeenCalledTimes(2);
    inner.syncEvents.mockRejectedValueOnce(new Error('rpc down'));
    const failing = new ReadModelGateway(inner);
    await failing.display(() => failing.read('orders', 'getOrder', [order]));
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('drops saved entries for events confirmed while the API was stopped', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'read-model-'));
    vi.useFakeTimers();
    try {
      configureReadModelStore(directory);
      const { inner, read } = fakeGateway();
      const gateway = new ReadModelGateway(inner);
      applyIndexUpdate({ key: 'k', kind: 'scan', block: 100, logs: [] });
      const both = (target: ReadModelGateway) =>
        target.display(() =>
          Promise.all([
            target.read('orders', 'getOrder', [order]),
            target.read('orders', 'getOrder', [other]),
          ]),
        );
      await both(gateway);
      await vi.advanceTimersByTimeAsync(1_500);
      // Simulate a restart: drop memory without overwriting the saved file.
      configureReadModelStore(undefined);
      clearReadModel();
      configureReadModelStore(directory);
      const restarted = new ReadModelGateway(inner);
      applyIndexUpdate({
        key: 'k',
        kind: 'restore',
        block: 120,
        logs: [
          {
            address: '0x0',
            blockNumber: 110,
            blockHash: '0x',
            transactionHash: '0x',
            transactionIndex: 0,
            index: 0,
            data: '0x',
            topics: [`0x${'00'.repeat(32)}`, order],
            removed: false,
          },
        ],
      });
      await both(restarted);
      // The untouched order comes from disk; only the one named by the missed event is re-read.
      expect(read).toHaveBeenCalledTimes(3);
      expect(read.mock.calls[2][2]).toEqual([order]);
    } finally {
      vi.useRealTimers();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
