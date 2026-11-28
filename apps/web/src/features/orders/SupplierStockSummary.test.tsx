// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SupplierStockSummary } from './SupplierStockSummary';

afterEach(cleanup);
const stock = {
  batchId: 'batch',
  unit: 'kg',
  availableQuantity: '100',
  pendingQuantity: '20',
  approvedQuantity: '30',
  outstandingQuantity: '50',
  remainingAfterRequests: '50',
  shortfall: '0',
  requestCount: 2,
};

it('maps the short labels to the existing stock quantities without presenting estimates as reservations', () => {
  render(<SupplierStockSummary stock={stock} />);
  for (const [label, amount] of [
    ['Current stock', '100 kg'],
    ['Estimated remaining', '50 kg'],
    ['Pending requests', '20 kg'],
    ['Approved, not dispatched', '30 kg'],
  ])
    expect(screen.getByText(label).parentElement?.querySelector('dd')?.textContent).toBe(amount);
  expect(screen.queryByText('Current on-chain stock')).toBeNull();
  const help = screen.getByText('How stock is estimated').closest('details');
  expect(help?.open).toBe(false);
  expect(help?.textContent).toContain('not guaranteed');
  expect(help?.textContent).toContain('do not reserve stock');
  expect(document.querySelector('.supplier-stock__note')).toBeNull();
});

it('keeps incomplete data distinct from zero and keeps the shortfall warning visible', () => {
  const { rerender } = render(
    <SupplierStockSummary stock={{ ...stock, remainingAfterRequests: null, shortfall: null }} />,
  );
  expect(screen.getByText('Unavailable: incomplete request data')).toBeTruthy();
  rerender(
    <SupplierStockSummary stock={{ ...stock, remainingAfterRequests: '0', shortfall: '12' }} />,
  );
  expect(screen.getByRole('status').textContent).toContain('exceed current stock by 12 kg');
  expect(screen.getByText('Estimated remaining').parentElement?.textContent).toContain('0 kg');
});
