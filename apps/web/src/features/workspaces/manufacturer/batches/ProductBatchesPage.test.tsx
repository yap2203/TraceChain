// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getOrders: vi.fn(),
  onDetail: vi.fn(),
  onSectionChange: vi.fn(),
}));
vi.mock('../../../blockchain/useOperationalData', () => ({
  useOperationalData: () => ({
    loading: false,
    error: '',
    data: {
      actorWallet: '0x1000000000000000000000000000000000000001',
      productBatches: [
        {
          batchId: 'product-batch',
          manufacturer: '0x1000000000000000000000000000000000000001',
          totalQuantity: '250',
          unit: 'kg',
          ingredients: [{ batchId: 'ingredient' }],
          status: 1,
          producedAt: 1800000000,
          expiresAt: 2000000000,
        },
        {
          batchId: 'foreign-product',
          manufacturer: '0x2000000000000000000000000000000000000002',
          totalQuantity: '999',
          unit: 'kg',
          ingredients: [],
          status: 1,
          producedAt: 1800000000,
          expiresAt: 2000000000,
        },
      ],
    },
  }),
}));
vi.mock('../../../orders/orders.api', () => ({ getOrders: mocks.getOrders }));
vi.mock('../../../orders/OrdersPage', () => ({
  OrdersPage: (props: any) => (
    <div>
      Ingredient source {props.role} {props.mode} {props.initialBatchId}
    </div>
  ),
}));
import { ProductBatches } from './ProductBatchesPage';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('Manufacturer Products entry point', () => {
  it('shows real product metadata in a searchable grid and opens product details', async () => {
    mocks.getOrders.mockResolvedValue({
      catalogue: [
        {
          batches: ['foreign-product'],
          name: 'Another Manufacturer product',
          batchReference: 'FOREIGN-01',
        },
        {
          batches: ['product-batch'],
          name: 'Chain-linked product',
          batchReference: 'PROD-01',
          price: '12.50',
          currency: 'MYR',
        },
      ],
    });
    render(
      <ProductBatches
        onNew={vi.fn()}
        onTransfer={vi.fn()}
        onDetail={mocks.onDetail}
        onSectionChange={mocks.onSectionChange}
      />,
    );
    await screen.findByText('Chain-linked product');
    expect(screen.queryByText('Another Manufacturer product')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'View product details' })).toHaveLength(1);
    expect(screen.getByText('MYR 12.50 / kg')).toBeTruthy();
    expect(screen.getByText(/250 kg/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View product details' }));
    expect(mocks.onDetail).toHaveBeenCalledWith('product-batch');
    expect(screen.queryByRole('button', { name: 'Supplier ingredients' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no match' } });
    expect(screen.getByText('No matching products')).toBeTruthy();
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
