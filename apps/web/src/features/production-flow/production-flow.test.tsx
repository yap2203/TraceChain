// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSigner: vi.fn(),
  getNetwork: vi.fn(),
  listDistributors: vi.fn(),
  prepareTransfer: vi.fn(),
  sendPreparedTransaction: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const original = await importOriginal<typeof import('ethers')>();
  return {
    ...original,
    BrowserProvider: class {
      getNetwork = mocks.getNetwork;
      getSigner = mocks.getSigner;
    },
  };
});
vi.mock('../blockchain/blockchain.api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../blockchain/blockchain.api')>();
  return { ...original, sendPreparedTransaction: mocks.sendPreparedTransaction };
});
vi.mock('../blockchain/useOperationalData', () => ({
  useOperationalData: () => ({
    data: {
      evidenceRequests: [],
      ingredientBatches: [],
      productBatches: [
        {
          batchId: `0x${'22'.repeat(32)}`,
          expiresAt: 1_900_000_000,
          ingredients: [],
          manufacturer: '0x3000000000000000000000000000000000000003',
          metadataHash: `0x${'33'.repeat(32)}`,
          producedAt: 1_790_000_000,
          publicCid: 'bafy-product',
          status: 1,
          totalQuantity: '500',
          unit: `0x${'00'.repeat(32)}`,
        },
      ],
      transfers: [],
    },
    error: '',
    loading: false,
    reload: vi.fn(),
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
    listDistributors: mocks.listDistributors,
    prepareTransfer: mocks.prepareTransfer,
  };
});

import type { PreparedTransaction } from '../blockchain/blockchain.api';
import { TransferToDistributor } from '../workspaces/manufacturer/transfers/TransferToDistributorPage';
import { completePreparedWorkflow } from './production-flow.transaction';

const MANUFACTURER = '0x3000000000000000000000000000000000000003';
const DISTRIBUTOR = '0x4000000000000000000000000000000000000004';
const TRANSFER_ID = `0x${'44'.repeat(32)}`;
const TRANSACTION: PreparedTransaction = {
  chainId: 31_337,
  data: '0x12345678',
  to: '0x9000000000000000000000000000000000000009',
  value: '0x0',
};

beforeEach(() => {
  vi.stubGlobal('ethereum', {});
  Object.defineProperty(window, 'ethereum', { configurable: true, value: {} });
  mocks.getNetwork.mockResolvedValue({ chainId: 31_337n });
  mocks.getSigner.mockResolvedValue({ getAddress: vi.fn().mockResolvedValue(MANUFACTURER) });
  mocks.sendPreparedTransaction.mockResolvedValue({
    wait: vi.fn().mockResolvedValue({ status: 1 }),
  });
  mocks.listDistributors.mockResolvedValue({
    distributors: [
      {
        active: true,
        companyName: 'Swift Distribution Sdn. Bhd.',
        role: 'DISTRIBUTOR',
        walletAddress: DISTRIBUTOR,
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('production transaction workflow', () => {
  it('submits one prepared transaction and verifies the authoritative record afterwards', async () => {
    const prepare = vi
      .fn()
      .mockResolvedValueOnce({
        actorWallet: MANUFACTURER,
        state: 'TRANSACTION_REQUIRED',
        transaction: TRANSACTION,
      })
      .mockResolvedValueOnce({
        actorWallet: MANUFACTURER,
        state: 'COMPLETE',
        transferId: TRANSFER_ID,
      });
    const result = await completePreparedWorkflow(prepare);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(mocks.sendPreparedTransaction).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ state: 'COMPLETE', transferId: TRANSFER_ID });
  });

  it.each([
    [{ code: 4001 }, 'REJECTED'],
    [{ code: 'CALL_EXCEPTION', shortMessage: 'execution reverted' }, 'REVERTED'],
  ])(
    'reports a MetaMask rejection or revert without running the confirmation read',
    async (failure, code) => {
      mocks.sendPreparedTransaction.mockRejectedValue(failure);
      const prepare = vi.fn().mockResolvedValue({
        actorWallet: MANUFACTURER,
        state: 'TRANSACTION_REQUIRED',
        transaction: TRANSACTION,
      });
      await expect(completePreparedWorkflow(prepare)).rejects.toMatchObject({ code });
      expect(prepare).toHaveBeenCalledOnce();
    },
  );

  it('passes the real confirmed transfer ID to the existing QR display and blocks duplicate submits', async () => {
    mocks.prepareTransfer
      .mockResolvedValueOnce({
        actorWallet: MANUFACTURER,
        state: 'TRANSACTION_REQUIRED',
        transaction: TRANSACTION,
        transferId: TRANSFER_ID,
      })
      .mockResolvedValueOnce({
        actorWallet: MANUFACTURER,
        state: 'COMPLETE',
        status: 1,
        transferId: TRANSFER_ID,
      });
    render(<TransferToDistributor onBack={vi.fn()} />);
    await waitFor(() => expect(mocks.listDistributors).toHaveBeenCalledOnce());
    expect(
      screen
        .getByRole('option', { name: 'Swift Distribution Sdn. Bhd. — Distributor' })
        .getAttribute('value'),
    ).toBe(DISTRIBUTOR);
    const [product, distributor] = screen.getAllByRole('combobox');
    fireEvent.change(product, { target: { value: `0x${'22'.repeat(32)}` } });
    fireEvent.change(distributor, { target: { value: DISTRIBUTOR } });
    fireEvent.change(screen.getByLabelText(/Transfer quantity/), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/Expected arrival/), {
      target: { value: '2026-11-10' },
    });
    fireEvent.change(screen.getByLabelText(/Shipment reference/), {
      target: { value: 'SHIP-001' },
    });
    const submit = screen.getByRole('button', { name: 'Create transfer with MetaMask' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect((await screen.findByTestId('qr-transfer-id')).textContent).toBe(TRANSFER_ID);
    expect(mocks.prepareTransfer).toHaveBeenCalledTimes(2);
    expect(mocks.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: DISTRIBUTOR }),
    );
    expect(mocks.sendPreparedTransaction).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.prepareTransfer.mock.calls)).not.toContain('confirmReceipt');
  });
});
