// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Package } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from 'react-router-dom';
import { StakeholderOverviewLayout } from './StakeholderOverviewLayout';

const snapshot = (rows = [] as Array<{ key: string; cells: string[] }>) => ({
  title: 'Recent custody offers',
  columns: ['Item', 'Status'],
  rows,
  empty: 'No custody offers yet.',
  viewAllLabel: 'View all offers',
  onViewAll: vi.fn(),
});

describe('shared stakeholder overview', () => {
  afterEach(cleanup);

  it('lists work across workflows by deadline with one action each, and links metrics', () => {
    const review = vi.fn();
    const openOffers = vi.fn();
    const now = Math.floor(Date.now() / 1000);
    render(
      <MemoryRouter initialEntries={['/distributor/overview']}>
        <StakeholderOverviewLayout
          title="Distributor overview"
          description="Custody stock and shipment activity."
          metrics={[
            { icon: <Package />, label: 'Offers waiting on you', value: 2, onClick: openOffers },
            { icon: <Package />, label: 'Arrivals to receive', value: 1 },
          ]}
          tasks={[
            {
              key: 'later',
              task: 'Arrange pickup time',
              item: 'Cocoa beans',
              counterparty: 'Rimba Cocoa',
              due: now + 5 * 24 * 3600,
              badge: { label: 'Your turn', variant: 'pending' },
              actionLabel: 'Arrange pickup',
              onAction: vi.fn(),
            },
            {
              key: 'overdue',
              task: 'Accept or reject custody offer',
              item: 'Single Origin Cocoa',
              detail: '12 kg',
              counterparty: 'Rimba Cocoa Ingredients Sdn. Bhd.',
              due: now - 60,
              badge: { label: 'Your turn', variant: 'pending' },
              actionLabel: 'Review offer',
              onAction: review,
            },
          ]}
          snapshot={snapshot([{ key: 'a', cells: ['Cocoa beans', 'Received'] }])}
        />
      </MemoryRouter>,
    );

    const heading = screen.getByRole('heading', { name: 'Distributor overview' });
    const quick = screen.getByRole('region', { name: 'Quick actions' });
    expect(heading.compareDocumentPosition(quick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const work = screen.getByRole('region', { name: 'Needs your action' });
    const rows = within(work).getAllByRole('row').slice(1);
    // Most urgent first, overdue clearly labelled.
    expect(rows[0]!.textContent).toContain('Single Origin Cocoa');
    expect(rows[0]!.textContent).toContain('Overdue');
    expect(work.textContent).not.toContain('Technical details');
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Review offer' }));
    expect(review).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Offers waiting on you/ }));
    expect(openOffers).toHaveBeenCalledOnce();
    expect(
      within(screen.getByRole('region', { name: 'Recent custody offers' })).getByText(
        'Cocoa beans',
      ),
    ).toBeTruthy();
  });

  it('says when there is nothing to do and when a snapshot is empty', () => {
    render(
      <MemoryRouter initialEntries={['/supplier/overview']}>
        <StakeholderOverviewLayout
          title="Supplier overview"
          description="Orders and stock."
          metrics={[]}
          tasks={[]}
          snapshot={snapshot()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/You.re all caught up/)).toBeTruthy();
    expect(screen.getByText('No custody offers yet.')).toBeTruthy();
  });
});
