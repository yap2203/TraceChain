// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PreparedTransaction } from '../../../blockchain/blockchain.api';
import { IngredientBatches } from './IngredientBatchesPage';
import { RegisterBatch } from './RegisterBatchPage';
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
    expect(screen.getByText('Cocoa Powder')).toBeTruthy();
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
    expect((screen.getByLabelText(/Allergen declaration/) as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText(/Allergen declaration/), {
      target: { value: 'unknown' },
    });
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
  it('recovers an existing registration without recreating or storing a private browser draft', async () => {
    const saved = {
      operationId: '11111111-1111-4111-8111-111111111111',
      ingredientName: 'Recovered ingredient',
      batchReference: 'RECOVERED-1',
      category: 'cocoa',
      quantity: '1250',
      unit: 'g',
      productionDate: '2026-10-01',
      expiryDate: '2030-01-01',
      origin: 'Ghana',
      originDetails: {
        countryCode: 'GH',
        countryName: 'Ghana',
        processingCountry: 'MY',
        processingLocation: 'Previously saved facility',
      },
      productionDateMeaning: 'processing',
      internalQualityRemarks: 'Previously saved quality note',
      allergen: { kind: 'unknown' },
      allergenInformation: 'Unknown',
      certifications: [],
      certificationEntries: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ workflows: [{ batchId: BASE_WORKFLOW.batchId, input: saved }] }),
      }),
    );
    const prepareWorkflow = vi.fn().mockResolvedValue({ ...BASE_WORKFLOW, state: 'COMPLETE' });
    render(<RegisterBatch onBack={vi.fn()} prepareWorkflow={prepareWorkflow} />);
    fireEvent.click(screen.getByText('Resume a registration'));
    fireEvent.click(await screen.findByText('Resume saved batch'));
    await screen.findByText('Recovered ingredient');
    expect(screen.queryByText('Previously saved additional details (read-only)')).toBeNull();
    expect(screen.queryByText('Previously saved facility')).toBeNull();
    expect(screen.queryByText('Previously saved quality note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume registration' }));
    await screen.findByText(
      'The ingredient batch was confirmed and read back from the blockchain.',
    );
    const submitted = prepareWorkflow.mock.calls[0]?.[0];
    expect(submitted).not.toHaveProperty('qualityTests');
    expect(submitted).not.toHaveProperty('internalQualityRemarks');
    expect(submitted).not.toHaveProperty('productionDateMeaning');
    expect(submitted.originDetails).not.toHaveProperty('processingCountry');
    expect(submitted.originDetails).not.toHaveProperty('processingLocation');
    expect(window.localStorage.length).toBe(0);
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
    fireEvent.click(screen.getByRole('button', { name: 'Resume registration' }));
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
      expect(screen.getByRole('button', { name: 'Resume registration' })).toBeTruthy();
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
      expect.stringContaining('/api/orders'),
      expect.objectContaining({ credentials: 'include' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      screen.getByText('Supplier-provided presentation information', { exact: false }),
    ).toBeTruthy();
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
    fireEvent.click(screen.getByLabelText('Show archived'));
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));

    expect((screen.getByLabelText('Search batches') as HTMLInputElement).value).toBe('COCOA-001');
    expect((screen.getByLabelText('Show archived') as HTMLInputElement).checked).toBe(true);
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

  it('expands cards independently and preserves expansion while filtering and sorting', async () => {
    const fetchMock = mockOrders({
      actor: BASE_WORKFLOW.supplierWallet,
      catalogue: [
        catalogueItem({ itemId: 'cocoa', name: 'Cocoa Powder', reference: 'COCOA-001' }),
        catalogueItem({ itemId: 'milk', name: 'Milk Powder', reference: 'MILK-001' }),
      ],
    });
    render(<IngredientBatches onNew={vi.fn()} />);

    const cocoaHeading = await screen.findByRole('heading', { name: 'Cocoa Powder' });
    const cocoaCard = cocoaHeading.closest('article')!;
    const milkCard = screen.getByRole('heading', { name: 'Milk Powder' }).closest('article')!;
    const cocoaToggle = within(cocoaCard).getByRole('button', { name: 'Show more' });
    const milkToggle = within(milkCard).getByRole('button', { name: 'Show more' });

    expect(cocoaToggle.getAttribute('aria-expanded')).toBe('false');
    expect(milkToggle.getAttribute('aria-expanded')).toBe('false');
    const detailsId = cocoaToggle.getAttribute('aria-controls')!;
    expect(document.getElementById(detailsId)?.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(cocoaToggle);
    expect(within(cocoaCard).getByRole('button', { name: 'Show less' })).toBeTruthy();
    expect(document.getElementById(detailsId)?.getAttribute('aria-hidden')).toBe('false');
    expect(within(cocoaCard).getByText('Country of origin')).toBeTruthy();
    expect(within(cocoaCard).getByText('Registered quantity')).toBeTruthy();
    expect(within(cocoaCard).getByText('Supplier-provided listing description')).toBeTruthy();
    expect(within(milkCard).getByRole('button', { name: 'Show more' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Search batches'), { target: { value: 'MILK-001' } });
    expect(screen.queryByRole('heading', { name: 'Cocoa Powder' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    const restoredCocoaCard = screen
      .getByRole('heading', { name: 'Cocoa Powder' })
      .closest('article')!;
    expect(within(restoredCocoaCard).getByRole('button', { name: 'Show less' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
    const gridCocoaCard = screen.getByRole('heading', { name: 'Cocoa Powder' }).closest('article')!;
    const gridMilkCard = screen.getByRole('heading', { name: 'Milk Powder' }).closest('article')!;
    expect(gridCocoaCard.classList.contains('ingredient-card--grid')).toBe(true);
    expect(within(gridCocoaCard).getByRole('button', { name: 'Show less' })).toBeTruthy();
    expect(within(gridMilkCard).getByRole('button', { name: 'Show more' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(screen.getAllByText('77 kg')).toHaveLength(2);
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
  fireEvent.change(screen.getByLabelText(/Allergen declaration/), {
    target: { value: 'declaresNone' },
  });
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
