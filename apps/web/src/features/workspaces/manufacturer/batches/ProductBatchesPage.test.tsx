// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { encodeBytes32String } from 'ethers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER = '0x1000000000000000000000000000000000000001';
const PRODUCT_A = `0x${'11'.repeat(32)}`;
const PRODUCT_B = `0x${'22'.repeat(32)}`;
const RAW_EACH = encodeBytes32String('each');
const RAW_BOXES = encodeBytes32String('boxes');

const mocks = vi.hoisted(() => ({
  getOrders: vi.fn(),
  onDetail: vi.fn(),
  onNew: vi.fn(),
  onTransfer: vi.fn(),
  operational: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('../../../blockchain/useOperationalData', () => ({
  useOperationalData: () => mocks.operational(),
}));
vi.mock('../../../orders/orders.api', () => ({ getOrders: mocks.getOrders }));
vi.mock('../../../orders/CatalogueMedia', () => ({
  CatalogueImage: ({ path, alt }: { path?: string; alt: string }) =>
    path ? <img src={path} alt={alt} /> : <div role="img" aria-label="Product image placeholder" />,
  CompanyAvatar: ({ name }: { name: string }) => <span>{name} avatar</span>,
}));
vi.mock('../../../orders/OrdersPage', () => ({
  OrdersPage: (props: Record<string, string>) => (
    <div>
      Ingredient source {props.role} {props.mode} {props.initialBatchId}
    </div>
  ),
}));

import { ProductBatches } from './ProductBatchesPage';

function operational(productBatches = defaultProducts()) {
  return {
    data: {
      actorWallet: OWNER,
      evidenceRequests: [],
      ingredientBatches: [],
      productBatches,
      transfers: [],
    },
    error: '',
    loading: false,
    reload: mocks.reload,
  };
}

function defaultProducts() {
  return [
    {
      batchId: PRODUCT_A,
      manufacturer: OWNER,
      manufacturerName: 'Melur Chocolate Works',
      metadataHash: `0x${'33'.repeat(32)}`,
      publicCid: 'bafy-product-a',
      totalQuantity: '80',
      unit: RAW_EACH,
      ingredients: [{ batchId: `0x${'aa'.repeat(32)}`, quantity: '4' }],
      status: 1,
      producedAt: 1_800_000_000,
      expiresAt: 2_000_000_000,
    },
    {
      batchId: PRODUCT_B,
      manufacturer: OWNER,
      manufacturerName: 'Melur Chocolate Works',
      metadataHash: `0x${'44'.repeat(32)}`,
      publicCid: 'bafy-product-b',
      totalQuantity: '25',
      unit: RAW_BOXES,
      ingredients: [],
      status: 1,
      producedAt: 1_790_000_000,
      expiresAt: 2_000_000_000,
    },
    {
      batchId: 'foreign-product',
      manufacturer: '0x2000000000000000000000000000000000000002',
      metadataHash: 'foreign-hash',
      publicCid: 'foreign-cid',
      totalQuantity: '999',
      unit: 'kg',
      ingredients: [],
      status: 1,
      producedAt: 1_800_000_000,
      expiresAt: 2_000_000_000,
    },
  ];
}

function orders() {
  return {
    actor: OWNER,
    role: 'MANUFACTURER',
    catalogue: [
      {
        batches: [PRODUCT_A],
        name: 'A very long chain-linked chocolate product name that must remain contained',
        batchReference: 'PRODUCT-REFERENCE-WITH-A-LONG-SAFE-VALUE-001',
        category: 'Finished product',
        description: 'A finished chocolate product.',
        imagePath: `/catalogue/products/${PRODUCT_A}/image`,
        price: '12',
        currency: 'MYR',
        sellerName: 'Melur Chocolate Works',
        batchDetails: [{ batchId: PRODUCT_A, productionLocation: 'factory-location' }],
        storageLocations: [{ location: 'warehouse-location', warehouseName: 'Klang Warehouse' }],
      },
      {
        batches: [PRODUCT_B],
        name: 'Boxed chocolate',
        batchReference: 'BOX-002',
        category: 'Finished product',
        price: '7.5',
        currency: 'MYR',
        sellerName: 'Melur Chocolate Works',
      },
      {
        batches: ['foreign-product'],
        name: 'Another Manufacturer product',
      },
    ],
    locations: [
      { location: 'factory-location', label: 'Shah Alam Chocolate Plant' },
      { location: 'warehouse-location', label: 'Klang Warehouse' },
    ],
    orders: [],
    shipments: [],
  };
}

function mount() {
  return render(
    <ProductBatches onNew={mocks.onNew} onTransfer={mocks.onTransfer} onDetail={mocks.onDetail} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.operational.mockReturnValue(operational());
  mocks.getOrders.mockResolvedValue(orders());
  mocks.reload.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('Manufacturer Products inventory', () => {
  it('uses compact list rows, readable units and prices, placeholders, and live actions', async () => {
    const view = mount();
    const name = await screen.findByText(/A very long chain-linked chocolate product name/);
    expect(name.getAttribute('title')).toContain('chain-linked chocolate');
    expect(screen.queryByText('Another Manufacturer product')).toBeNull();
    expect(screen.getByText('80 each')).toBeTruthy();
    expect(screen.getByText('MYR 12.00 / each')).toBeTruthy();
    expect(screen.getByText('25 boxes')).toBeTruthy();
    expect(screen.getByText('MYR 7.50 / boxes')).toBeTruthy();
    expect(
      screen.getByAltText(/chain-linked chocolate product name.*product image/i),
    ).toHaveProperty('src', expect.stringContaining(`/catalogue/products/${PRODUCT_A}/image`));
    expect(screen.getAllByRole('img', { name: /image placeholder/i })).toHaveLength(1);
    expect(view.container.querySelector('.ingredient-grid--list')).toBeTruthy();
    expect(view.container.querySelectorAll('.manufacturer-product-card')).toHaveLength(2);
    expect(view.container.querySelectorAll('.ingredient-grid--list > article')).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'View details' })[0]);
    expect(mocks.onDetail).toHaveBeenCalledWith(PRODUCT_A);
    fireEvent.click(screen.getAllByRole('button', { name: 'Transfer product' })[0]);
    expect(mocks.onTransfer).toHaveBeenCalledOnce();
    expect(screen.getByText('Active batches').parentElement?.textContent).toContain('2');
  });

  it('persists List/Grid selection without fetching again and uses one detail action per product', async () => {
    const first = mount();
    await screen.findByText('Boxed chocolate');
    expect(mocks.getOrders).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
    expect(first.container.querySelector('.ingredient-grid--grid')).toBeTruthy();
    expect(window.localStorage.getItem('tracechain.manufacturer.products.view')).toBe('grid');
    expect(mocks.getOrders).toHaveBeenCalledOnce();

    const cards = first.container.querySelectorAll<HTMLElement>('.manufacturer-product-card');
    expect(within(cards[0]).queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(within(cards[0]).getAllByRole('button', { name: 'View details' })).toHaveLength(1);
    expect(within(cards[1]).getAllByRole('button', { name: 'View details' })).toHaveLength(1);

    first.unmount();
    const restored = mount();
    await screen.findByText('Boxed chocolate');
    expect(restored.container.querySelector('.ingredient-grid--grid')).toBeTruthy();
  });

  it('keeps a single grid result as one bounded, left-aligned product card', async () => {
    mocks.operational.mockReturnValue(operational([defaultProducts()[0]]));
    const view = mount();
    await screen.findByText(/A very long chain-linked chocolate product name/);
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
    const grid = view.container.querySelector('.manufacturer-product-grid');
    expect(grid?.classList.contains('ingredient-grid--grid')).toBe(true);
    expect(grid?.querySelectorAll(':scope > .manufacturer-product-card')).toHaveLength(1);
  });

  it('keeps filters through a view switch and distinguishes filtered-empty from empty inventory', async () => {
    mount();
    await screen.findByText('Boxed chocolate');
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    expect(clear.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no matching product' } });
    expect(screen.getByText('No products match these filters')).toBeTruthy();
    expect(clear.hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('no matching product');
    fireEvent.click(clear);
    expect(await screen.findByText('Boxed chocolate')).toBeTruthy();

    cleanup();
    mocks.operational.mockReturnValue(operational([]));
    mount();
    expect(await screen.findByText('No products registered')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Create product batch' }).at(-1)!);
    expect(mocks.onNew).toHaveBeenCalledOnce();
  });

  it('shows loading and failed-refresh states consistently', async () => {
    mocks.operational.mockReturnValue({
      ...operational([]),
      loading: true,
    });
    const loadingView = mount();
    expect(screen.getByText('Loading registered products…')).toBeTruthy();
    loadingView.unmount();

    mocks.operational.mockReturnValue({
      ...operational([]),
      error: 'Product records could not be refreshed.',
      loading: false,
    });
    mount();
    expect(screen.getByText('Product records could not be refreshed.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce());
  });

  it('opens the linked ingredient request view inside Products', () => {
    render(
      <ProductBatches
        onNew={vi.fn()}
        onTransfer={vi.fn()}
        onDetail={vi.fn()}
        section="ingredients"
        ingredientBatchId="exact-ingredient"
      />,
    );
    expect(screen.getByText('Ingredient source manufacturer browse exact-ingredient')).toBeTruthy();
    expect(mocks.getOrders).not.toHaveBeenCalled();
  });
});
