// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ResolvedTransferCard } from '../custody-transfers/ResolvedTransferCard';

const SENDER = '0x3000000000000000000000000000000000000003';
const RECIPIENT = '0x4000000000000000000000000000000000000004';

afterEach(cleanup);

describe('stakeholder presentation', () => {
  it('shows verified company names while keeping wallets behind technical details', () => {
    const { container } = render(
      <ResolvedTransferCard
        transfer={{
          damaged: '0',
          dispatchedAt: 1_800_000_000,
          expectedAt: 1_800_086_400,
          productBatchId: `0x${'22'.repeat(32)}`,
          productName: 'Chocolate Bars',
          productReference: 'PB-2026-001',
          quantity: '25',
          recipient: RECIPIENT,
          recipientName: 'Swift Distribution Sdn. Bhd.',
          sender: SENDER,
          senderName: 'CocoaCraft Manufacturing Sdn. Bhd.',
          rejected: '0',
          status: 1,
          transferId: `0x${'44'.repeat(32)}`,
          usable: '0',
        }}
      />,
    );

    expect(screen.getByText('CocoaCraft Manufacturing Sdn. Bhd.')).toBeTruthy();
    expect(screen.getByText('Swift Distribution Sdn. Bhd.')).toBeTruthy();
    expect(container.textContent).not.toContain(SENDER);

    const details = screen.getByText('Technical details').closest('details');
    expect(details?.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByText('Technical details'));
    expect(details?.hasAttribute('open')).toBe(true);
    expect(screen.getByText('0x30000000...000003')).toBeTruthy();
  });
});
