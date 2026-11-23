// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  media: vi.fn(),
  orders: vi.fn(),
  trace: vi.fn(),
}));

vi.mock('../../../blockchain/useOperationalData', () => ({
  useOperationalData: () => ({
    data: {
      actorWallet: '0x3000000000000000000000000000000000000003',
      transfers: [
        {
          distributorName: 'Actual Distributor',
          productBatchId: 'product-batch',
          quantity: '8',
          recipient: '0x3000000000000000000000000000000000000003',
          recipientName: 'Actual Retailer',
          senderName: 'Actual Distributor',
          status: 2,
        },
      ],
    },
    error: '',
    loading: false,
  }),
}));

vi.mock('../../../product-traceability', () => ({
  createProductQrPayload: (batchId: string) => batchId,
  resolveProductTraceability: mocks.trace,
}));

vi.mock('../../../orders/orders.api', () => ({
  CatalogueMediaError: class CatalogueMediaError extends Error {
    reason = 'missing';
  },
  fetchCatalogueMedia: mocks.media,
  getOrders: mocks.orders,
}));

import { ProductHistory } from './ProductHistoryPage';

describe('Retailer received product presentation', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:authorized-product'),
      revokeObjectURL: vi.fn(),
    });
    mocks.media.mockResolvedValue(new Blob(['product'], { type: 'image/png' }));
    mocks.orders.mockResolvedValue({
      catalogue: [
        {
          batches: ['product-batch'],
          category: 'Chocolate',
          imagePath: '/catalogue/products/product-batch/image',
          sellerLogoPath: '/branding/manufacturer/logo',
        },
      ],
    });
    mocks.trace.mockResolvedValue({
      credentialSummary: { active: 1, total: 1 },
      currentCustodianName: 'Actual Retailer',
      product: {
        category: 'Chocolate',
        manufacturerName: 'Actual Manufacturer',
        name: 'Dark chocolate bar',
        reference: 'CHOC-2026-01',
        status: 'ACTIVE',
        unit: 'each',
      },
      technical: {},
      timeline: [{ action: 'Receipt confirmed', status: 'RECEIVED', timestamp: 1_800_000_000 }],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads the authorized product image and renders the compact custody route', async () => {
    render(<ProductHistory onView={vi.fn()} />);

    const image = await screen.findByAltText('Dark chocolate bar image');
    await waitFor(() => expect(image.getAttribute('src')).toBe('blob:authorized-product'));
    expect(mocks.media).toHaveBeenCalledWith('/catalogue/products/product-batch/image');
    const route = screen.getByLabelText('Product custody route');
    expect(within(route).getByText('Manufacturer')).toBeTruthy();
    expect(within(route).getByText('Distributor')).toBeTruthy();
    expect(within(route).getByText('Retailer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View traceability' })).toBeTruthy();
    expect(mocks.orders).toHaveBeenCalledTimes(1);
    expect(mocks.trace).toHaveBeenCalledTimes(1);
  });
});
