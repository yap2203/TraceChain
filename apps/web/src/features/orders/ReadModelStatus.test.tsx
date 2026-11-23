// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadModelStatus, useReadModelRefresh } from './ReadModelStatus';
import type { OrdersState } from './orders.api';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const state: OrdersState = {
  actor: 'company',
  role: 'SUPPLIER',
  orders: [],
  catalogue: [],
  shipments: [],
  locations: [],
  readModel: {
    updatedAt: '2026-11-23T00:00:00.000Z',
    stale: true,
    refreshing: true,
    refreshFailed: false,
  },
};
it('labels saved data while updating and distinguishes refresh failure', () => {
  const view = render(<ReadModelStatus state={state} />);
  expect(screen.getByRole('status').textContent).toContain('Updating from blockchain');
  expect(screen.getByRole('status').textContent).toContain('Last updated');
  view.rerender(
    <ReadModelStatus
      state={{
        ...state,
        readModel: { ...state.readModel!, refreshing: false, refreshFailed: true },
      }}
    />,
  );
  expect(screen.getByRole('status').textContent).toContain('Showing the last loaded records');
});
it('deduplicates refresh polling and reports a failure without repeated retries', async () => {
  vi.useFakeTimers();
  let reject!: (error: Error) => void;
  const refresh = vi.fn(
    () =>
      new Promise<void>((_resolve, no) => {
        reject = no;
      }),
  );
  const failure = vi.fn();
  const hook = renderHook(() => useReadModelRefresh(state, refresh, failure));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error('RPC unavailable'));
  });
  expect(failure).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  hook.unmount();
});
