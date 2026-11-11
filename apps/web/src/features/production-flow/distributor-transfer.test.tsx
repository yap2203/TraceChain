// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  listInventory: vi.fn(),
  listRetailers: vi.fn(),
  prepare: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('../auth/auth.api', () => ({
  getAuthSession: vi.fn().mockResolvedValue({
    address: '0x4000000000000000000000000000000000000004',
    authenticated: true,
    companyName: 'Swift Distribution Sdn. Bhd.',
  }),
}));
vi.mock('../blockchain/useOperationalData', () => ({
  useOperationalData: () => ({
    data: { evidenceRequests: [], ingredientBatches: [], productBatches: [], transfers: [] },
    error: '',
    loading: false,
    reload: mocks.reload,
  }),
}));
vi.mock('../custody-transfers', () => ({
  TransferQrDisplay: ({ transferId }: { transferId: string }) => (
    <div data-testid="qr-transfer-id">{transferId}</div>
  ),
}));
vi.mock('./production-flow.api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./production-flow.api')>();
  return {
    ...original,
    listDistributorInventory: mocks.listInventory,
    listRetailers: mocks.listRetailers,
    prepareDistributorTransfer: mocks.prepare,
  };
});
vi.mock('./production-flow.transaction', () => ({
  completePreparedWorkflow: mocks.complete,
}));

import { DistributorTransferToRetailer } from '../workspaces/distributor/transfers/TransferToRetailerPage';

const PRODUCT_ID = `0x${'22'.repeat(32)}`;
const RETAILER = '0x5000000000000000000000000000000000000005';
const TRANSFER_ID = `0x${'66'.repeat(32)}`;

beforeEach(() => {
  mocks.reload.mockResolvedValue(undefined);
  mocks.listInventory.mockResolvedValue({
    products: [
      {
        availableQuantity: '40',
        productBatchId: PRODUCT_ID,
        productName: 'Dark Chocolate Bar',
        productReference: 'CHOCOLATE-2026-050',
        reservedQuantity: '10',
        unit: 'units',
      },
    ],
  });
  mocks.listRetailers.mockResolvedValue({
    retailers: [
      {
        active: true,
        companyName: 'FreshMart Retail Sdn. Bhd.',
        role: 'RETAILER',
        walletAddress: RETAILER,
      },
    ],
  });
  mocks.prepare.mockResolvedValue({
    actorWallet: '0x4000000000000000000000000000000000000004',
    state: 'COMPLETE',
    status: 1,
    transferId: TRANSFER_ID,
  });
  mocks.complete.mockImplementation(async (prepare: () => Promise<unknown>) => prepare());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Distributor to Retailer transfer page', () => {
  it('uses the Retailer wallet internally, displays company names, and renders the real QR ID', async () => {
    render(<DistributorTransferToRetailer onBack={vi.fn()} />);

    const retailerOption = await screen.findByRole('option', {
      name: 'FreshMart Retail Sdn. Bhd. — Retailer',
    });
    expect(retailerOption.getAttribute('value')).toBe(RETAILER);
    const [productSelect, retailerSelect] = screen.getAllByRole('combobox');
    fireEvent.change(productSelect, { target: { value: PRODUCT_ID } });
    fireEvent.change(retailerSelect, { target: { value: RETAILER } });
    fireEvent.change(screen.getByLabelText(/Transfer quantity/), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/Expected arrival/), {
      target: { value: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10) },
    });
    fireEvent.change(screen.getByLabelText(/Shipment reference/), {
      target: { value: 'DIST-RET-001' },
    });
    fireEvent.change(screen.getByLabelText(/Handling notes/), {
      target: { value: 'Keep chilled' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(screen.getByText('Swift Distribution Sdn. Bhd.')).toBeTruthy();
    expect(screen.getByText('FreshMart Retail Sdn. Bhd.')).toBeTruthy();
    const details = screen.getByText('Technical details').closest('details');
    expect(details).toBeTruthy();
    expect(within(details!).getByText(/0x50000000/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm with MetaMask' }));
    expect((await screen.findByTestId('qr-transfer-id')).textContent).toBe(TRANSFER_ID);
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        handlingNotes: 'Keep chilled',
        productBatchId: PRODUCT_ID,
        quantity: '25',
        recipient: RETAILER,
      }),
    );
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain('TRANSFER-2026-002');
  });

  it('prevents a duplicate submit while transfer preparation is active', async () => {
    let finish!: (value: unknown) => void;
    mocks.complete.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<DistributorTransferToRetailer onBack={vi.fn()} />);
    await screen.findByRole('option', { name: 'FreshMart Retail Sdn. Bhd. — Retailer' });
    const [productSelect, retailerSelect] = screen.getAllByRole('combobox');
    fireEvent.change(productSelect, { target: { value: PRODUCT_ID } });
    fireEvent.change(retailerSelect, { target: { value: RETAILER } });
    fireEvent.change(screen.getByLabelText(/Transfer quantity/), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/Expected arrival/), {
      target: { value: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10) },
    });
    fireEvent.change(screen.getByLabelText(/Shipment reference/), {
      target: { value: 'DIST-RET-001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review transfer' }));
    const submit = screen.getByRole('button', { name: 'Confirm with MetaMask' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(mocks.complete).toHaveBeenCalledOnce();
    finish({ actorWallet: '', state: 'COMPLETE', transferId: TRANSFER_ID });
    await waitFor(() => expect(screen.getByTestId('qr-transfer-id')).toBeTruthy());
  });
});
