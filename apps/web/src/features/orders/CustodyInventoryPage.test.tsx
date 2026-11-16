// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./orders.api', () => ({ getOrders: api.get }));
import { CustodyInventoryPage } from './CustodyInventoryPage';
const supplier = '0x1000000000000000000000000000000000000001',
  actor = '0x2000000000000000000000000000000000000002',
  other = '0x3000000000000000000000000000000000000003';
const id = (s: string) => '0x' + s.repeat(64);
const state = {
  actor,
  role: 'DISTRIBUTOR',
  warehouseSupported: true,
  catalogue: [
    { batches: [id('1')], name: 'Owned flour', sellerName: 'Supplier One' },
    { batches: [id('2')], name: 'Foreign flour' },
  ],
  locations: [],
  logistics: {
    positions: [
      {
        positionId: id('a'),
        batchId: id('1'),
        distributor: actor,
        supplier,
        warehouseName: 'My warehouse',
        quantity: '70',
        reserved: '20',
        available: '50',
        unit: 'kg',
      },
      {
        positionId: id('b'),
        batchId: id('2'),
        distributor: other,
        supplier: other,
        warehouseName: 'Private foreign warehouse',
        quantity: '999',
        reserved: '1',
        available: '998',
        unit: 'kg',
      },
    ],
    productStock: [],
    shipments: [],
  },
};
beforeEach(() => api.get.mockResolvedValue(structuredClone(state)));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('opens owned custody details and never renders another Distributor’s stock', async () => {
  render(
    <MemoryRouter>
      <CustodyInventoryPage role="distributor" />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Owned flour')).toBeTruthy();
  expect(screen.queryByText('Foreign flour')).toBeNull();
  expect(screen.queryByText('Private foreign warehouse')).toBeNull();
  expect(screen.getByText('My warehouse')).toBeTruthy();
  expect(screen.getByText('50 kg')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View details' }));
  expect(screen.getByText('70 kg')).toBeTruthy();
  expect(screen.getByText('20 kg')).toBeTruthy();
  expect(screen.getByText('50 kg')).toBeTruthy();
  expect(screen.getByText('Technical details')).toBeTruthy();
});
it('denies an unrelated custody-detail URL', async () => {
  render(
    <MemoryRouter initialEntries={['/distributor/inventory?id=' + id('b')]}>
      <CustodyInventoryPage role="distributor" />
    </MemoryRouter>,
  );
  expect(await screen.findByText(/not available to your company/)).toBeTruthy();
  expect(screen.queryByText('Foreign flour')).toBeNull();
});
it('lets a Supplier inspect only its own batches held by custodians', async () => {
  api.get.mockResolvedValue({ ...structuredClone(state), actor: supplier, role: 'SUPPLIER' });
  render(
    <MemoryRouter>
      <CustodyInventoryPage role="supplier" />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Owned flour')).toBeTruthy();
  expect(screen.queryByText('Foreign flour')).toBeNull();
});
