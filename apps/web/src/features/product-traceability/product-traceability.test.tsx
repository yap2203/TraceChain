// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('./product-traceability.api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./product-traceability.api')>();
  return { ...original, resolveProductTraceability: mocks.resolve };
});

import type { TransferQrReader } from '../custody-transfers/qr-reader';
import { ProductTraceabilityPage } from './ProductTraceabilityPage';
import { createProductQrModel, createProductQrPayload, productQrPngFilename } from './product-qr';
import { ProductTraceabilityApiError } from './product-traceability.api';

const BATCH_ID = `0x${'11'.repeat(32)}`;
const REGISTRY = '0x1000000000000000000000000000000000000001';
const PAYLOAD = `https://tracechain.example/trace/product?v=1&chainId=31337&registry=${REGISTRY}&batchId=${BATCH_ID}`;
const response = {
  accessLevel: 'AUTHORIZED' as const,
  credentialSummary: { active: 1, total: 1, verified: true },
  currentCustodianName: 'FreshMart Retail Sdn. Bhd.',
  disclaimer:
    'This verifies the recorded blockchain history; it does not prove the physical product.',
  ingredients: [
    {
      credentialStatus: 'ACTIVE',
      reference: 'COCOA-2026-001',
      status: 'ACTIVE',
      supplierName: 'ABC Ingredients Sdn. Bhd.',
      verified: true,
    },
  ],
  product: {
    expiresAt: 1_900_000_000,
    manufacturerName: 'CocoaCraft Manufacturing Sdn. Bhd.',
    name: 'Dark Chocolate Bar',
    producedAt: 1_790_000_000,
    reference: 'CHOCOLATE-2026-050',
    status: 'ACTIVE' as const,
  },
  technical: {
    batchId: BATCH_ID,
    chainId: 31_337,
    currentCustodianWallet: '0x5000000000000000000000000000000000000005',
    manufacturerWallet: '0x3000000000000000000000000000000000000003',
    productRegistryAddress: REGISTRY,
    transfers: [],
  },
  timeline: [
    {
      action: 'Product batch recorded by Manufacturer',
      organizationName: 'CocoaCraft Manufacturing Sdn. Bhd.',
      status: 'RECORDED',
      timestamp: 1_790_000_000,
      type: 'PRODUCT_CREATED',
    },
  ],
  verificationMessage: 'Blockchain traceability record verified',
};

beforeEach(() => mocks.resolve.mockResolvedValue(response));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('product traceability QR and page', () => {
  it('creates a canonical HTTPS QR model and PNG filename', () => {
    const configuration = {
      chainId: 31_337,
      productRegistryAddress: REGISTRY,
      publicAppUrl: 'https://tracechain.example',
    };
    expect(createProductQrPayload(BATCH_ID, configuration)).toBe(PAYLOAD);
    const model = createProductQrModel(BATCH_ID, configuration);
    expect(model.payload).toBe(PAYLOAD);
    expect(model.modules.length).toBeGreaterThan(20);
    expect(productQrPngFilename(BATCH_ID)).toBe('tracechain-product-11111111.png');
  });

  it('submits a manual product link and displays verified real data and technical details', async () => {
    render(<ProductTraceabilityPage reader={reader()} />);
    fireEvent.change(screen.getByLabelText('Product traceability link'), {
      target: { value: PAYLOAD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify product' }));
    expect(await screen.findByText('Dark Chocolate Bar')).toBeTruthy();
    expect(screen.getByText('FreshMart Retail Sdn. Bhd.')).toBeTruthy();
    expect(screen.getByText('ABC Ingredients Sdn. Bhd.')).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(mocks.resolve).toHaveBeenCalledWith(PAYLOAD);
    expect(JSON.stringify(mocks.resolve.mock.calls)).not.toContain('confirmReceipt');
  });

  it('supports product QR image upload as a fallback', async () => {
    const qrReader = reader();
    render(<ProductTraceabilityPage reader={qrReader} />);
    const file = new File(['image'], 'product-qr.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload product QR image'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(qrReader.decodeImage).toHaveBeenCalledWith(file));
    expect(await screen.findByText('Dark Chocolate Bar')).toBeTruthy();
  });

  it.each([
    ['PRODUCT_NOT_FOUND', 'No product record was found for this batch.'],
    ['QR_CHAIN_MISMATCH', 'This QR is for a different blockchain network.'],
    ['QR_REGISTRY_MISMATCH', 'This QR references a different ProductRegistry deployment.'],
    ['INVALID_PRODUCT_QR', 'This is not a valid TraceChain product QR link.'],
  ])('shows a clear %s state', async (code, message) => {
    mocks.resolve.mockRejectedValueOnce(new ProductTraceabilityApiError('API error', code, 400));
    render(<ProductTraceabilityPage reader={reader()} />);
    fireEvent.change(screen.getByLabelText('Product traceability link'), {
      target: { value: PAYLOAD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify product' }));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('displays suspended, recalled, or expired lifecycle attention', async () => {
    mocks.resolve.mockResolvedValueOnce({
      ...response,
      product: { ...response.product, status: 'RECALLED' },
    });
    render(<ProductTraceabilityPage reader={reader()} />);
    fireEvent.change(screen.getByLabelText('Product traceability link'), {
      target: { value: PAYLOAD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify product' }));
    expect(await screen.findByText('RECALLED')).toBeTruthy();
    expect(screen.getByText(/requires attention: recalled/i)).toBeTruthy();
  });
});

function reader(): TransferQrReader & { decodeImage: ReturnType<typeof vi.fn> } {
  return {
    decodeImage: vi.fn().mockResolvedValue(PAYLOAD),
    startCamera: vi.fn().mockResolvedValue(vi.fn()),
  };
}
