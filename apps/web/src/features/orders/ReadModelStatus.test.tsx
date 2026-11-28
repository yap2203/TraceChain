// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadModelStatus } from './ReadModelStatus';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const state = {
  readModel: {
    updatedAt: '2026-11-28T10:00:00Z',
    stale: false,
    refreshing: false,
    refreshFailed: false,
  },
};

it('updates the relative display clock without fetching, and cleans up its timer', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-28T10:02:00Z'));
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const { unmount } = render(<ReadModelStatus state={state} />);
  expect(screen.getByRole('status').textContent).toBe('Updated 2 minutes ago');
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByRole('status').textContent).toBe('Updated 3 minutes ago');
  expect(fetch).not.toHaveBeenCalled();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('separates refresh progress, stale data, failed refresh and missing timestamps', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-28T10:02:00Z'));
  const { rerender } = render(<ReadModelStatus state={state} refreshing />);
  expect(screen.getByRole('status').textContent).toContain('Refreshing');
  rerender(<ReadModelStatus state={{ readModel: { ...state.readModel, stale: true } }} />);
  expect(screen.getByRole('status').textContent).toContain('Stale data');
  rerender(<ReadModelStatus state={state} failed />);
  expect(screen.getByRole('status').textContent).toContain('Refresh failed');
  rerender(
    <ReadModelStatus state={{ readModel: { ...state.readModel, refreshing: true } }} failed />,
  );
  expect(screen.getByRole('status').textContent).toContain('Refresh failed');
  rerender(<ReadModelStatus state={{ readModel: { ...state.readModel, updatedAt: 'invalid' } }} />);
  expect(screen.getByRole('status').textContent).toBe('Update time unavailable');
  rerender(<ReadModelStatus />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('labels a saved server snapshot while it updates and distinguishes a failed server refresh', () => {
  const { rerender } = render(
    <ReadModelStatus
      state={{ readModel: { ...state.readModel, stale: true, refreshing: true } }}
    />,
  );
  expect(screen.getByRole('status').textContent).toContain('Refreshing');
  rerender(
    <ReadModelStatus
      state={{
        readModel: { ...state.readModel, stale: true, refreshing: false, refreshFailed: true },
      }}
    />,
  );
  expect(screen.getByRole('status').textContent).toContain('Refresh failed');
  expect(screen.getByRole('status').textContent).toContain('saved records');
});
