// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const reload = vi.fn().mockResolvedValue(undefined);

vi.mock('../blockchain/useOperationalData', () => ({
  useOperationalData: () => ({
    data: { evidenceRequests: [], ingredientBatches: [], productBatches: [], transfers: [] },
    error: '',
    loading: false,
    reload,
  }),
}));
vi.mock('../custody-transfers', () => ({
  TransferQrScanner: ({ onResolved }: { onResolved: () => void }) => (
    <button type="button" onClick={onResolved}>
      Simulate verified transfer refresh
    </button>
  ),
}));

import { ReceiptGatedFlow } from '../workspaces/receipts/ReceiptGatedFlow';

afterEach(() => {
  cleanup();
  reload.mockClear();
});

it('refreshes wallet-scoped transfer and inventory data after scanner verification', () => {
  render(<ReceiptGatedFlow role="retailer" onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Simulate verified transfer refresh' }));
  expect(reload).toHaveBeenCalledOnce();
});
