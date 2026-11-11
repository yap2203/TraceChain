// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PreparedTransaction } from '../../../blockchain/blockchain.api';
import { IngredientBatches } from './IngredientBatchesPage';
import { RegisterBatch } from './RegisterBatchPage';
import type { IngredientBatchWorkflow } from './ingredient-batch.api';

const TRANSACTION: PreparedTransaction = {
  chainId: 31_337,
  data: '0x1234',
  to: '0x4000000000000000000000000000000000000004',
  value: '0x0',
};
const BASE_WORKFLOW = {
  batchId: `0x${'11'.repeat(32)}`,
  credentialId: `0x${'22'.repeat(32)}`,
  supplierWallet: '0x2000000000000000000000000000000000000002',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Supplier ingredient batch workflow', () => {
  it('submits the credential and batch sequentially without duplicate clicks', async () => {
    const prepareWorkflow = vi
      .fn<() => Promise<IngredientBatchWorkflow>>()
      .mockResolvedValueOnce({
        ...BASE_WORKFLOW,
        state: 'CREDENTIAL_REGISTRATION_REQUIRED',
        transaction: TRANSACTION,
      })
      .mockResolvedValueOnce({
        ...BASE_WORKFLOW,
        state: 'BATCH_REGISTRATION_REQUIRED',
        transaction: { ...TRANSACTION, data: '0x5678' },
      })
      .mockResolvedValueOnce({ ...BASE_WORKFLOW, state: 'COMPLETE' });
    const submitTransaction = vi.fn().mockResolvedValue(undefined);
    const onCompleted = vi.fn();
    render(
      <RegisterBatch
        onBack={vi.fn()}
        onCompleted={onCompleted}
        prepareWorkflow={prepareWorkflow}
        submitTransaction={submitTransaction}
      />,
    );
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
    const register = screen.getByRole('button', { name: 'Register with MetaMask' });
    fireEvent.click(register);
    fireEvent.click(register);

    expect(
      await screen.findByText(
        'The Ingredient Credential and ingredient batch are registered and verified on-chain.',
      ),
    ).toBeTruthy();
    expect(prepareWorkflow).toHaveBeenCalledTimes(3);
    expect(submitTransaction).toHaveBeenCalledTimes(2);
    expect(submitTransaction.mock.calls[0]?.[0].data).toBe('0x1234');
    expect(submitTransaction.mock.calls[1]?.[0].data).toBe('0x5678');

    fireEvent.click(screen.getByRole('button', { name: 'View ingredient batches' }));
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it.each([
    ['rejection', 'The MetaMask transaction was cancelled.'],
    ['revert', 'The transaction reverted. Review the Supplier permissions and retry.'],
  ])('shows a MetaMask %s and allows the same workflow to be retried', async (_kind, message) => {
    const pending: IngredientBatchWorkflow = {
      ...BASE_WORKFLOW,
      state: 'CREDENTIAL_REGISTRATION_REQUIRED',
      transaction: TRANSACTION,
    };
    const prepareWorkflow = vi.fn().mockResolvedValue(pending);
    const submitTransaction = vi.fn().mockRejectedValueOnce(new Error(message));
    render(
      <RegisterBatch
        onBack={vi.fn()}
        prepareWorkflow={prepareWorkflow}
        submitTransaction={submitTransaction}
      />,
    );
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Register with MetaMask' }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry registration' })).toBeTruthy();
    expect(submitTransaction).toHaveBeenCalledOnce();
  });

  it('loads the Supplier-owned ingredient grid and opens real batch details', async () => {
    const wallet = '0x2000000000000000000000000000000000000002';
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          actor: wallet,
          catalogue: [
            {
              itemId: 'item',
              kind: 1,
              seller: wallet,
              name: 'Cocoa Powder',
              category: 'cocoa',
              batchReference: 'COCOA-2026-001',
              unit: 'kg',
              batches: [BASE_WORKFLOW.batchId],
              batchDetails: [
                {
                  batchId: BASE_WORKFLOW.batchId,
                  supplierAvailable: '500',
                  status: 1,
                  expiresAt: 2000000000,
                },
              ],
              listingSupported: true,
              listingHash: '0x' + '0'.repeat(64),
            },
          ],
          orders: [],
          locations: [],
          shipments: [],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const onDetail = vi.fn();
    render(<IngredientBatches onNew={vi.fn()} onDetail={onDetail} />);
    expect(await screen.findByText('Cocoa Powder')).toBeTruthy();
    expect(screen.getByText(/COCOA-2026-001/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/orders'),
      expect.objectContaining({ credentials: 'include' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(onDetail).toHaveBeenCalledWith(BASE_WORKFLOW.batchId);
  });
});

function completeForm() {
  fireEvent.change(screen.getByLabelText(/Ingredient name/), {
    target: { value: 'Cocoa Powder' },
  });
  fireEvent.change(screen.getByLabelText(/Batch reference/), {
    target: { value: 'COCOA-2026-001' },
  });
  fireEvent.change(screen.getByLabelText(/Country \/ location of origin/), {
    target: { value: 'Ghana' },
  });
  fireEvent.change(screen.getByLabelText(/Production date/), {
    target: { value: '2026-10-01' },
  });
  fireEvent.change(screen.getByLabelText(/Expiry date/), {
    target: { value: '2030-01-01' },
  });
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '500' } });
}
