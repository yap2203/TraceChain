// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ batches: vi.fn(), orders: vi.fn() }));
vi.mock('./ingredient-batch.api', () => ({
  getIngredientBatches: mocks.batches,
  getCertificationDocument: vi.fn(),
}));
vi.mock('../../../orders/orders.api', () => ({ getOrders: mocks.orders }));
import { IngredientBatchDetail } from './IngredientBatchDetail';

const batchId = '0x' + 'ab'.repeat(32);
const wallet = '0x1000000000000000000000000000000000000001';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('shows signed facts with readable labels and the editable listing separately', async () => {
  mocks.batches.mockResolvedValue({
    batches: [
      {
        batchId,
        batchReference: 'COCOA-001',
        ingredientName: 'Cocoa powder',
        category: 'cocoa',
        quantity: '1234000',
        availableQuantity: '1000000',
        unit: 'g',
        producedAt: 1_790_000_000,
        expiresAt: 1_800_000_000,
        status: 1,
        supplier: wallet,
        credentialId: '0x' + '01'.repeat(32),
        metadataHash: '0x' + '02'.repeat(32),
        encryptedCid: 'cid',
        origin: 'Åland Islands',
        originDetails: { countryCode: 'AX', countryName: 'Åland Islands' },
        allergen: { kind: 'unknown' },
        allergenInformation: 'Unknown',
        certifications: [],
        certificationEntries: [
          {
            id: 'c1',
            name: 'Organic',
            issuer: 'Cert Body',
            reference: 'ORG-1',
            noExpiry: true,
            scope: 'This batch',
            documents: [
              {
                id: 'd1',
                fileName: 'certificate.png',
                mimeType: 'image/png',
                size: 2048,
                sha256: '0x',
                cid: 'x',
              },
            ],
          },
        ],
      },
    ],
  });
  mocks.orders.mockResolvedValue({
    actor: wallet,
    catalogue: [{ batches: [batchId], seller: wallet, name: 'Cocoa listing', category: 'cocoa' }],
  });
  render(<IngredientBatchDetail batchId={batchId} onBack={vi.fn()} />);

  const signed = await screen.findByRole('region', { name: 'Batch details' });
  expect(within(signed).getByText('1,234,000 g')).toBeTruthy();
  expect(
    within(screen.getByRole('region', { name: 'Origin' })).getByText('Åland Islands'),
  ).toBeTruthy();
  expect(screen.queryByText('AX')).toBeNull();
  expect(screen.queryByText('originDetails')).toBeNull();
  expect(
    within(screen.getByRole('region', { name: 'Allergen declaration' })).getByText('Unknown'),
  ).toBeTruthy();
  const certs = screen.getByRole('region', { name: 'Certifications (1)' });
  expect(within(certs).getByText('No expiry')).toBeTruthy();
  expect(within(certs).getByText('certificate.png')).toBeTruthy();
  expect(
    within(screen.getByRole('region', { name: 'Your listing' })).getByText('Cocoa listing'),
  ).toBeTruthy();
});
