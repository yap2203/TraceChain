// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrdersState } from './orders.api';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./orders.api', () => ({ getOrders: api.get }));

import { CustodyInventoryPage } from './CustodyInventoryPage';

const supplier = '0x1000000000000000000000000000000000000001';
const actor = '0x2000000000000000000000000000000000000002';
const other = '0x3000000000000000000000000000000000000003';
const manufacturer = '0x4000000000000000000000000000000000000004';
const location = '0x5000000000000000000000000000000000000005';
const id = (value: string) => `0x${value.repeat(64)}`;

const state: OrdersState = {
  actor,
  role: 'DISTRIBUTOR',
  warehouseSupported: true,
  companies: [
    { wallet: supplier, companyName: 'Supplier One', role: 'SUPPLIER' },
    { wallet: actor, companyName: 'Distributor One', role: 'DISTRIBUTOR' },
    { wallet: manufacturer, companyName: 'Manufacturer One', role: 'MANUFACTURER' },
  ],
  catalogue: [
    {
      batches: [id('1')],
      name: 'Owned flour',
      seller: supplier,
      sellerName: 'Supplier One',
      batchReference: 'FLOUR-001',
      category: 'Flour',
      active: true,
    },
    { batches: [id('2')], name: 'Foreign flour', seller: other, active: true },
  ],
  orders: [],
  shipments: [],
  locations: [{ location, label: 'My warehouse' }],
  logistics: {
    warehouses: [],
    positions: [
      {
        positionId: id('a'),
        batchId: id('1'),
        distributor: actor,
        distributorName: 'Distributor One',
        supplier,
        supplierName: 'Supplier One',
        location,
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
    productPositions: [],
    shipments: [],
  },
};

function renderPage(
  role: 'supplier' | 'distributor' | 'manufacturer' = 'distributor',
  initialKind?: 'ingredient' | 'product',
  route = '/inventory',
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <CustodyInventoryPage role={role} initialKind={initialKind} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  api.get.mockResolvedValue(structuredClone(state));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('shared custody inventory presentation', () => {
  it('renders Distributor Ingredient custody with the shared list layout and private stock only', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Ingredient custody' })).toBeTruthy();
    expect(screen.queryByText('Foreign flour')).toBeNull();
    expect(screen.queryByText('Private foreign warehouse')).toBeNull();
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByLabelText('Ingredient custody summary')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Flour image placeholder' })).toBeTruthy();
    expect(screen.getByLabelText('Supplier One initials')).toBeTruthy();

    const card = document.querySelector(`[data-inventory-id="${id('a')}"]`)!;
    expect(card.classList.contains('ingredient-card--list')).toBe(true);
    expect(within(card as HTMLElement).getAllByText('My warehouse').length).toBeGreaterThan(0);
    expect(within(card as HTMLElement).getAllByText('50 kg').length).toBeGreaterThan(0);
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'View details' }));

    expect(screen.getByText('70 kg')).toBeTruthy();
    expect(screen.getByText('20 kg')).toBeTruthy();
    expect(screen.getByText('50 kg')).toBeTruthy();
    const technical = screen.getByText('Technical details').closest('details');
    expect(technical?.open).toBe(false);
  });

  it('switches views without fetching again, preserves filters and remembers the selected view', async () => {
    const rendered = renderPage();
    await screen.findByText('Owned flour');
    expect(api.get).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Search custody inventory'), {
      target: { value: 'Owned' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue('Owned')).toBeTruthy();
    expect(document.querySelector('.ingredient-grid--grid')).toBeTruthy();
    expect(window.localStorage.getItem('tracechain:distributor-ingredient-custody-view')).toBe(
      'grid',
    );

    rendered.unmount();
    renderPage();
    await screen.findByText('Owned flour');
    expect(screen.getByRole('button', { name: 'Grid view' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('expands only the selected record and keeps expansion state after filtering', async () => {
    const next = structuredClone(state);
    next.catalogue.push({
      batches: [id('3')],
      name: 'Cocoa nibs',
      seller: supplier,
      sellerName: 'Supplier One',
      batchReference: 'COCOA-003',
      category: 'Cocoa',
      active: true,
    });
    next.logistics!.positions.push({
      positionId: id('c'),
      batchId: id('3'),
      distributor: actor,
      distributorName: 'Distributor One',
      supplier,
      supplierName: 'Supplier One',
      location,
      warehouseName: 'My warehouse',
      quantity: '10',
      reserved: '10',
      available: '0',
      unit: 'kg',
    });
    api.get.mockResolvedValue(next);
    renderPage();

    const first = await inventoryCard(id('a'));
    const second = await inventoryCard(id('c'));
    fireEvent.click(within(first).getByRole('button', { name: 'Show more' }));
    expect(within(first).getByRole('button', { name: 'Show less' })).toBeTruthy();
    expect(within(second).getByRole('button', { name: 'Show more' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search custody inventory'), {
      target: { value: 'Cocoa' },
    });
    expect(screen.queryByText('Owned flour')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search custody inventory'), { target: { value: '' } });
    expect(
      within(await inventoryCard(id('a'))).getByRole('button', { name: 'Show less' }),
    ).toBeTruthy();
  });

  it('keeps Distributor Product custody role wording and product data', async () => {
    const next = structuredClone(state);
    next.catalogue.push({
      batches: [id('4')],
      name: 'Finished chocolate',
      seller: manufacturer,
      sellerName: 'Manufacturer One',
      batchReference: 'CHOCO-004',
      category: 'Chocolate',
      active: true,
    });
    next.logistics!.productStock.push({
      batchId: id('4'),
      supplier: manufacturer,
      supplierName: 'Manufacturer One',
      distributor: actor,
      distributorName: 'Distributor One',
      location,
      warehouseName: 'My warehouse',
      quantity: '30',
      reserved: '5',
      available: '25',
      unit: 'units',
    });
    api.get.mockResolvedValue(next);
    renderPage('distributor', 'product');

    expect(await screen.findByRole('heading', { name: 'Product custody' })).toBeTruthy();
    expect(screen.getByText('Finished chocolate')).toBeTruthy();
    expect(screen.getAllByText('Manufacturer One').length).toBeGreaterThan(0);
    expect(screen.queryByText('Owned flour')).toBeNull();
  });

  it('keeps Supplier custody scoped to Supplier-owned batches', async () => {
    api.get.mockResolvedValue({ ...structuredClone(state), actor: supplier, role: 'SUPPLIER' });
    renderPage('supplier');

    expect(await screen.findByRole('heading', { name: 'My stock in custody' })).toBeTruthy();
    expect(screen.getByText('Owned flour')).toBeTruthy();
    expect(screen.queryByText('Foreign flour')).toBeNull();
    expect(screen.getByText('Supplier-owned stock in Distributor custody.')).toBeTruthy();
  });

  it('keeps Manufacturer product custody on its product-position source', async () => {
    const next = structuredClone(state);
    next.actor = manufacturer;
    next.role = 'MANUFACTURER';
    next.catalogue.push({
      batches: [id('5')],
      name: 'Manufacturer product',
      seller: manufacturer,
      sellerName: 'Manufacturer One',
      batchReference: 'PRODUCT-005',
      category: 'Finished goods',
      active: true,
    });
    next.logistics!.productPositions!.push({
      batchId: id('5'),
      supplier: manufacturer,
      supplierName: 'Manufacturer One',
      distributor: actor,
      distributorName: 'Distributor One',
      location,
      warehouseName: 'My warehouse',
      quantity: '40',
      reserved: '10',
      available: '30',
      unit: 'units',
    });
    next.logistics!.productStock.push({
      batchId: id('4'),
      supplier: other,
      distributor: actor,
      quantity: '999',
      reserved: '0',
      available: '999',
      unit: 'units',
    });
    api.get.mockResolvedValue(next);
    renderPage('manufacturer');

    expect(await screen.findByRole('heading', { name: 'My products in custody' })).toBeTruthy();
    expect(screen.getByText('Manufacturer product')).toBeTruthy();
    expect(screen.queryByText('Registered product')).toBeNull();
    expect(screen.getByText('Manufacturer-owned stock in Distributor custody.')).toBeTruthy();
  });

  it('denies an unrelated custody-detail URL', async () => {
    renderPage('distributor', 'ingredient', `/distributor/inventory?id=${id('b')}`);
    expect(await screen.findByText(/not available to your company/)).toBeTruthy();
    expect(screen.queryByText('Foreign flour')).toBeNull();
  });
});

async function inventoryCard(recordId: string) {
  await screen.findAllByRole('button', { name: 'Show more' });
  return document.querySelector(`[data-inventory-id="${recordId}"]`) as HTMLElement;
}
