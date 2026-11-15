// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../orders/orders.api', () => ({ getBusinessTraceability: api.get }));
import { TraceabilityWorkspace } from './TraceabilityWorkspace';
const ingredient = '0x' + '12'.repeat(32),
  product = '0x' + '34'.repeat(32);
const record = {
  batchId: ingredient,
  name: 'Actual ingredient',
  supplier: 'Actual Supplier',
  quantityUsed: '12',
  unit: 'kg',
  registryStatus: 1,
  expiresAt: 2_000_000_000,
};
const data = {
  roots: [{ batchId: product, kind: 'product', name: 'Actual product', reference: 'PROD-1' }],
  root: { batchId: product, kind: 'product', name: 'Actual product', reference: 'PROD-1' },
  routes: [
    {
      id: product,
      productBatchId: product,
      name: 'Actual product',
      ingredients: [record],
      stages: [
        {
          id: 'source',
          title: 'Supplier',
          state: 'recorded',
          records: [{ ...record, privateKey: 'never-display' }],
        },
        {
          id: 'ingredient-delivery',
          title: 'Ingredient logistics',
          state: 'not-recorded',
          records: [],
        },
        {
          id: 'production',
          title: 'Manufacturer',
          state: 'recorded',
          records: [
            {
              company: 'Actual Manufacturer',
              product: 'Actual product',
              quantity: '20',
              unit: 'each',
            },
          ],
        },
        {
          id: 'product-delivery',
          title: 'Product logistics',
          state: 'in-progress',
          records: [
            {
              sender: 'Actual Manufacturer',
              recipient: 'Actual Retailer',
              status: 'Dispatched; receipt pending',
            },
          ],
        },
        { id: 'retail', title: 'Retailer receipt', state: 'not-recorded', records: [] },
      ],
    },
  ],
};
function Location() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname + location.search}</output>;
}
beforeEach(() => api.get.mockResolvedValue(structuredClone(data)));
it.each(['supplier', 'manufacturer', 'distributor', 'retailer'] as const)(
  'shows one stage flow without direction buttons for %s',
  async (role) => {
    render(
      <MemoryRouter>
        <TraceabilityWorkspace role={role} />
      </MemoryRouter>,
    );
    await screen.findByLabelText('Batch to trace');
    expect(screen.queryByRole('button', { name: 'Supplier → Retailer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retailer → Supplier' })).toBeNull();
    const stages = screen.getAllByRole('button', {
      name: /Records available|Not recorded|In progress/,
    });
    expect(stages[0].textContent).toContain(role === 'retailer' ? 'Retailer receipt' : 'Supplier');
  },
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('opens actual recorded stages, reverses their order and leaves missing stages unrecorded', async () => {
  render(
    <MemoryRouter>
      <TraceabilityWorkspace role="supplier" />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Actual Supplier')).toBeTruthy();
  expect(screen.queryByText('never-display')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Manufacturer/ }));
  expect(screen.getByText('Actual Manufacturer')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Retailer → Supplier/ })).toBeNull();
  expect(
    screen.getAllByRole('button', { name: /Records available|Not recorded|In progress/ })[0]
      .textContent,
  ).toContain('Supplier');
  fireEvent.click(screen.getByRole('button', { name: /Retailer receipt/ }));
  expect(screen.getByText('No activity has been recorded for this stage.')).toBeTruthy();
});
it('opens a Retailer evidence request with the exact product and ingredient context', async () => {
  render(
    <MemoryRouter>
      <TraceabilityWorkspace role="retailer" />
      <Location />
    </MemoryRouter>,
  );
  await screen.findByText('No activity has been recorded for this stage.');
  expect(screen.queryByRole('button', { name: /Supplier → Retailer/ })).toBeNull();
  expect(
    screen.getAllByRole('button', { name: /Records available|Not recorded|In progress/ })[0]
      .textContent,
  ).toContain('Retailer receipt');
  fireEvent.click(screen.getByRole('button', { name: /Supplier.*Records available/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Request ingredient evidence' }));
  const route = screen.getByLabelText('Current route').textContent!;
  expect(route).toContain('/retailer/information-requests/sent');
  expect(route).toContain('batchId=' + ingredient);
  expect(route).toContain('productBatchId=' + product);
});
it('shows an empty state or an outage instead of invented traceability', async () => {
  api.get.mockResolvedValueOnce({ roots: [], root: null, routes: [] });
  const view = render(
    <MemoryRouter>
      <TraceabilityWorkspace role="supplier" />
    </MemoryRouter>,
  );
  expect(await screen.findByText('No traceability records yet')).toBeTruthy();
  view.unmount();
  api.get.mockRejectedValueOnce(new Error('RPC unavailable'));
  render(
    <MemoryRouter>
      <TraceabilityWorkspace role="retailer" />
    </MemoryRouter>,
  );
  expect(await screen.findByText('RPC unavailable')).toBeTruthy();
  expect(screen.queryByText('Actual Supplier')).toBeNull();
});
