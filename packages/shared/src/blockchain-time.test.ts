import { afterEach, expect, it, vi } from 'vitest';
import { waitForMinedBlockTime } from './blockchain-time.js';

afterEach(() => vi.useRealTimers());
const occurredAt = 1795860419;

it('waits for the 11-second lag with bounded polling and preserves the target time', async () => {
  vi.useFakeTimers();
  const started = Date.now(),
    waiting = vi.fn();
  const read = vi.fn(async () => ({
    number: 12229380,
    timestamp: occurredAt - 11 + Math.floor((Date.now() - started) / 1000),
  }));
  const pending = waitForMinedBlockTime(read, occurredAt, { onWaiting: waiting });
  await vi.advanceTimersByTimeAsync(11_000);
  expect(read).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1_000);
  expect((await pending).timestamp).toBeGreaterThanOrEqual(occurredAt);
  expect(read).toHaveBeenCalledTimes(5);
  expect(waiting).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('times out without hanging on an unresponsive read and allows the same timestamp on retry', async () => {
  vi.useFakeTimers();
  const read = vi.fn(() => new Promise<{ number: number; timestamp: number }>(() => {}));
  const pending = waitForMinedBlockTime(read, occurredAt).catch((error) => error);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await pending).toMatchObject({ code: 'BLOCKCHAIN_TIME_TIMEOUT' });
  expect(read).toHaveBeenCalledTimes(1);
  await expect(
    waitForMinedBlockTime(
      async () => ({ number: 12229381, timestamp: occurredAt + 1 }),
      occurredAt,
    ),
  ).resolves.toMatchObject({ timestamp: occurredAt + 1 });
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels polling, releases timers and ignores a late provider response', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let finish!: (block: { number: number; timestamp: number }) => void;
  const read = vi.fn(
    () =>
      new Promise<{ number: number; timestamp: number }>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = waitForMinedBlockTime(read, occurredAt, { signal: controller.signal }).catch(
    (error) => error,
  );
  controller.abort();
  expect(await pending).toMatchObject({ code: 'HANDOFF_CANCELLED' });
  finish({ number: 12229381, timestamp: occurredAt + 1 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not turn a genuine RPC failure into a successful block or a clock timeout', async () => {
  const error = new Error('RPC unavailable');
  await expect(
    waitForMinedBlockTime(async () => {
      throw error;
    }, occurredAt),
  ).rejects.toBe(error);
});
