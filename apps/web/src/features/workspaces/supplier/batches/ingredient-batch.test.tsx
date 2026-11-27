// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PreparedTransaction } from '../../../blockchain/blockchain.api';
import { IngredientBatches } from './IngredientBatchesPage';
import { RegisterBatch } from './RegisterBatchPage';
import * as batchApi from './ingredient-batch.api';
import type { IngredientBatchWorkflow, IngredientDocumentExtraction } from './ingredient-batch.api';

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
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Supplier ingredient batch workflow', () => {
  it('shares concurrent batch-list reads but fetches fresh data after completion', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async () => new Response(JSON.stringify({ batches: [] })));
    vi.stubGlobal('fetch', fetch);
    const first = batchApi.getIngredientBatches(),
      second = batchApi.getIngredientBatches();
    expect(fetch).toHaveBeenCalledTimes(1);
    finish(new Response(JSON.stringify({ batches: [] })));
    await Promise.all([first, second]);
    await batchApi.getIngredientBatches();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('reviews real values without empty optional fields or duplicate listing metadata', async () => {
    const prepareWorkflow = vi.fn().mockResolvedValue({ ...BASE_WORKFLOW, state: 'COMPLETE' });
    render(<RegisterBatch onBack={vi.fn()} prepareWorkflow={prepareWorkflow} />);
    completeForm();
    const review = screen.getByRole('region', { name: 'Batch details' });
    expect(within(review).getByText('1.25 kg')).toBeTruthy();
    expect(within(review).getByText('Registered as 1,250 g')).toBeTruthy();
    expect(within(review).getByText('1 Oct 2026')).toBeTruthy();
    expect(within(review).getByText('1 Jan 2030')).toBeTruthy();
    expect(within(review).getByText('Cocoa & Chocolate')).toBeTruthy();
    expect(within(review).queryByText(/price|image/i)).toBeNull();
    const origin = screen.getByRole('region', { name: 'Origin and allergens' });
    expect(within(origin).getByText('Country of origin')).toBeTruthy();
    expect(within(origin).getByText('Supplier declares none')).toBeTruthy();
    expect(within(origin).queryByText('State / region')).toBeNull();
    expect(screen.queryByLabelText('Currency')).toBeNull();
    expect(document.querySelectorAll('.workspace-step-progress .is-complete')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Register with MetaMask' }));
    await screen.findByText(
      'The ingredient batch was confirmed and read back from the blockchain.',
    );
    expect(prepareWorkflow.mock.calls[0][0]).toMatchObject({
      quantity: '1.25',
      unit: 'kg',
      originDetails: { countryCode: 'GH' },
      productionDate: '2026-10-01',
      expiryDate: '2030-01-01',
    });
    expect(prepareWorkflow.mock.calls[0][0]).not.toHaveProperty('price');
  });
  it('keeps price and files while editing earlier steps and supports image removal and inline errors', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:listing');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    render(<RegisterBatch onBack={vi.fn()} />);
    completeForm();
    fireEvent.change(screen.getByLabelText(/Indicative price/), { target: { value: '12.50' } });
    expect(screen.getByLabelText(/Currency/)).toBeTruthy();
    const filename = 'ingredient-photo-with-a-very-long-filename-'.repeat(5) + '.webp';
    fireEvent.change(screen.getByLabelText('Choose optional ingredient image'), {
      target: { files: [new File(['photo'], filename, { type: 'image/webp' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit batch details' }));
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '123' } });
    // Editing from the review returns straight to the review.
    fireEvent.click(screen.getByRole('button', { name: 'Save and return to review' }));
    expect(screen.getByText('Registered as 123,000 g')).toBeTruthy();
    expect(screen.getByText(filename)).toBeTruthy();
    expect((screen.getByLabelText(/Indicative price/) as HTMLInputElement).value).toBe('12.50');
    fireEvent.click(screen.getByRole('button', { name: 'Edit origin and certifications' }));
    fireEvent.change(screen.getByLabelText(/City \/ district/), { target: { value: 'Kumasi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and return to review' }));
    expect(screen.getByText('Kumasi')).toBeTruthy();
    expect(screen.getByAltText('Ingredient image preview')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Choose optional ingredient image'), {
      target: { files: [new File(['x'], 'bad.svg', { type: 'image/svg+xml' })] },
    });
    expect(screen.getByText('Use a PNG, JPEG or WebP image up to 2 MB.')).toBeTruthy();
    expect(screen.getByText(filename)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.queryByAltText('Ingredient image preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose image' })).toBeTruthy();
  });
  it('reviews multiple supplier certifications with expandable document previews and preserves attachments on edit', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:certificate');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const upload = vi
      .spyOn(batchApi, 'uploadCertificationDocument')
      .mockImplementation(async (file) => ({
        id: file.id,
        fileName: file.fileName,
        mimeType: 'application/pdf',
        size: 30,
        sha256: '0x' + 'ab'.repeat(32),
        cid: 'test-certificate',
      }));
    const prepareWorkflow = vi.fn().mockResolvedValue({ ...BASE_WORKFLOW, state: 'COMPLETE' });
    render(<RegisterBatch onBack={vi.fn()} prepareWorkflow={prepareWorkflow} />);
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Edit origin and certifications' }));
    for (const [index, name] of ['Halal', 'Organic'].entries()) {
      fireEvent.click(screen.getByRole('button', { name: 'Add certification' }));
      const card = document.querySelectorAll('.ingredient-certification-card')[
        index
      ] as HTMLElement;
      fireEvent.change(within(card).getByLabelText(/Certification name/), {
        target: { value: name },
      });
      fireEvent.change(within(card).getByLabelText(/Issuing organization/), {
        target: { value: 'Supplier stated issuer' },
      });
      fireEvent.change(within(card).getByLabelText(/Certificate reference/), {
        target: { value: `CERT-${index}` },
      });
      // "This batch" takes the batch reference automatically; there is nothing to type.
      expect(within(card).getByText(/Covers this batch/)).toBeTruthy();
      fireEvent.click(within(card).getByLabelText('No expiry stated'));
      const files = Array.from(
        { length: index + 1 },
        (_, j) =>
          new File(['%PDF-1.4\n%%EOF'], `certificate-${index}-${j}.pdf`, {
            type: 'application/pdf',
          }),
      );
      fireEvent.change(within(card).getByLabelText(`Documents for certification ${index + 1}`), {
        target: { files },
      });
      await waitFor(() =>
        expect(within(card).getAllByText(/Encrypted copy stored/)).toHaveLength(index + 1),
      );
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save and return to review' }));
    const summaries = [
      ...document.querySelectorAll('.ingredient-certification-card > summary'),
    ].map((summary) => summary.textContent);
    expect(summaries.some((text) => /Halal.*This batch.*1 document/.test(text ?? ''))).toBe(true);
    expect(summaries.some((text) => /Organic.*This batch.*2 documents/.test(text ?? ''))).toBe(
      true,
    );
    const details = document.querySelectorAll(
      '.ingredient-certification-card',
    )[0] as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(details.querySelector('summary')!);
    fireEvent.click(within(details).getByRole('button', { name: 'Preview' }));
    expect(screen.getByTitle('Certification document preview')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Close/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit origin and certifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and return to review' }));
    expect(upload).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Register with MetaMask' }));
    await screen.findByText(
      'The ingredient batch was confirmed and read back from the blockchain.',
    );
    expect(
      prepareWorkflow.mock.calls[0][0].certificationEntries.map(
        (entry: { documents: unknown[] }) => entry.documents.length,
      ),
    ).toEqual([1, 2]);
  });
  it('shows submitted confirmation separately from rejection and retains a safe resume action', async () => {
    const prepareWorkflow = vi.fn().mockResolvedValue({
      ...BASE_WORKFLOW,
      state: 'CREDENTIAL_REGISTRATION_REQUIRED',
      transaction: TRANSACTION,
    });
    let rejectTransaction!: (error: Error) => void;
    const submitTransaction = vi.fn((_tx, _wallet, progress) => {
      progress?.('submitted');
      return new Promise<never>((_resolve, reject) => {
        rejectTransaction = reject;
      });
    });
    render(
      <RegisterBatch
        onBack={vi.fn()}
        prepareWorkflow={prepareWorkflow}
        submitTransaction={submitTransaction}
      />,
    );
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register with MetaMask' }));
    await screen.findByText('Waiting for blockchain confirmation…');
    expect(
      (screen.getByRole('button', { name: 'Registering…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    rejectTransaction(new Error('RPC confirmation timed out.'));
    await screen.findByText(/confirmation is not known yet/);
    expect(screen.getByRole('button', { name: 'Retry registration' })).toBeTruthy();
    expect(screen.getAllByText('Cocoa Powder').length).toBeGreaterThan(0);
  });
  it('unlocks the form when the server refuses before any transaction', async () => {
    const prepareWorkflow = vi
      .fn()
      .mockRejectedValue(
        new batchApi.IngredientBatchRequestError(
          'WORKFLOW_CONFLICT',
          'This batch ID already has a different registration workflow.',
          409,
        ),
      );
    const submitTransaction = vi.fn();
    render(
      <RegisterBatch
        onBack={vi.fn()}
        prepareWorkflow={prepareWorkflow}
        submitTransaction={submitTransaction}
      />,
    );
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register with MetaMask' }));
    const reference = (await screen.findByLabelText(
      /Supplier batch reference/,
    )) as HTMLInputElement;
    expect(screen.getAllByText(/is already used by another registration/).length).toBeGreaterThan(
      0,
    );
    expect(reference.closest('fieldset')?.disabled).toBe(false);
    expect(submitTransaction).not.toHaveBeenCalled();
  });
  it('navigates with the step indicator, validating before moving forward', async () => {
    render(<RegisterBatch onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter information manually' }));
    const progress = screen.getByRole('list', { name: 'Form progress' });
    // Forward jump with an empty step 1 stays on step 1 and shows its errors.
    fireEvent.click(within(progress).getByRole('button', { name: /Listing and review/ }));
    expect(screen.getByLabelText(/Ingredient name/)).toBeTruthy();
    expect(screen.getByText('Production date is required.')).toBeTruthy();
    fillBatch();
    fireEvent.click(within(progress).getByRole('button', { name: /Origin and certifications/ }));
    expect(screen.getByRole('button', { name: 'Country of origin' })).toBeTruthy();
    // Going back is always allowed and keeps entered values.
    fireEvent.click(within(progress).getByRole('button', { name: /Batch details/ }));
    expect((screen.getByLabelText(/Ingredient name/) as HTMLInputElement).value).toBe(
      'Cocoa Powder',
    );
  });
  it('keeps values between three short steps and focuses invalid fields', async () => {
    render(<RegisterBatch onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter information manually' }));
    expect(screen.getByLabelText(/Production date/)).toBeTruthy();
    expect(screen.queryByLabelText('This date represents')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Ingredient name is required.')).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/Ingredient name/)),
    );
    fillBatch();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Country of origin' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Processing country (optional)' })).toBeNull();
    expect(screen.queryByLabelText(/Separate processing facility/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add laboratory report' })).toBeNull();
    expect(screen.queryByText('Quality evidence (optional)')).toBeNull();
    expect(screen.queryByLabelText(/Internal quality remarks/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add certification' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Country of origin' }));
    const ghana = screen.getByRole('option', { name: 'Ghana' });
    expect(ghana.querySelector('svg')).toBeTruthy();
    fireEvent.click(ghana);
    expect(screen.getByRole('button', { name: 'Country of origin' }).textContent).toContain(
      'Ghana',
    );
    expect(
      screen.getByRole('button', { name: 'Country of origin' }).querySelector('svg'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText(/Ingredient name/) as HTMLInputElement).value).toBe(
      'Cocoa Powder',
    );
  });
  it('previews and replaces a listing image while retaining the signed fields', async () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    render(<RegisterBatch onBack={vi.fn()} />);
    completeForm();
    fireEvent.change(screen.getByLabelText('Choose optional ingredient image'), {
      target: { files: [new File(['a'], 'a.png', { type: 'image/png' })] },
    });
    expect((await screen.findByAltText('Ingredient image preview')).getAttribute('src')).toBe(
      'blob:first',
    );
    fireEvent.change(screen.getByLabelText('Choose optional ingredient image'), {
      target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] },
    });
    expect((await screen.findByAltText('Ingredient image preview')).getAttribute('src')).toBe(
      'blob:second',
    );
    expect(revoke).toHaveBeenCalledWith('blob:first');
    expect(screen.getAllByText('Cocoa Powder').length).toBeGreaterThan(0);
  });
  it('keeps extraction editable and requires explicit review and allergen declaration before issuing', async () => {
    const prepareWorkflow = vi.fn();
    const extractDocument = vi.fn().mockResolvedValue(EXTRACTION);
    render(
      <RegisterBatch
        onBack={vi.fn()}
        extractDocument={extractDocument}
        prepareWorkflow={prepareWorkflow}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upload supply document' }));
    fireEvent.change(screen.getByLabelText('Choose supply document'), {
      target: { files: [new File(['pdf'], 'lot.pdf', { type: 'application/pdf' })] },
    });
    await screen.findByText('Review extracted information');
    expect((screen.getByLabelText(/Ingredient name/) as HTMLInputElement).value).toBe(
      'Cocoa Powder',
    );
    fireEvent.change(screen.getByLabelText(/Category/), { target: { value: 'cocoa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // No declaration is pre-selected; the Supplier must choose one.
    expect(
      within(screen.getByRole('group', { name: /Allergen declaration/ }))
        .getAllByRole('radio')
        .some((radio) => (radio as HTMLInputElement).checked),
    ).toBe(false);
    fireEvent.click(screen.getByLabelText('Unknown'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Register with MetaMask' }));
    expect(
      await screen.findByText('Confirm that you reviewed the extracted information.'),
    ).toBeTruthy();
    expect(prepareWorkflow).not.toHaveBeenCalled();
  });
  it('allows manual entry after extraction failure', async () => {
    render(
      <RegisterBatch
        onBack={vi.fn()}
        extractDocument={vi.fn().mockRejectedValue(new Error('No readable text was found.'))}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upload supply document' }));
    fireEvent.change(screen.getByLabelText('Choose supply document'), {
      target: { files: [new File(['pdf'], 'lot.pdf', { type: 'application/pdf' })] },
    });
    await screen.findByText('No readable text was found.');
    fireEvent.click(screen.getByRole('button', { name: 'Enter information manually' }));
    expect(screen.getByLabelText(/Ingredient name/)).toBeTruthy();
  });
  it('hands the new batch ID back once registration is confirmed', async () => {
    const prepareWorkflow = vi.fn().mockResolvedValue({ ...BASE_WORKFLOW, state: 'COMPLETE' });
    const onCompleted = vi.fn();
    render(
      <RegisterBatch
        onBack={vi.fn()}
        onCompleted={onCompleted}
        prepareWorkflow={prepareWorkflow}
      />,
    );
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register with MetaMask' }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(BASE_WORKFLOW.batchId));
  });
  it('submits sequentially, reuses the operation ID and blocks duplicate clicks', async () => {
    const prepareWorkflow = vi
      .fn()
      .mockResolvedValueOnce({
        ...BASE_WORKFLOW,
        state: 'CREDENTIAL_REGISTRATION_REQUIRED',
        transaction: TRANSACTION,
      })
      .mockResolvedValueOnce({
        ...BASE_WORKFLOW,
        state: 'BATCH_REGISTRATION_REQUIRED',
        transaction: TRANSACTION,
      })
      .mockResolvedValueOnce({ ...BASE_WORKFLOW, state: 'COMPLETE' });
    const submitTransaction = vi.fn().mockResolvedValue(undefined);
    render(
      <RegisterBatch
        onBack={vi.fn()}
        prepareWorkflow={prepareWorkflow}
        submitTransaction={submitTransaction}
      />,
    );
    completeForm();
    const register = screen.getByRole('button', { name: 'Register with MetaMask' });
    fireEvent.click(register);
    fireEvent.click(register);
    await screen.findByText(
      'The ingredient batch was confirmed and read back from the blockchain.',
    );
    expect(submitTransaction).toHaveBeenCalledTimes(2);
    expect(prepareWorkflow).toHaveBeenCalledTimes(3);
    expect(new Set(prepareWorkflow.mock.calls.map((call) => call[0].operationId)).size).toBe(1);
  });
  it('does not resend a confirmed transaction when the RPC reread is stale', async () => {
    const prepareWorkflow = vi.fn().mockResolvedValue({
      ...BASE_WORKFLOW,
      state: 'CREDENTIAL_REGISTRATION_REQUIRED',
      transaction: TRANSACTION,
    });
    const submitTransaction = vi.fn().mockResolvedValue(undefined);
    render(
      <RegisterBatch
        onBack={vi.fn()}
        prepareWorkflow={prepareWorkflow}
        submitTransaction={submitTransaction}
      />,
    );
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register with MetaMask' }));
    await screen.findByText(/This transaction already confirmed/);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry registration' }));
    await waitFor(() => expect(prepareWorkflow).toHaveBeenCalledTimes(3));
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });
  it.each(['The MetaMask transaction was cancelled.', 'The transaction reverted.'])(
    'retains registration after %s',
    async (message) => {
      const prepareWorkflow = vi.fn().mockResolvedValue({
        ...BASE_WORKFLOW,
        state: 'CREDENTIAL_REGISTRATION_REQUIRED',
        transaction: TRANSACTION,
      });
      const submitTransaction = vi.fn().mockRejectedValue(new Error(message));
      render(
        <RegisterBatch
          onBack={vi.fn()}
          prepareWorkflow={prepareWorkflow}
          submitTransaction={submitTransaction}
        />,
      );
      completeForm();
      fireEvent.click(screen.getByRole('button', { name: 'Register with MetaMask' }));
      await screen.findByText(message);
      // Nothing changed on chain, so entries stay and the form is editable again.
      expect(screen.getByRole('button', { name: 'Register with MetaMask' })).toBeTruthy();
      expect(screen.getAllByText('Cocoa Powder').length).toBeGreaterThan(0);
    },
  );

  it('loads the Supplier-owned ingredient grid and opens real batch details', async () => {
    const wallet = '0x2000000000000000000000000000000000000002';
    const fetchMock = vi.fn().mockResolvedValue({
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
    render(<IngredientBatches onNew={vi.fn()} />);
    expect(await screen.findByText('Cocoa Powder')).toBeTruthy();
    expect(screen.getByText(/COCOA-2026-001/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/orders?scope=supplier-inventory'),
      expect.objectContaining({ credentials: 'include' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('not signed credential claims', { exact: false })).toBeTruthy();
  });

  it.each([1, 2, 3, 4])(
    'renders %i ingredient batches as separate compact list rows',
    async (count) => {
      mockOrders({
        actor: BASE_WORKFLOW.supplierWallet,
        catalogue: Array.from({ length: count }, (_, index) =>
          catalogueItem({
            itemId: String(index + 1),
            name: `Ingredient ${index + 1}`,
            reference: `BATCH-${index + 1}`,
          }),
        ),
      });
      const { container } = render(<IngredientBatches onNew={vi.fn()} />);

      await screen.findByText('Ingredient 1');
      const grid = container.querySelector('.ingredient-grid')!;
      expect(grid).toBeTruthy();
      expect(grid.classList.contains('ingredient-grid--list')).toBe(true);
      const cards = grid.querySelectorAll(':scope > .ingredient-card');
      expect(cards).toHaveLength(count);
      expect(grid.querySelectorAll(':scope > .ingredient-card--list')).toHaveLength(count);
      expect(
        grid.querySelectorAll(':scope > .ingredient-card .ingredient-card__media'),
      ).toHaveLength(count);
      expect(
        grid.querySelectorAll(':scope > .ingredient-card .ingredient-card__primary-actions'),
      ).toHaveLength(count);
    },
  );

  it('switches views without resetting filters or refetching and restores the saved choice', async () => {
    const fetchMock = mockOrders({
      actor: BASE_WORKFLOW.supplierWallet,
      catalogue: [
        catalogueItem({ itemId: 'cocoa', name: 'Cocoa Powder', reference: 'COCOA-001' }),
        catalogueItem({ itemId: 'milk', name: 'Milk Powder', reference: 'MILK-001' }),
      ],
    });
    const page = render(<IngredientBatches onNew={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Cocoa Powder' });
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(page.container.querySelector('.ingredient-grid--list')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search batches'), { target: { value: 'COCOA-001' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));

    expect((screen.getByLabelText('Search batches') as HTMLInputElement).value).toBe('COCOA-001');
    expect((screen.getByLabelText('Sort') as HTMLSelectElement).value).toBe('name');
    expect(page.container.querySelector('.ingredient-grid--grid')).toBeTruthy();
    expect(page.container.querySelectorAll('.ingredient-card--grid')).toHaveLength(1);
    expect(window.localStorage.getItem('tracechain:supplier-ingredient-view')).toBe('grid');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    page.unmount();
    const restored = render(<IngredientBatches onNew={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Cocoa Powder' });
    expect(screen.getByRole('button', { name: 'Grid view' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(restored.container.querySelector('.ingredient-grid--grid')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows one details action per row and keeps batch facts in the details window', async () => {
    mockOrders({
      actor: BASE_WORKFLOW.supplierWallet,
      catalogue: [
        catalogueItem({ itemId: 'cocoa', name: 'Cocoa Powder', reference: 'COCOA-001' }),
        catalogueItem({ itemId: 'milk', name: 'Milk Powder', reference: 'MILK-001' }),
      ],
    });
    render(<IngredientBatches onNew={vi.fn()} />);

    const cocoaCard = (await screen.findByRole('heading', { name: 'Cocoa Powder' })).closest(
      'article',
    )!;
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    fireEvent.click(within(cocoaCard).getByRole('button', { name: 'View details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Country of origin')).toBeTruthy();
    expect(within(dialog).getByText('Registered')).toBeTruthy();
    expect(within(dialog).getByText('Supplier-provided listing description')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Edit listing' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Archive listing' })).toBeTruthy();
  });

  it('opens details when the card itself is clicked', async () => {
    mockOrders({
      actor: BASE_WORKFLOW.supplierWallet,
      catalogue: [catalogueItem({ itemId: 'cocoa', name: 'Cocoa Powder', reference: 'COCOA-001' })],
    });
    render(<IngredientBatches onNew={vi.fn()} />);
    fireEvent.click(await screen.findByRole('heading', { name: 'Cocoa Powder' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('calculates real summaries without combining different quantity units', async () => {
    const wallet = BASE_WORKFLOW.supplierWallet;
    mockOrders({
      actor: wallet,
      catalogue: [
        catalogueItem({
          itemId: 'cocoa',
          name: 'Cocoa powder',
          unit: 'kg',
          available: '125',
          registeredBlock: 30,
        }),
        catalogueItem({
          itemId: 'milk',
          name: 'Milk concentrate',
          unit: 'litre',
          available: '40',
          registeredBlock: 20,
        }),
        catalogueItem({
          itemId: 'archived',
          name: 'Archived sugar',
          unit: 'kg',
          available: '10',
          archived: true,
          registeredBlock: 10,
        }),
      ],
    });
    render(<IngredientBatches onNew={vi.fn()} />);

    const summary = await screen.findByLabelText('Ingredient inventory summary');
    expect(summary.textContent).toContain('Active batches2');
    expect(summary.textContent).toContain('Across 2 batches');
    expect(summary.textContent).toContain('Multiple units are not combined');
    expect(summary.textContent).toContain('Archived batches1');
  });

  it('searches, filters, sorts and clears filters using authoritative batches', async () => {
    const wallet = BASE_WORKFLOW.supplierWallet;
    mockOrders({
      actor: wallet,
      catalogue: [
        catalogueItem({
          itemId: 'zulu',
          name: 'Zulu cocoa',
          category: 'Cocoa',
          reference: 'ZULU-001',
          registeredBlock: 20,
        }),
        catalogueItem({
          itemId: 'alpha',
          name: 'Alpha grain',
          category: 'Grain',
          reference: 'ALPHA-001',
          registeredBlock: 10,
        }),
      ],
    });
    const { container } = render(<IngredientBatches onNew={vi.fn()} />);
    await screen.findByText('Zulu cocoa');

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } });
    expect(
      [...container.querySelectorAll('.ingredient-card__identity h3')].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(['Alpha grain', 'Zulu cocoa']);

    fireEvent.change(screen.getByLabelText('Search batches'), {
      target: { value: 'ZULU-001' },
    });
    expect(screen.getByText('Zulu cocoa')).toBeTruthy();
    expect(screen.queryByText('Alpha grain')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Alpha grain')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Grain' } });
    expect(screen.getByText('Alpha grain')).toBeTruthy();
    expect(screen.queryByText('Zulu cocoa')).toBeNull();
  });

  it('shows image fallback, quantity, expiry and credential state without technical identifiers', async () => {
    const wallet = BASE_WORKFLOW.supplierWallet;
    const longName = 'Single origin fermented cocoa nibs '.repeat(4).trim();
    const longReference = `COCOA-${'LONG-'.repeat(15)}2026`;
    mockOrders({
      actor: wallet,
      catalogue: [
        catalogueItem({
          itemId: 'long',
          name: longName,
          reference: longReference,
          available: '77',
          expiresAt: Math.floor(Date.now() / 1000) + 10 * 86_400,
          credentialStatus: 1,
        }),
      ],
    });
    const { container } = render(<IngredientBatches onNew={vi.fn()} />);
    await screen.findByText(longName);

    expect(screen.getByRole('img', { name: 'Cocoa image placeholder' })).toBeTruthy();
    expect(screen.getByText(longReference)).toBeTruthy();
    expect(screen.getAllByText('77 kg')).toHaveLength(1);
    expect(screen.getByText(/Expires in 10 days/)).toBeTruthy();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(1);
    const gridText = container.querySelector('.ingredient-grid')?.textContent ?? '';
    expect(gridText).not.toContain(wallet);
    expect(gridText).not.toContain('0x' + '0'.repeat(64));
  });

  it('keeps technical details collapsed and rejects an invalid replacement image safely', async () => {
    const wallet = BASE_WORKFLOW.supplierWallet;
    mockOrders({ actor: wallet, catalogue: [catalogueItem({ itemId: 'cocoa' })] });
    render(<IngredientBatches onNew={vi.fn()} />);
    await screen.findByText('Cocoa Powder');
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));

    const technical = screen.getByText('Technical details').closest('details');
    expect(technical?.open).toBe(false);
    expect(within(screen.getByRole('dialog')).getByText('Authenticated Supplier')).toBeTruthy();

    const invalid = new File(['unsafe'], 'ingredient.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByLabelText('Choose ingredient image'), {
      target: { files: [invalid] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    expect(await screen.findByText('Choose a PNG, JPEG or WebP image.')).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'Cocoa image placeholder' })).toHaveLength(2);
  });

  it('shows distinct loading, empty and unavailable-service states without fixture batches', async () => {
    let resolveOrders!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((resolve) => (resolveOrders = resolve))),
    );
    const view = render(<IngredientBatches onNew={vi.fn()} />);
    expect(screen.getByLabelText('Loading ingredient batches')).toBeTruthy();
    resolveOrders(
      new Response(
        JSON.stringify({
          actor: BASE_WORKFLOW.supplierWallet,
          catalogue: [],
          orders: [],
          locations: [],
          shipments: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    expect(await screen.findByText('No registered ingredients')).toBeTruthy();
    expect(screen.queryByText(/sample|fixture/i)).toBeNull();

    view.unmount();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'RPC provider unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    render(<IngredientBatches onNew={vi.fn()} />);
    expect(await screen.findByText(/Blockchain\/RPC unavailable/)).toBeTruthy();
    expect(screen.queryByText('Cocoa Powder')).toBeNull();
  });
});

function mockOrders({ actor, catalogue }: { actor: string; catalogue: unknown[] }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ actor, catalogue, orders: [], locations: [], shipments: [] }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function catalogueItem({
  itemId,
  name = 'Cocoa Powder',
  category = 'Cocoa',
  reference = 'COCOA-2026-001',
  unit = 'kg',
  available = '500',
  archived = false,
  expiresAt = 2_000_000_000,
  registeredBlock = 1,
  credentialStatus = 1,
}: {
  itemId: string;
  name?: string;
  category?: string;
  reference?: string;
  unit?: string;
  available?: string;
  archived?: boolean;
  expiresAt?: number;
  registeredBlock?: number;
  credentialStatus?: number;
}) {
  const batchId = `0x${itemId.padEnd(64, '1').slice(0, 64)}`;
  return {
    itemId,
    kind: 1,
    seller: BASE_WORKFLOW.supplierWallet,
    name,
    category,
    batchReference: reference,
    countryOfOrigin: 'Malaysia',
    description: 'Supplier-provided listing description',
    unit,
    price: '12.50',
    currency: 'MYR',
    archived,
    credentialStatus,
    evidenceAvailability: credentialStatus === 1 ? 'Credential active' : 'Credential unavailable',
    registeredBlock,
    batches: [batchId],
    batchDetails: [
      {
        batchId,
        supplierAvailable: available,
        totalQuantity: '600',
        status: 1,
        producedAt: 1_790_000_000,
        expiresAt,
      },
    ],
    listingSupported: true,
    listingHash: `0x${'0'.repeat(64)}`,
  };
}

function fillBatch() {
  fireEvent.change(screen.getByLabelText(/Ingredient name/), { target: { value: 'Cocoa Powder' } });
  fireEvent.change(screen.getByLabelText(/Supplier batch reference/), {
    target: { value: 'COCOA-2026-001' },
  });
  fireEvent.change(screen.getByLabelText(/Production date/), {
    target: { value: '2026-10-01' },
  });
  fireEvent.change(screen.getByLabelText(/Expiry date/), { target: { value: '2030-01-01' } });
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1.25' } });
}
function completeForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Enter information manually' }));
  fillBatch();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Country of origin' }));
  fireEvent.click(screen.getByRole('option', { name: 'Ghana' }));
  fireEvent.click(screen.getByLabelText('Supplier declares none'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

const extractedField = (
  value: string,
  confidence: 'High' | 'Review required' | 'Missing' = 'High',
) => ({
  confidence,
  value,
});

const EXTRACTION: IngredientDocumentExtraction = {
  document: {
    filename: 'supplier-lot.pdf',
    format: 'pdf',
    mimeType: 'application/pdf',
    pageCount: 1,
    size: 1_024,
  },
  fields: {
    allergenInformation: extractedField('None', 'Review required'),
    batchReference: extractedField('COCOA-2026-001'),
    category: extractedField('', 'Missing'),
    certifications: extractedField('Organic'),
    currency: extractedField('MYR'),
    expiryDate: extractedField('2030-01-01'),
    ingredientName: extractedField('Cocoa Powder'),
    origin: extractedField('Ghana'),
    price: extractedField('12.50'),
    productionDate: extractedField('2026-10-01'),
    quantity: extractedField('500'),
    unit: extractedField('kg'),
  },
  warnings: [],
};
