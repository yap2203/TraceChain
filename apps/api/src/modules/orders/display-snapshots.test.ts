import { afterEach, expect, it, vi } from 'vitest';
import { DisplaySnapshots } from './display-snapshots.js';

afterEach(() => vi.restoreAllMocks());
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

it('returns the last display rows immediately while deduplicating background refresh', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const cache = new DisplaySnapshots<{ status: string }>();
  const next = deferred<{ status: string }>();
  const load = vi
    .fn()
    .mockResolvedValueOnce({ status: 'submitted' })
    .mockImplementation(() => next.promise);
  const first = await cache.get('company-a', load);
  first.value.status = 'changed by caller';
  clock.mockReturnValue(7000);
  const stale = await cache.get('company-a', load);
  expect(stale.value.status).toBe('submitted');
  expect(stale.readModel).toMatchObject({ stale: true, refreshing: true });
  await cache.get('company-a', load);
  expect(load).toHaveBeenCalledTimes(2);
  next.resolve({ status: 'approved' });
  const fresh = await cache.get('company-a', load, true);
  expect(fresh.value.status).toBe('approved');
  expect(fresh.readModel).toMatchObject({ stale: false, refreshing: false });
});

it('coalesces cold reads, isolates wallets, and invalidates without resurrecting an old pending result', async () => {
  const cache = new DisplaySnapshots<string>();
  const old = deferred<string>();
  const load = vi.fn(() => old.promise);
  const one = cache.get('a', load),
    two = cache.get('a', load);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
  expect((await cache.get('b', async () => 'b')).value).toBe('b');
  cache.invalidate();
  expect((await cache.get('a', async () => 'new')).value).toBe('new');
  old.resolve('old');
  await Promise.all([one, two]);
  expect((await cache.get('a', async () => 'unexpected')).value).toBe('new');
});

it('labels background failures, backs off, and stops serving expired snapshots', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const cache = new DisplaySnapshots<string>();
  await cache.get('a', async () => 'old');
  clock.mockReturnValue(7000);
  const fail = vi.fn().mockRejectedValue(new Error('RPC busy'));
  await cache.get('a', fail);
  await new Promise((resolve) => setImmediate(resolve));
  const stale = await cache.get('a', fail);
  expect(stale.readModel).toMatchObject({ refreshFailed: true, stale: true });
  expect(fail).toHaveBeenCalledTimes(1);
  await expect(cache.get('a', fail, true)).rejects.toThrow('RPC busy');
  clock.mockReturnValue(122000);
  await expect(cache.get('a', fail)).rejects.toThrow('RPC busy');
});
