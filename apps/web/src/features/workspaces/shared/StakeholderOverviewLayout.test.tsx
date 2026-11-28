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
  it.each(['supplier', 'manufacturer', 'distributor', 'retailer'])(
    'keeps %s section bodies aligned through loading, loaded, empty and unavailable states',
    (role) => {
      const task = {
        key: 'offer',
        task: 'Review offer',
        item: 'Cocoa',
        badge: { label: 'Your turn', variant: 'pending' as const },
        actionLabel: 'Review offer',
        onAction: vi.fn(),
      };
      const props = {
        title: `${role} overview`,
        description: 'Activity',
        metrics: [{ icon: <Package />, label: 'Orders', value: 7 }],
        tasks: [] as (typeof task)[],
        snapshot: snapshot(),
        tasksLoading: true,
        errors: [] as string[],
        refreshing: false,
      };
      const view = (overrides: Partial<typeof props> = {}) => (
        <MemoryRouter initialEntries={[`/${role}/overview`]}>
          <StakeholderOverviewLayout {...props} {...overrides} />
        </MemoryRouter>
      );
      const { container, rerender } = render(view());
      const work = screen.getByRole('region', { name: 'Needs your action' });
      const records = screen.getByRole('region', { name: 'Recent custody offers' });
      const workBody = work.querySelector('.overview-panel__body');
      const recordsBody = records.querySelector('.overview-panel__body');
      expect(within(work).getByRole('status').parentElement).toBe(workBody);
      expect(within(records).getByRole('status').parentElement).toBe(recordsBody);
      expect(work.querySelector('.embedded-skeleton__row')?.children).toHaveLength(6);
      expect(records.querySelector('.embedded-skeleton__row')?.children).toHaveLength(2);
      expect(container.querySelector('.page-skeleton')).toBeNull();
      expect(screen.getByRole('status', { name: 'Loading Orders' })).toBeTruthy();
      expect(screen.queryByText('7')).toBeNull();
      expect(screen.queryByText('…')).toBeNull();

      const loaded = {
        tasksLoading: false,
        tasks: [task],
        snapshot: snapshot([{ key: 'a', cells: ['Cocoa', 'Received'] }]),
      };
      rerender(view(loaded));
      expect(work.querySelector('.overview-panel__body')).toBe(workBody);
      expect(records.querySelector('.overview-panel__body')).toBe(recordsBody);
      expect(workBody?.querySelector('table')).toBeTruthy();
      expect(recordsBody?.querySelector('table')).toBeTruthy();
      expect(screen.getByText('7')).toBeTruthy();
      rerender(view({ ...loaded, refreshing: true }));
      expect(workBody?.querySelector('table')).toBeTruthy();
      expect(container.querySelector('.embedded-skeleton')).toBeNull();

      rerender(view({ tasksLoading: false }));
      expect(workBody?.textContent).toContain("You're all caught up");
      expect(recordsBody?.textContent).toContain('No custody offers yet.');
      rerender(view({ tasksLoading: false, errors: ['Unavailable'] }));
      expect(workBody?.textContent).toContain('Activity could not be checked');
      expect(recordsBody?.textContent).toContain('Records are temporarily unavailable');
      expect(work.querySelector('.overview-panel__body')).toBe(workBody);
    },
  );

  it('keeps a loaded metric visible while a different summary source is still loading', () => {
    render(
      <MemoryRouter>
        <StakeholderOverviewLayout
          title="Overview"
          description="Activity"
          metrics={[
            { label: 'Loaded orders', icon: <Package />, value: 7, loading: false },
            { label: 'Pending source', icon: <Package />, value: 0, loading: true },
          ]}
          tasks={[]}
          tasksLoading
          snapshot={snapshot()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading Pending source' })).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });
  it('shows unavailable and retry rather than false zeros or a successful empty dashboard', () => {
    const retry = vi.fn();
    render(
      <MemoryRouter>
        <StakeholderOverviewLayout
          title="Overview"
          description="Activity"
          metrics={[{ label: 'Orders', icon: <Package />, value: 0 }]}
          tasks={[]}
          snapshot={snapshot()}
          errors={['Blockchain temporarily unavailable']}
          onRefresh={retry}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText(/You.re all caught up/)).toBeNull();
    expect(screen.queryByText('No custody offers yet.')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

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
