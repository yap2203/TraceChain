// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), payload: vi.fn(), model: vi.fn() }));
const batchId = `0x${'11'.repeat(32)}`;
vi.mock('../../../blockchain/useOperationalData', () => ({
  useOperationalData: () => ({
    loading: false,
    error: '',
    data: {
      actorWallet: '0x1000000000000000000000000000000000000001',
      productBatches: [
        {
          batchId: `0x${'11'.repeat(32)}`,
          manufacturer: '0x1000000000000000000000000000000000000001',
          manufacturerName: 'Registered Manufacturer',
          totalQuantity: '123',
          unit: `0x65616368${'00'.repeat(28)}`,
          status: 1,
          producedAt: 1790000000,
          expiresAt: 2000000000,
          metadataHash: 'recorded-hash',
          publicCid: 'recorded-cid',
          ingredients: [],
        },
        {
          batchId: `0x${'22'.repeat(32)}`,
          manufacturer: '0x2000000000000000000000000000000000000002',
          totalQuantity: '999',
          unit: 'g',
          status: 1,
          producedAt: 1790000000,
          expiresAt: 2000000000,
          ingredients: [],
        },
      ],
    },
  }),
}));
vi.mock('../../../orders/orders.api', () => ({
  getOrders: vi.fn().mockResolvedValue({
    catalogue: [
      {
        batches: [`0x${'11'.repeat(32)}`],
        category: 'Confectionery',
        description: 'Finished cocoa product presentation.',
        currency: 'MYR',
        price: '12',
        productionLocation: 'factory-location',
        productionLocationName: 'Shah Alam Chocolate Plant',
        storageLocations: [],
      },
    ],
    locations: [{ location: 'factory-location', label: 'Shah Alam Chocolate Plant' }],
  }),
}));
vi.mock('../../../product-traceability/product-traceability.api', async (original) => ({
  ...(await original<typeof import('../../../product-traceability/product-traceability.api')>()),
  resolveProductTraceability: mocks.resolve,
}));
vi.mock('../../../product-traceability/product-qr', async (original) => ({
  ...(await original<typeof import('../../../product-traceability/product-qr')>()),
  createProductQrPayload: mocks.payload,
  createProductQrModel: mocks.model,
}));
import { ProductBatchDetail } from './ProductBatchDetail';

const mount = () =>
  render(
    <ProductBatchDetail
      batchId={batchId}
      onBack={vi.fn()}
      onTransfer={vi.fn()}
      onIngredientDetail={vi.fn()}
    />,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.payload.mockReturnValue('https://tracechain.example/trace/product');
  mocks.model.mockReturnValue({
    payload: 'https://tracechain.example/trace/product',
    modules: [[true]],
  });
  mocks.resolve.mockResolvedValue({
    product: { name: 'Recorded product', reference: 'PRODUCT-1' },
  });
});
afterEach(cleanup);

describe('Manufacturer product detail QR resilience', () => {
  it('does not open another Manufacturer product through a direct detail reference', () => {
    render(
      <ProductBatchDetail
        batchId={`0x${'22'.repeat(32)}`}
        onBack={vi.fn()}
        onTransfer={vi.fn()}
        onIngredientDetail={vi.fn()}
      />,
    );
    expect(screen.queryByText('999 g')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Product Traceability QR' })).toBeNull();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.payload).not.toHaveBeenCalled();
  });
  it('keeps on-chain details usable when QR configuration throws synchronously', async () => {
    const error = new Error('VITE_PUBLIC_APP_URL is not configured for product QR generation.');
    mocks.payload.mockImplementation(() => {
      throw error;
    });
    mocks.model.mockImplementation(() => {
      throw error;
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('VITE_PUBLIC_APP_URL'),
    );
    expect(screen.getByText('123 each')).toBeTruthy();
    expect(screen.getByText('Linked ingredients')).toBeTruthy();
    await waitFor(() => expect(mocks.payload).toHaveBeenCalledWith(batchId));
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('preserves product details when optional traceability retrieval fails', async () => {
    mocks.resolve.mockRejectedValue(new Error('RPC unavailable'));
    mount();
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalled());
    expect(screen.getByText('123 each')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Product Traceability QR' })).toBeTruthy();
  });
  it('shows the resolved product and QR when configuration is valid', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Recorded product', level: 2 })).toBeTruthy();
    expect(screen.getByText('123 each')).toBeTruthy();
    expect(screen.getByText('MYR 12.00 / each')).toBeTruthy();
    expect(screen.getByText('Finished cocoa product presentation.')).toBeTruthy();
    expect(screen.getByText('Shah Alam Chocolate Plant')).toBeTruthy();
    expect(screen.getByText('Raw on-chain unit')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Product Traceability QR' })).toBeTruthy();
  });
});
