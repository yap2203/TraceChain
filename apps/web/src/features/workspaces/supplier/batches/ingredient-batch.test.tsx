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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Supplier ingredient batch workflow', () => {
  it('supports manual entry without running document extraction', () => {
    const extractDocument = vi.fn();
    render(<RegisterBatch onBack={vi.fn()} extractDocument={extractDocument} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter information manually' }));
    expect(screen.getAllByText('Ingredient information').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Ingredient name/)).toBeTruthy();
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it('shows extraction progress, prefills fields and requires supplier review confirmation', async () => {
    let finishExtraction!: (value: IngredientDocumentExtraction) => void;
    const extractDocument = vi.fn(
      () => new Promise<IngredientDocumentExtraction>((resolve) => (finishExtraction = resolve)),
    );
    const prepareWorkflow = vi.fn();
    render(
      <RegisterBatch
        onBack={vi.fn()}
        extractDocument={extractDocument}
        prepareWorkflow={prepareWorkflow}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upload supply document' }));
    const file = new File(['pdf'], 'supplier-lot.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Choose supply document'), {
      target: { files: [file] },
    });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Extracting document information…')).toBeTruthy();

    finishExtraction(EXTRACTION);
    expect((await screen.findAllByText('Review extracted information')).length).toBeGreaterThan(0);
    expect((screen.getByLabelText(/Ingredient name/) as HTMLInputElement).value).toBe(
      'Cocoa Powder',
    );
    expect((screen.getByLabelText(/Batch reference/) as HTMLInputElement).value).toBe(
      'COCOA-2026-001',
    );
    expect(screen.getAllByText('High').length).toBeGreaterThan(1);
    expect(screen.getByText('Review required')).toBeTruthy();
    expect(
      screen.getByText('Required field not found. Enter a value before continuing.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Extracted information is supplier-provided and has not been independently certified by TraceChain.',
      ),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Category/), { target: { value: 'cocoa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
    expect(
      screen.getByText(
        'Review every extracted value and confirm that the information is accurate.',
      ),
    ).toBeTruthy();
    expect(prepareWorkflow).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I have reviewed the extracted information and confirm that it is accurate.',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
    expect(screen.getByText('Review batch')).toBeTruthy();
    expect(prepareWorkflow).not.toHaveBeenCalled();
  });

  it('shows extraction failures and keeps manual entry available', async () => {
    const extractDocument = vi.fn().mockRejectedValue(new Error('No readable text was found.'));
    render(<RegisterBatch onBack={vi.fn()} extractDocument={extractDocument} />);
    fireEvent.click(screen.getByRole('button', { name: 'Upload supply document' }));
    fireEvent.change(screen.getByLabelText('Choose supply document'), {
      target: { files: [new File(['image'], 'label.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('No readable text was found.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enter information manually instead' }));
    expect(screen.getByLabelText(/Ingredient name/)).toBeTruthy();
  });

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
    expect(screen.getByText('77 kg')).toBeTruthy();
    expect(screen.getByText('Expires in 10 days')).toBeTruthy();
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
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ actor, catalogue, orders: [], locations: [], shipments: [] }),
    }),
  );
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

function completeForm() {
  const manualEntry = screen.queryByRole('button', { name: 'Enter information manually' });
  if (manualEntry) fireEvent.click(manualEntry);
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
