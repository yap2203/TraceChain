// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminCustodyDiscrepancy } from '../../../custody-transfers/custody-transfer.types';
import DiscrepancyManagementPage from './DiscrepancyManagementPage';

const mocks = vi.hoisted(() => ({
  getCustodyDiscrepancies: vi.fn(),
  prepareDiscrepancyResolution: vi.fn(),
  submitProductionTransaction: vi.fn(),
}));

vi.mock('../../../custody-transfers/custody-transfer.api', () => ({
  getCustodyDiscrepancies: mocks.getCustodyDiscrepancies,
  prepareDiscrepancyResolution: mocks.prepareDiscrepancyResolution,
}));
vi.mock('../../../production-flow/production-flow.transaction', () => ({
  submitProductionTransaction: mocks.submitProductionTransaction,
}));

const ITEM: AdminCustodyDiscrepancy = {
  actualQuantity: '200',
  damaged: '0',
  discrepancyType: 'SHORTAGE',
  dispatchedAt: 1_762_416_000,
  expectedAt: 1_762_502_400,
  expectedQuantity: '250',
  privateDetails: { evidence: [], notes: 'Five cartons were missing.' },
  productBatchId: `0x${'22'.repeat(32)}`,
  productName: 'Dark Chocolate Bar',
  productReference: 'CHOCOLATE-2026-050',
  quantity: '250',
  recipient: '0x1000000000000000000000000000000000000001',
  recipientName: 'Swift Distribution Sdn. Bhd.',
  rejected: '0',
  reportedAt: 1_762_416_500,
  resolved: false,
  sender: '0x3000000000000000000000000000000000000003',
  senderName: 'CocoaCraft Manufacturing Sdn. Bhd.',
  status: 5,
  technical: {
    detailsHash: `0x${'77'.repeat(32)}`,
    evidenceCid: 'bafy-encrypted-discrepancy',
    recipientWallet: '0x1000000000000000000000000000000000000001',
    senderWallet: '0x3000000000000000000000000000000000000003',
    transferId: `0x${'11'.repeat(32)}`,
  },
  transferId: `0x${'11'.repeat(32)}`,
  usable: '0',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Admin receipt discrepancy management', () => {
  it('lists authoritative discrepancies with readable stakeholder and product names', async () => {
    mocks.getCustodyDiscrepancies.mockResolvedValue([ITEM]);
    render(<DiscrepancyManagementPage />);

    expect(await screen.findByText('Dark Chocolate Bar')).toBeTruthy();
    expect(screen.getByText('CHOCOLATE-2026-050')).toBeTruthy();
    expect(screen.getByText(/CocoaCraft Manufacturing/)).toBeTruthy();
    expect(screen.getByText(/Swift Distribution/)).toBeTruthy();
    expect(screen.getByText('Five cartons were missing.')).toBeTruthy();
    expect(screen.getByText('Administrator review required')).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
  });

  it('prepares and submits an accepted actual quantity through MetaMask', async () => {
    mocks.getCustodyDiscrepancies.mockResolvedValue([ITEM]);
    mocks.prepareDiscrepancyResolution.mockResolvedValue({
      actorWallet: '0x6000000000000000000000000000000000000006',
      decision: 'ACCEPT_ACTUAL',
      transaction: {
        chainId: 31_337,
        data: '0x9876',
        to: '0x4000000000000000000000000000000000000004',
        value: '0x0',
      },
    });
    mocks.submitProductionTransaction.mockResolvedValue(undefined);
    render(<DiscrepancyManagementPage />);
    await screen.findByText('Dark Chocolate Bar');
    fireEvent.change(screen.getByLabelText('Decision reason'), {
      target: { value: 'Verified against the receiving record.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept actual quantity' }));

    await waitFor(() => expect(mocks.submitProductionTransaction).toHaveBeenCalledOnce());
    expect(mocks.prepareDiscrepancyResolution).toHaveBeenCalledWith({
      acceptActual: true,
      reason: 'Verified against the receiving record.',
      transferId: ITEM.transferId,
    });
  });
});
