// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ReadModelStatus } from './ReadModelStatus';
import type { OrdersState } from './orders.api';

afterEach(() => {
  cleanup();
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
  expect(screen.getByRole('status').textContent).toContain('Use Refresh when you need it');
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
