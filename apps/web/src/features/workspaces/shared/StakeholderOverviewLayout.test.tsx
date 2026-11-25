// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Package } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from 'react-router-dom';
import { StakeholderOverviewLayout } from './StakeholderOverviewLayout';

describe('shared stakeholder overview', () => {
  afterEach(cleanup);

  it('renders readable records across roles and keeps identifiers collapsed', () => {
    const review = vi.fn();
    const { container } = render(
      <MemoryRouter initialEntries={['/distributor/overview']}>
        <StakeholderOverviewLayout
          title="Distributor overview"
          description="Custody stock and shipment activity."
          metrics={[
            { icon: <Package />, label: 'Available stock', value: '24 kg' },
            { icon: <Package />, label: 'Incoming', value: 1 },
            { icon: <Package />, label: 'In transit', value: 2 },
            { icon: <Package />, label: 'Completed', value: 3 },
          ]}
          attention={[
            {
              name: 'Single Origin Cocoa With A Long Readable Name',
              reference: 'COCOA-2026-01',
              description: 'Review the incoming custody shipment.',
              companyName: 'Rimba Cocoa Ingredients Sdn. Bhd.',
              itemCategory: 'Cocoa',
              badge: { label: 'Awaiting receipt', variant: 'pending' },
              actionLabel: 'Review shipment',
              onAction: review,
              technical: [{ label: 'Shipment ID', value: `0x${'12'.repeat(32)}` }],
            },
          ]}
          recent={[]}
          emptyAttention="No pending work"
          emptyRecent="No recent records"
        />
      </MemoryRouter>,
    );

    const heading = screen.getByRole('heading', { name: 'Distributor overview' });
    const quick = screen.getByRole('region', { name: 'Quick actions' });
    // The page title comes before the quick actions.
    expect(heading.compareDocumentPosition(quick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByLabelText('Workspace summary')).toHaveLength(1);
    expect(screen.getByText('Single Origin Cocoa With A Long Readable Name')).toBeTruthy();
    expect(screen.getByLabelText('Cocoa image placeholder')).toBeTruthy();
    expect(screen.getByLabelText('Rimba Cocoa Ingredients Sdn. Bhd. initials')).toBeTruthy();
    const details = screen.getByText('Technical details').closest('details');
    expect(details?.open).toBe(false);
    expect(container.textContent).not.toContain(`0x${'12'.repeat(32)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Review shipment' }));
    expect(review).toHaveBeenCalledOnce();
    expect(
      within(screen.getByLabelText('Recent activity')).getByText('No recent records'),
    ).toBeTruthy();
  });
});
