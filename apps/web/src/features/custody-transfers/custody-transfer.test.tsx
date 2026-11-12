// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustodyTransferResolutionError } from './custody-transfer.api';
import type { ResolvedCustodyTransfer } from './custody-transfer.types';
import type { TransferQrReader } from './qr-reader';
import { ReceiptConfirmationError } from './receipt-confirmation';
import { ResolvedTransferCard } from './ResolvedTransferCard';
import { createTransferQrModel, createTransferQrPayload } from './transfer-qr';
import { TransferQrScanner } from './TransferQrScanner';
import { TransferQrDisplay } from './TransferQrDisplay';

const TRANSFER_ID = `0x${'11'.repeat(32)}`;
const CONTRACT_ADDRESS = '0x4000000000000000000000000000000000000004';
const PUBLIC_APP_URL = 'http://localhost:5173';
const QR_PAYLOAD = `${PUBLIC_APP_URL}/receive/transfer?v=1&chainId=31337&contract=${CONTRACT_ADDRESS}&transferId=${TRANSFER_ID}`;
const TRANSFER: ResolvedCustodyTransfer = {
  damaged: '0',
  dispatchedAt: 1_762_416_000,
  expectedAt: 1_762_502_400,
  productBatchId: `0x${'22'.repeat(32)}`,
  productName: 'Chocolate Bars',
  productReference: 'PB-2026-001',
  quantity: '250',
  recipient: '0x1000000000000000000000000000000000000001',
  recipientName: 'Swift Distribution Sdn. Bhd.',
  sender: '0x3000000000000000000000000000000000000003',
  senderName: 'CocoaCraft Manufacturing Sdn. Bhd.',
  rejected: '0',
  status: 1,
  transferId: TRANSFER_ID,
  usable: '0',
};

function reader(overrides: Partial<TransferQrReader> = {}): TransferQrReader {
  return {
    decodeImage: vi.fn().mockResolvedValue(QR_PAYLOAD),
    startCamera: vi.fn().mockResolvedValue(vi.fn()),
    ...overrides,
  };
}

function enterManualPayload() {
  fireEvent.click(screen.getByRole('tab', { name: 'Manual paste' }));
  fireEvent.change(screen.getByLabelText('Complete TraceChain QR payload'), {
    target: { value: QR_PAYLOAD },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('custody-transfer QR frontend', () => {
  it('generates the canonical QR payload with no shipment or wallet data', () => {
    const configuration = {
      chainId: 31_337,
      contractAddress: CONTRACT_ADDRESS,
      publicAppUrl: PUBLIC_APP_URL,
    };
    const payload = createTransferQrPayload(TRANSFER_ID, configuration);
    const model = createTransferQrModel(TRANSFER_ID, configuration);

    expect(payload).toBe(QR_PAYLOAD);
    expect(model.payload).toBe(QR_PAYLOAD);
    expect(model.modules.length).toBeGreaterThan(0);
    expect(payload).not.toContain('quantity');
    expect(payload).not.toContain('recipient');
    expect(payload).not.toContain('credential');
  });

  it('copies the exact HTTPS payload rendered by the Receipt Confirmation QR', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <TransferQrDisplay
        configuration={{
          chainId: 31_337,
          contractAddress: CONTRACT_ADDRESS,
          publicAppUrl: PUBLIC_APP_URL,
        }}
        transferId={TRANSFER_ID}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(QR_PAYLOAD));
    expect(screen.getByLabelText('TraceChain Receipt Confirmation QR code')).toBeTruthy();
  });

  it('submits a manually pasted payload exactly once', async () => {
    const resolvePayload = vi.fn().mockResolvedValue(TRANSFER);
    render(<TransferQrScanner reader={reader()} resolvePayload={resolvePayload} />);
    enterManualPayload();

    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));

    await waitFor(() => expect(resolvePayload).toHaveBeenCalledWith(QR_PAYLOAD));
    expect(resolvePayload).toHaveBeenCalledOnce();
  });

  it('automatically resolves a direct receipt link once without preparing a transaction', async () => {
    const resolvePayload = vi.fn().mockResolvedValue(TRANSFER);
    const prepareConfirmation = vi.fn();
    render(
      <StrictMode>
        <TransferQrScanner
          initialPayload={QR_PAYLOAD}
          prepareConfirmation={prepareConfirmation}
          reader={reader()}
          resolvePayload={resolvePayload}
        />
      </StrictMode>,
    );

    expect(await screen.findByText('Custody transfer found')).toBeTruthy();
    expect(resolvePayload).toHaveBeenCalledOnce();
    expect(resolvePayload).toHaveBeenCalledWith(QR_PAYLOAD);
    expect(prepareConfirmation).not.toHaveBeenCalled();
  });

  it('displays only the API-verified transfer after successful resolution', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(TRANSFER),
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TransferQrScanner reader={reader()} />);
    enterManualPayload();

    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));

    expect(await screen.findByText('Custody transfer found')).toBeTruthy();
    expect(screen.getByText('CocoaCraft Manufacturing Sdn. Bhd.')).toBeTruthy();
    expect(screen.getByText('Swift Distribution Sdn. Bhd.')).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getAllByText('250')).toHaveLength(2);
    expect(screen.getByText('Awaiting Receipt')).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/custody-transfers/resolve-qr');
    expect(request.method).toBe('POST');
    expect(request.credentials).toBe('include');
    expect(request.body).toBe(JSON.stringify({ qrPayload: QR_PAYLOAD }));
    expect(JSON.stringify(request)).not.toContain('confirmReceipt');
  });

  it('shows a specific API error without displaying unverified QR fields', async () => {
    const resolvePayload = vi
      .fn()
      .mockRejectedValue(
        new CustodyTransferResolutionError(
          'QR_CHAIN_MISMATCH',
          'The QR code is for a different blockchain network.',
          400,
        ),
      );
    render(<TransferQrScanner reader={reader()} resolvePayload={resolvePayload} />);
    enterManualPayload();

    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));

    expect(
      await screen.findByText('This QR code belongs to a different blockchain network.'),
    ).toBeTruthy();
    expect(screen.queryByText(TRANSFER.productBatchId)).toBeNull();
  });

  it('leaves the resolving state after an API error in React StrictMode', async () => {
    const resolvePayload = vi
      .fn()
      .mockRejectedValue(
        new CustodyTransferResolutionError(
          'TRANSFER_NOT_FOUND',
          'The referenced custody transfer does not exist.',
          404,
        ),
      );
    render(
      <StrictMode>
        <TransferQrScanner reader={reader()} resolvePayload={resolvePayload} />
      </StrictMode>,
    );
    enterManualPayload();
    const submit = screen.getByRole('button', { name: 'Verify transfer' });

    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(await screen.findByText('The referenced custody transfer was not found.')).toBeTruthy();
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText('Verifying with TraceChain…')).toBeNull();
    expect(resolvePayload).toHaveBeenCalledOnce();
  });

  it('prevents duplicate resolution requests while one is active', async () => {
    let finish: ((transfer: ResolvedCustodyTransfer) => void) | undefined;
    const resolvePayload = vi.fn(
      () =>
        new Promise<ResolvedCustodyTransfer>((resolve) => {
          finish = resolve;
        }),
    );
    render(<TransferQrScanner reader={reader()} resolvePayload={resolvePayload} />);
    enterManualPayload();
    const submit = screen.getByRole('button', { name: 'Verify transfer' });

    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(resolvePayload).toHaveBeenCalledOnce();
    finish?.(TRANSFER);
    expect(await screen.findByText('Custody transfer found')).toBeTruthy();
  });

  it('stops camera resources when closed and when unmounted', async () => {
    const firstStop = vi.fn();
    const firstReader = reader({ startCamera: vi.fn().mockResolvedValue(firstStop) });
    const { unmount } = render(
      <TransferQrScanner onClose={vi.fn()} reader={firstReader} resolvePayload={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByRole('button', { name: 'Stop camera' });
    fireEvent.click(screen.getByRole('button', { name: 'Close scanner' }));
    expect(firstStop).toHaveBeenCalledOnce();
    unmount();

    const secondStop = vi.fn();
    const secondReader = reader({ startCamera: vi.fn().mockResolvedValue(secondStop) });
    const second = render(<TransferQrScanner reader={secondReader} resolvePayload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByRole('button', { name: 'Stop camera' });
    second.unmount();
    expect(secondStop).toHaveBeenCalledOnce();
  });

  it('stops the camera immediately after a QR is detected', async () => {
    const stop = vi.fn();
    let emitResult: ((payload: string) => void) | undefined;
    const cameraReader = reader({
      startCamera: vi.fn().mockImplementation((_video, onResult) => {
        emitResult = onResult;
        return Promise.resolve(stop);
      }),
    });
    render(
      <TransferQrScanner
        reader={cameraReader}
        resolvePayload={vi.fn().mockResolvedValue(TRANSFER)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await screen.findByRole('button', { name: 'Stop camera' });

    emitResult?.(QR_PAYLOAD);

    expect(await screen.findByText('Custody transfer found')).toBeTruthy();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('prepares, submits, waits for, and refreshes a receipt confirmation once', async () => {
    let finishPreparation:
      | ((value: {
          action: 'CONFIRM_RECEIPT';
          transaction: { chainId: number; data: string; to: string; value: string };
          usableQuantity: string;
        }) => void)
      | undefined;
    const prepared = {
      chainId: 31_337,
      data: '0x1234',
      to: CONTRACT_ADDRESS,
      value: '0x0',
    };
    const prepareConfirmation = vi.fn(
      () =>
        new Promise<{
          action: 'CONFIRM_RECEIPT';
          transaction: typeof prepared;
          usableQuantity: string;
        }>((resolve) => {
          finishPreparation = resolve;
        }),
    );
    const submitConfirmation = vi.fn().mockResolvedValue(undefined);
    const received = {
      ...TRANSFER,
      actualArrivalAt: '2026-11-06T09:30:00.000Z',
      status: 2 as const,
    };
    const refreshTransfer = vi.fn().mockResolvedValue(received);
    render(
      <TransferQrScanner
        prepareConfirmation={prepareConfirmation}
        reader={reader()}
        refreshTransfer={refreshTransfer}
        resolvePayload={vi.fn().mockResolvedValue(TRANSFER)}
        submitConfirmation={submitConfirmation}
      />,
    );
    enterManualPayload();
    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm reconciled receipt' });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(prepareConfirmation).toHaveBeenCalledOnce();
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    finishPreparation?.({
      action: 'CONFIRM_RECEIPT',
      transaction: prepared,
      usableQuantity: '250',
    });
    expect(await screen.findByText('Receipt confirmed on-chain')).toBeTruthy();
    expect(screen.getByText('Received')).toBeTruthy();
    expect(screen.getByText('Actual arrival')).toBeTruthy();
    expect(screen.queryByText('Not recorded')).toBeNull();
    expect(submitConfirmation).toHaveBeenCalledOnce();
    expect(prepareConfirmation).toHaveBeenCalledWith({
      actualArrivalAt: undefined,
      actualQuantity: '250',
      damagedQuantity: '0',
      evidence: [],
      notes: '',
      rejectedQuantity: '0',
      transferId: TRANSFER_ID,
    });
    expect(submitConfirmation).toHaveBeenCalledWith(prepared, TRANSFER);
    expect(refreshTransfer).toHaveBeenCalledWith(TRANSFER_ID);
  });

  it('calculates usable inventory from damaged and rejected quantities', async () => {
    const prepareConfirmation = vi.fn().mockResolvedValue({
      action: 'CONFIRM_RECEIPT',
      transaction: { chainId: 31_337, data: '0x1234', to: CONTRACT_ADDRESS, value: '0x0' },
      usableQuantity: '235',
    });
    const onResolved = vi.fn();
    const received = {
      ...TRANSFER,
      damaged: '10',
      rejected: '5',
      status: 2 as const,
      usable: '235',
    };
    render(
      <TransferQrScanner
        onResolved={onResolved}
        prepareConfirmation={prepareConfirmation}
        reader={reader()}
        refreshTransfer={vi.fn().mockResolvedValue(received)}
        resolvePayload={vi.fn().mockResolvedValue(TRANSFER)}
        submitConfirmation={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    enterManualPayload();
    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));
    fireEvent.change(await screen.findByLabelText('Damaged quantity'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText('Rejected quantity'), { target: { value: '5' } });

    expect(screen.getByText('235')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reconciled receipt' }));

    expect(await screen.findByText('Receipt confirmed on-chain')).toBeTruthy();
    expect(prepareConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ damagedQuantity: '10', rejectedQuantity: '5' }),
    );
    expect(onResolved).toHaveBeenLastCalledWith(received);
  });

  it('blocks invalid overlapping quantities before transaction preparation', async () => {
    const prepareConfirmation = vi.fn();
    render(
      <TransferQrScanner
        prepareConfirmation={prepareConfirmation}
        reader={reader()}
        resolvePayload={vi.fn().mockResolvedValue(TRANSFER)}
      />,
    );
    enterManualPayload();
    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));
    fireEvent.change(await screen.findByLabelText('Actual quantity received'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText('Damaged quantity'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Rejected quantity'), { target: { value: '3' } });

    expect(screen.getByText('Damaged plus rejected cannot exceed actual received.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Report quantity discrepancy' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(prepareConfirmation).not.toHaveBeenCalled();
  });

  it.each([
    ['200', 'Shortage'],
    ['300', 'Excess'],
  ])('reports a %s mismatch and waits for administrator review', async (actual, label) => {
    const prepareConfirmation = vi.fn().mockResolvedValue({
      action: 'REPORT_DISCREPANCY',
      discrepancyType: label.toUpperCase(),
      transaction: { chainId: 31_337, data: '0x5678', to: CONTRACT_ADDRESS, value: '0x0' },
      usableQuantity: actual,
    });
    render(
      <TransferQrScanner
        prepareConfirmation={prepareConfirmation}
        reader={reader()}
        refreshTransfer={vi.fn().mockResolvedValue({ ...TRANSFER, status: 5 as const })}
        resolvePayload={vi.fn().mockResolvedValue(TRANSFER)}
        submitConfirmation={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    enterManualPayload();
    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));
    fireEvent.change(await screen.findByLabelText('Actual quantity received'), {
      target: { value: actual },
    });
    fireEvent.change(screen.getByLabelText(/Receipt notes/), {
      target: { value: 'Count differs from dispatch.' },
    });

    expect(screen.getByText(new RegExp(`${label} detected`))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Report quantity discrepancy' }));

    expect(await screen.findByText('Discrepancy recorded for administrator review')).toBeTruthy();
    expect(prepareConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ actualQuantity: actual, notes: 'Count differs from dispatch.' }),
    );
  });

  it('prepares complete wrong-product rejection separately from normal receipt', async () => {
    const prepareRejection = vi.fn().mockResolvedValue({
      action: 'REJECT_TRANSFER',
      transaction: { chainId: 31_337, data: '0xabcd', to: CONTRACT_ADDRESS, value: '0x0' },
    });
    render(
      <TransferQrScanner
        prepareRejection={prepareRejection}
        reader={reader()}
        refreshTransfer={vi.fn().mockResolvedValue({ ...TRANSFER, status: 3 as const })}
        resolvePayload={vi.fn().mockResolvedValue(TRANSFER)}
        submitConfirmation={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    enterManualPayload();
    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reject or wrong product' }));
    fireEvent.change(screen.getByLabelText('Rejection type'), {
      target: { value: 'WRONG_PRODUCT' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Product does not match the manifest.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit rejection through MetaMask' }));

    expect(await screen.findByText('Transfer rejected on-chain')).toBeTruthy();
    expect(prepareRejection).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Product does not match the manifest.',
        reasonType: 'WRONG_PRODUCT',
      }),
    );
  });

  it('shows a cancelled MetaMask transaction without changing the verified transfer', async () => {
    const submitConfirmation = vi
      .fn()
      .mockRejectedValue(
        new ReceiptConfirmationError(
          'REJECTED',
          'The MetaMask transaction was cancelled. The transfer remains awaiting receipt.',
        ),
      );
    render(
      <TransferQrScanner
        prepareConfirmation={vi.fn().mockResolvedValue({
          action: 'CONFIRM_RECEIPT',
          transaction: {
            chainId: 31_337,
            data: '0x1234',
            to: CONTRACT_ADDRESS,
            value: '0x0',
          },
          usableQuantity: '250',
        })}
        reader={reader()}
        refreshTransfer={vi.fn()}
        resolvePayload={vi.fn().mockResolvedValue(TRANSFER)}
        submitConfirmation={submitConfirmation}
      />,
    );
    enterManualPayload();
    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm reconciled receipt' }));

    expect(
      await screen.findByText(
        'The MetaMask transaction was cancelled. The transfer remains awaiting receipt.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Awaiting Receipt')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm reconciled receipt' })).toBeTruthy();
  });

  it('keeps the form editable for a corrected retry after MetaMask cancellation', async () => {
    const prepareConfirmation = vi.fn().mockResolvedValue({
      action: 'CONFIRM_RECEIPT',
      transaction: {
        chainId: 31_337,
        data: '0x1234',
        to: CONTRACT_ADDRESS,
        value: '0x0',
      },
      usableQuantity: '250',
    });
    const submitConfirmation = vi
      .fn()
      .mockRejectedValueOnce(
        new ReceiptConfirmationError(
          'REJECTED',
          'The MetaMask transaction was cancelled. The transfer remains awaiting receipt.',
        ),
      )
      .mockResolvedValueOnce(undefined);
    render(
      <TransferQrScanner
        prepareConfirmation={prepareConfirmation}
        reader={reader()}
        refreshTransfer={vi.fn().mockResolvedValue({ ...TRANSFER, status: 2 as const })}
        resolvePayload={vi.fn().mockResolvedValue(TRANSFER)}
        submitConfirmation={submitConfirmation}
      />,
    );
    enterManualPayload();
    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm reconciled receipt' }));
    await screen.findByText(
      'The MetaMask transaction was cancelled. The transfer remains awaiting receipt.',
    );

    fireEvent.change(screen.getByLabelText('Damaged quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Receipt notes/), {
      target: { value: 'Corrected after reviewing the delivery.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reconciled receipt' }));

    expect(await screen.findByText('Receipt confirmed on-chain')).toBeTruthy();
    expect(prepareConfirmation).toHaveBeenCalledTimes(2);
    expect(prepareConfirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        damagedQuantity: '2',
        notes: 'Corrected after reviewing the delivery.',
      }),
    );
    expect(submitConfirmation).toHaveBeenCalledTimes(2);
  });

  it('shows an honest actual-arrival fallback when no time was recorded', async () => {
    render(<ResolvedTransferCard transfer={{ ...TRANSFER, status: 2, usable: '250' }} />);

    expect(screen.getByText('Actual arrival')).toBeTruthy();
    expect(screen.getByText('Not recorded')).toBeTruthy();
  });

  it('does not submit a second transaction when post-receipt refresh fails', async () => {
    const prepareConfirmation = vi.fn().mockResolvedValue({
      action: 'CONFIRM_RECEIPT',
      transaction: {
        chainId: 31_337,
        data: '0x1234',
        to: CONTRACT_ADDRESS,
        value: '0x0',
      },
      usableQuantity: '250',
    });
    const submitConfirmation = vi.fn().mockResolvedValue(undefined);
    const refreshTransfer = vi.fn().mockRejectedValue(new Error('RPC unavailable'));
    render(
      <TransferQrScanner
        prepareConfirmation={prepareConfirmation}
        reader={reader()}
        refreshTransfer={refreshTransfer}
        resolvePayload={vi.fn().mockResolvedValue(TRANSFER)}
        submitConfirmation={submitConfirmation}
      />,
    );
    enterManualPayload();
    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm reconciled receipt' }));

    const refresh = await screen.findByRole('button', { name: 'Refresh status' });
    fireEvent.click(refresh);
    await waitFor(() => expect(refreshTransfer).toHaveBeenCalledTimes(2));
    expect(prepareConfirmation).toHaveBeenCalledOnce();
    expect(submitConfirmation).toHaveBeenCalledOnce();
  });

  it.each([
    ['WRONG_WALLET', 'The connected MetaMask account is not the intended recipient.'],
    ['REVERTED', 'The receipt transaction reverted and the transfer was not confirmed.'],
    ['RPC_ERROR', 'MetaMask or the blockchain RPC could not complete the receipt transaction.'],
  ] as const)('shows a clear %s confirmation error', async (code, message) => {
    render(
      <TransferQrScanner
        prepareConfirmation={vi.fn().mockResolvedValue({
          action: 'CONFIRM_RECEIPT',
          transaction: {
            chainId: 31_337,
            data: '0x1234',
            to: CONTRACT_ADDRESS,
            value: '0x0',
          },
          usableQuantity: '250',
        })}
        reader={reader()}
        refreshTransfer={vi.fn()}
        resolvePayload={vi.fn().mockResolvedValue(TRANSFER)}
        submitConfirmation={vi.fn().mockRejectedValue(new ReceiptConfirmationError(code, message))}
      />,
    );
    enterManualPayload();
    fireEvent.click(screen.getByRole('button', { name: 'Verify transfer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm reconciled receipt' }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText('Awaiting Receipt')).toBeTruthy();
  });
});
