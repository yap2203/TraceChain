// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestsLoading, RequestsOverview } from './RequestsOverview';

const actor = '0x2000000000000000000000000000000000000002';
const buyer = '0x3000000000000000000000000000000000000003';
const batchId = `0x${'11'.repeat(32)}`;
const catalogue = [
  {
    itemId: 'cocoa',
    name: 'Single Origin Cocoa Beans With A Long Ingredient Name',
    category: 'Cocoa',
    batchReference: 'COCOA-2026-01',
    batches: [batchId],
    unit: 'kg',
  },
];
const request = {
  orderId: `0x${'22'.repeat(32)}`,
  itemId: 'cocoa',
  buyer,
  buyerName: 'Long Manufacturer Company Name Sdn. Bhd.',
  seller: actor,
  requested: '12',
  requestedAt: 1_800_000_000,
  updatedAt: 1_800_000_100,
  expiresAt: 1_900_000_000,
  status: '1',
  decision: { status: 0 },
};

function mount(orders = [request]) {
  return render(
    <RequestsOverview
      actor={actor}
      catalogue={catalogue}
      orders={orders}
      role="supplier"
      onView={vi.fn()}
    />,
  );
}

describe('Supplier quantity request inbox', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-11-12T00:00:00Z')));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('calculates real summary counts and filters requests needing attention or evidence', () => {
    const orders = [
      request,
      {
        ...request,
        orderId: `0x${'33'.repeat(32)}`,
        identityChallenge: `0x${'44'.repeat(32)}`,
      },
      { ...request, orderId: `0x${'55'.repeat(32)}`, decision: { status: 1 } },
      { ...request, orderId: `0x${'66'.repeat(32)}`, decision: { status: 2 } },
    ];
    mount(orders);

    const summary = screen.getByLabelText('Filter requests by status');
    expect(
      within(summary)
        .getByRole('button', { name: /All requests/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    for (const [label, count] of [
      ['Needs review', '1'],
      ['Waiting for company evidence', '1'],
      ['Approved', '1'],
      ['Rejected or closed', '1'],
    ]) {
      const filter = within(summary).getByRole('button', { name: new RegExp(label) });
      expect(within(filter).getByText(count)).toBeTruthy();
    }

    expect(screen.queryByRole('tablist', { name: 'Request status' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Waiting for company evidence/ }));
    expect(screen.getByText('Waiting for Manufacturer proof')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review request' })).toBeTruthy();
  });

  it('searches and sorts readable request cards while keeping identifiers technical', () => {
    const older = {
      ...request,
      orderId: `0x${'77'.repeat(32)}`,
      itemId: 'older',
      buyerName: 'Earlier Manufacturer',
      requestedAt: 1_700_000_000,
    };
    const { container } = render(
      <RequestsOverview
        actor={actor}
        catalogue={[...catalogue, { ...catalogue[0], itemId: 'older', name: 'Earlier Cocoa' }]}
        orders={[request, older]}
        role="supplier"
        onView={vi.fn()}
      />,
    );

    const list = container.querySelector('.supplier-requests-list') as HTMLElement;
    expect(list.querySelector('h4')?.textContent).toContain('Single Origin Cocoa');
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'oldest' } });
    expect(list.querySelector('h4')?.textContent).toBe('Earlier Cocoa');

    fireEvent.change(screen.getByLabelText('Search requests'), {
      target: { value: 'Long Manufacturer' },
    });
    expect(screen.getByText('Long Manufacturer Company Name Sdn. Bhd.')).toBeTruthy();
    expect(screen.queryByText('Earlier Manufacturer')).toBeNull();

    const row = container.querySelector('.supplier-request-row') as HTMLElement;
    const visibleSummary = row.textContent ?? '';
    expect(visibleSummary).not.toContain(buyer);
    expect(visibleSummary).not.toContain(request.orderId);
    expect(within(row).queryByText('Technical details')).toBeNull();
    expect(row.querySelector('table')).toBeNull();
  });

  it('uses image and company fallbacks with one responsive desktop-row/mobile-card structure', () => {
    const { container } = mount();
    expect(screen.getByLabelText('Cocoa image placeholder')).toBeTruthy();
    expect(screen.getByLabelText('Long Manufacturer Company Name Sdn. Bhd. initials')).toBeTruthy();
    expect(container.querySelector('.supplier-requests-list')).toBeTruthy();
    const row = container.querySelector(
      '.supplier-request-row.supplier-request-card',
    ) as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.children[0].classList.contains('catalogue-image')).toBe(true);
    expect(row.children[1].classList.contains('supplier-request-item-info')).toBe(true);
    expect(row.children[2].classList.contains('supplier-request-facts')).toBe(true);
    expect(row.children[3].classList.contains('supplier-request-state')).toBe(true);
    expect(row.children).toHaveLength(4);
    expect(container.querySelector('.supplier-request-action button')?.textContent).toBe(
      'Review request',
    );
  });

  it('handles missing submission dates and expired deadlines without changing request state', () => {
    mount([{ ...request, requestedAt: 0, expiresAt: 1 }]);
    expect(screen.getByText('Not recorded')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByText('Deadline passed')).toBeTruthy();
  });

  it('shows clear loading, empty and filtered-empty states without fixtures', () => {
    const { rerender } = render(<RequestsLoading />);
    expect(screen.getByRole('status', { name: 'Loading requests' })).toBeTruthy();
    rerender(
      <RequestsOverview
        actor={actor}
        catalogue={catalogue}
        orders={[]}
        role="supplier"
        onView={vi.fn()}
      />,
    );
    expect(screen.getByText('No incoming requests')).toBeTruthy();
    rerender(
      <RequestsOverview
        actor={actor}
        catalogue={catalogue}
        orders={[request]}
        role="supplier"
        onView={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Search requests'), {
      target: { value: 'not-a-real-request' },
    });
    expect(screen.getByText('No requests match these filters')).toBeTruthy();
  });
});
