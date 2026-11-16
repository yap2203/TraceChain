// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const transferId = `0x${'11'.repeat(32)}`;
vi.mock('../../../blockchain/useOperationalData', () => ({
  useOperationalData: () => ({
    loading: false,
    error: '',
    data: {
      ingredientBatches: [],
      productBatches: [],
      evidenceRequests: [],
      transfers: [
        {
          transferId,
          productBatchId: `0x${'22'.repeat(32)}`,
          sender: '0x1000000000000000000000000000000000000001',
          senderName: 'Bayside Distributor',
          recipient: '0x2000000000000000000000000000000000000002',
          recipientName: 'Central Retailer',
          quantity: '24',
          dispatchedAt: 1_800_000_000,
          expectedAt: 1_800_086_400,
          status: 1,
          usable: '0',
          damaged: '0',
          rejected: '0',
        },
      ],
    },
  }),
}));

import { ReceiveProduct } from './ReceiveProductDetail';

describe('retailer receipt process detail', () => {
  it('uses the shared four-stage process layout and keeps technical values collapsed', () => {
    render(<ReceiveProduct shipmentId={transferId} onBack={vi.fn()} onViewHistory={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Product Receipt' })).toBeTruthy();
    const progress = screen.getByRole('list', { name: 'Retailer receipt progress' });
    expect(within(progress).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Bayside Distributor')).toBeTruthy();
    expect(screen.getByText('Central Retailer')).toBeTruthy();
    expect(screen.getByText('Technical details').closest('details')?.hasAttribute('open')).toBe(
      false,
    );
  });
});
