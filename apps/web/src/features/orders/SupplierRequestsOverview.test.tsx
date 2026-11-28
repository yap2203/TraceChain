// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestStatus, RequestsLoading, RequestsOverview, nextAction } from './RequestsOverview';

afterEach(cleanup);

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
  it.each([
    ['5', 'Partially received', 'approved'],
    ['12', 'Received', 'closed'],
  ])(
    'keeps receipt status after the request inbox redesign (%s received)',
    (received, label, group) => {
      expect(
        requestStatus({ ...request, decision: { status: 1 }, approvedReceivedQuantity: received }),
      ).toMatchObject({ label, group });
    },
  );
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
    expect(screen.getByRole('button', { name: 'View details' })).toBeTruthy();
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
      'View details',
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

it('shows the actual Supplier and a waiting status for Manufacturer requests, with one server pager', () => {
  const onView = vi.fn();
  render(
    <RequestsOverview
      actor={buyer}
      role="manufacturer"
      catalogue={catalogue}
      orders={[{ ...request, sellerName: 'Rimba Ingredients', kind: 1 }]}
      pagination={{ page: 1, pageSize: 10, total: 25, counts: { all: 25, attention: 25 } }}
      onView={onView}
      onQueryChange={vi.fn()}
    />,
  );
  expect(screen.getByRole('columnheader', { name: 'Supplier' })).toBeTruthy();
  expect(screen.queryByRole('columnheader', { name: /Retailer/ })).toBeNull();
  expect(screen.getAllByText('Waiting for Supplier').length).toBeGreaterThan(0);
  expect(screen.queryByText('Needs your review')).toBeNull();
  expect(screen.getByRole('button', { name: /Awaiting response/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Needs action/ })).toBeNull();
  expect(screen.getAllByRole('navigation', { name: 'Order pages' })).toHaveLength(1);
  expect(screen.queryByLabelText('Table pagination')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'View details' })[0]);
  expect(onView).toHaveBeenCalledWith(request.orderId);
  expect(requestStatus(request, buyer).needsAction).toBe(false);
  expect(requestStatus(request, actor).needsAction).toBe(true);
});

it('does not slice an already paginated server page a second time', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...request, orderId: 'order-' + i }));
  render(
    <RequestsOverview
      actor={actor}
      role="manufacturer"
      catalogue={catalogue}
      orders={rows}
      pagination={{ page: 2, pageSize: 25, total: 37, counts: { all: 37, attention: 37 } }}
      onView={vi.fn()}
      onQueryChange={vi.fn()}
    />,
  );
  expect(screen.getAllByRole('row')).toHaveLength(13);
  expect(screen.getByRole('columnheader', { name: 'Retailer' })).toBeTruthy();
  expect(screen.getAllByRole('navigation', { name: 'Order pages' })).toHaveLength(1);
});

it('keeps received-request filter wording when search returns no rows', () => {
  render(
    <RequestsOverview
      actor={actor}
      role="manufacturer"
      direction="received"
      catalogue={catalogue}
      orders={[]}
      pagination={{ page: 1, pageSize: 10, total: 0, counts: { all: 4, attention: 4 } }}
      onView={vi.fn()}
      onQueryChange={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: /Needs action/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Awaiting response/ })).toBeNull();
  expect(screen.getByText('No requests match these filters')).toBeTruthy();
});

it.each([
  ['sent', buyer, 'Ingredient or Supplier'],
  ['received', actor, 'Product or Retailer'],
] as const)(
  'uses contextual search and singular results for %s requests without a disabled server pager',
  (direction, wallet, placeholder) => {
    render(
      <RequestsOverview
        actor={wallet}
        role="manufacturer"
        direction={direction}
        catalogue={catalogue}
        orders={[request]}
        pagination={{ page: 1, pageSize: 10, total: 1, counts: { all: 1, attention: 1 } }}
        onView={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText(placeholder)).toBeTruthy();
    expect(screen.getByText('1 result')).toBeTruthy();
    expect(screen.queryByText('1 results')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Order pages' })).toBeNull();
  },
);

it('keeps plural results and a concise, role-aware next action', () => {
  render(
    <RequestsOverview
      actor={buyer}
      role="manufacturer"
      direction="sent"
      catalogue={catalogue}
      orders={[request, { ...request, orderId: 'second' }]}
      onView={vi.fn()}
    />,
  );
  expect(screen.getByText('2 results')).toBeTruthy();
  const product = { ...request, productDelivery: { stage: 5 } };
  expect(nextAction(product, actor)).toBe('No action required');
  expect(nextAction({ ...product, productDelivery: { stage: 4 } }, buyer)).toBe('Confirm receipt');
  expect(nextAction({ ...product, productDelivery: { stage: 4 } }, actor)).toBe(
    'Waiting for Retailer to confirm receipt',
  );
});
