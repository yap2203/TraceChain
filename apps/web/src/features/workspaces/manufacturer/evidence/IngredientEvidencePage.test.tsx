// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listEvidenceRequests: vi.fn(),
  listProductionIngredients: vi.fn(),
  reviewEvidence: vi.fn(),
  verifyEvidence: vi.fn(),
  prepareEvidenceAcceptance: vi.fn(),
  getEvidenceDetails: vi.fn(),
}));

vi.mock('../../../production-flow/production-flow.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../production-flow/production-flow.api')>()),
  ...mocks,
}));
vi.mock('../../../production-flow/evidence-didcomm', () => ({
  sendEvidenceRequestMessage: vi.fn(),
}));

import { IngredientEvidence } from './IngredientEvidencePage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Manufacturer received evidence review', () => {
  it('opens only the selected sent request, shows its actual claims and omits the new-request form', async () => {
    mocks.listEvidenceRequests.mockResolvedValue({
      requests: [
        {
          requestId: 'selected',
          supplier: 'supplier-a',
          supplierName: 'Selected Supplier',
          dueAt: 2000000000,
          status: 1,
        },
        {
          requestId: 'other',
          supplier: 'supplier-b',
          supplierName: 'Other Supplier',
          dueAt: 2000000000,
          status: 1,
        },
      ],
    });
    mocks.getEvidenceDetails.mockResolvedValue({
      batchId: 'exact-batch',
      reason: 'Verify origin',
      claims: ['countryOfOrigin', 'expiryDate'],
      requiredClaims: ['expiryDate'],
    });
    render(<IngredientEvidence onNav={vi.fn()} hideComposer requestId="selected" />);
    await screen.findByText('Selected Supplier');
    expect(await screen.findByText('Reason: Verify origin')).toBeTruthy();
    expect(screen.getByText('Necessary claims: expiryDate')).toBeTruthy();
    expect(screen.getByText('Optional claims: countryOfOrigin')).toBeTruthy();
    expect(screen.queryByText('Other Supplier')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request evidence with MetaMask' })).toBeNull();
    expect(mocks.listProductionIngredients).not.toHaveBeenCalled();
    expect(mocks.getEvidenceDetails).toHaveBeenCalledWith('selected');
    expect(mocks.verifyEvidence).not.toHaveBeenCalled();
  });
  it('shows authorized full-disclosure claims and keeps view, verify and acceptance separate', async () => {
    const requestId = `0x${'11'.repeat(32)}`;
    mocks.listProductionIngredients.mockResolvedValue({ batches: [] });
    mocks.listEvidenceRequests.mockResolvedValue({
      requests: [
        {
          accepted: false,
          dueAt: 1_900_000_000,
          ingredientBatchId: `0x${'22'.repeat(32)}`,
          presentationExpiresAt: 1_800_000_000,
          requestId,
          requester: '0x3000000000000000000000000000000000000003',
          status: 2,
          supplier: '0x2000000000000000000000000000000000000002',
          supplierName: 'Cocoa Supplier',
          updatedAt: 1_700_000_000,
          verification: { state: 'NOT_VERIFIED' },
        },
      ],
    });
    const review = {
      batchId: `0x${'22'.repeat(32)}`,
      credentialExpiry: '2027-01-01T00:00:00.000Z',
      credentialId: 'urn:ingredient:credential:1',
      disclosure: 'FULL_INGREDIENT_CREDENTIAL' as const,
      presentationExpiry: '2026-12-01T00:00:00.000Z',
      requestId,
      sharedClaims: {
        allergenInformation: 'May contain soy',
        batchId: 'COCOA-001',
        category: 'Cocoa',
        certifications: ['Organic'],
        expiryDate: '2027-01-01T00:00:00.000Z',
        ingredientName: 'Cocoa powder',
        origin: 'Malaysia',
        productionDate: '2026-10-01T00:00:00.000Z',
        quantity: '500',
        unit: 'kg',
      },
      status: 2,
      supplier: '0x2000000000000000000000000000000000000002',
      supplierName: 'Cocoa Supplier',
      verification: { state: 'NOT_VERIFIED' as const },
    };
    mocks.reviewEvidence.mockResolvedValue(review);
    mocks.verifyEvidence.mockResolvedValue({
      checks: [{ code: 'PRESENTATION_PROOF', passed: true }],
      credentialId: review.credentialId,
      requestId,
      verifiedAt: '2026-11-07T10:00:00.000Z',
    });

    render(<IngredientEvidence onNav={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View evidence' }));

    expect(await screen.findByText('Cocoa powder')).toBeTruthy();
    expect(screen.getByText('May contain soy')).toBeTruthy();
    expect(screen.getByText(/Full disclosure:/)).toBeTruthy();
    expect(screen.getByText('Unverified')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept evidence' }).hasAttribute('disabled')).toBe(
      true,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Verify evidence' }).at(-1)!);
    await waitFor(() => expect(mocks.verifyEvidence).toHaveBeenCalledWith(requestId));
    expect(mocks.prepareEvidenceAcceptance).not.toHaveBeenCalled();
  });
});
