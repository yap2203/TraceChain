// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  requests: vi.fn(),
  orders: vi.fn(),
  proofStatus: vi.fn(),
  verify: vi.fn(),
  requestProof: vi.fn(),
  details: vi.fn(),
  send: vi.fn(),
  offer: vi.fn(),
}));
vi.mock('../production-flow/production-flow.api', () => ({
  getCompanyIdentityProofStatus: api.proofStatus,
  verifyCompanyIdentityProof: api.verify,
  requestCompanyIdentityProof: api.requestProof,
  getEvidenceDetails: api.details,
}));
vi.mock('./orders.api', () => ({
  getInformationRequests: api.requests,
  getOrders: api.orders,
  getCustodyOffer: api.offer,
}));
vi.mock('./DeliveryIdentityPanel', () => ({
  DeliveryIdentityPanel: ({
    order,
    requestedBy,
  }: {
    order: { orderId: string };
    requestedBy?: string;
  }) => (
    <p>
      Delivery proof manager: {order.orderId} {requestedBy}
    </p>
  ),
  proofStatusLabel: (status: string) =>
    status === 'VERIFIED'
      ? 'Verified'
      : status === 'UNAVAILABLE'
        ? 'Unavailable'
        : status === 'EXPIRED'
          ? 'Expired'
          : 'Awaiting response',
  proofStatusVariant: (status: string) =>
    status === 'VERIFIED' ? 'verified' : status === 'EXPIRED' ? 'expired' : 'pending',
}));
vi.mock('./OrdersPage', () => ({ OrdersPage: () => <p>Order proof manager</p> }));
vi.mock('../production-flow/CompanyIdentityProofAction', () => ({
  CompanyIdentityProofAction: () => <p>Company presenter</p>,
}));
import { InformationRequestsWorkspace } from './InformationRequestsWorkspace';
import { workspaceNavigation } from '../workspaces/workspace-navigation';
const supplier = '0x1000000000000000000000000000000000000001',
  distributor = '0x2000000000000000000000000000000000000002',
  shipment = '0x' + 'a'.repeat(64);
beforeEach(() => {
  api.requests.mockResolvedValue({
    requests: [
      {
        requestId: 'proof-in',
        referenceId: shipment,
        context: 'delivery',
        direction: 'received',
        company: 'Warehouse Company',
        purpose: 'Confirm Supplier role',
        requestedAt: 1900000000,
        expiresAt: 2000000000,
        status: 'REQUESTED',
      },
      {
        requestId: 'proof-out',
        referenceId: 'order',
        context: 'order',
        direction: 'sent',
        company: 'Manufacturer Company',
        purpose: 'Company evidence for order',
        requestedAt: 1900000000,
        expiresAt: 2000000000,
        status: 'PRESENTED',
      },
    ],
  });
  api.orders.mockResolvedValue({
    actor: supplier,
    role: 'SUPPLIER',
    companies: [
      { wallet: supplier, companyName: 'Rimba Cocoa Ingredients', role: 'SUPPLIER' },
      { wallet: distributor, companyName: 'Warehouse Company', role: 'DISTRIBUTOR' },
      {
        wallet: 'manufacturer',
        companyName: 'Manufacturer Company',
        role: 'MANUFACTURER',
      },
    ],
    catalogue: [],
    locations: [],
    shipments: [],
    orders: [{ orderId: 'order', seller: supplier, buyer: 'manufacturer' }],
    logistics: {
      shipments: [
        {
          shipmentId: shipment,
          leg: 1,
          sender: supplier,
          recipient: distributor,
          delivery: { stage: 2, distributor },
          expiresAt: 2000000000,
        },
      ],
    },
  });
  api.offer.mockResolvedValue({
    offer: {
      offerId: '0x' + 'c'.repeat(64),
      kind: 1,
      batchId: '0x' + 'b'.repeat(64),
      quantity: '8',
      unit: 'kg',
      sender: supplier,
      distributor,
      senderName: 'Rimba Cocoa Ingredients',
      distributorName: 'Bayu Food Logistics',
      itemName: 'Unsweetened Cocoa Powder',
      fromLocation: 'source',
      toLocation: 'warehouse',
      expiresAt: 2000000000,
      status: 'REQUESTED',
    },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it.each(['received', 'sent'] as const)(
  'keeps the %s sidebar page fixed without embedding the other direction',
  async (direction) => {
    render(
      <MemoryRouter>
        <InformationRequestsWorkspace role="supplier" initialDirection={direction} />
      </MemoryRouter>,
    );
    await screen.findByText(
      direction === 'received' ? 'Warehouse Company' : 'Manufacturer Company',
    );
    expect(
      screen.queryByText(direction === 'received' ? 'Manufacturer Company' : 'Warehouse Company'),
    ).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Company proof direction' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Received requests' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sent requests' })).toBeNull();
  },
);
it('provides separate received and sent information requests for participating companies', () => {
  for (const role of ['supplier', 'manufacturer', 'distributor', 'retailer'] as const) {
    expect(workspaceNavigation[role].some(([id]) => id === 'requests')).toBe(true);
    expect(workspaceNavigation[role].some(([id]) => id === 'sent-requests')).toBe(true);
  }
});
it('separates sent and received company proof requests and opens the correct existing manager', async () => {
  render(
    <MemoryRouter>
      <InformationRequestsWorkspace role="supplier" />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Warehouse Company')).toBeTruthy();
  expect(screen.queryByText('Manufacturer Company')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
  expect(screen.getByText('Delivery proof manager: ' + shipment)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Received requests' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sent requests' }));
  expect(await screen.findByText('Manufacturer Company')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
  expect(screen.getByText('Order proof manager')).toBeTruthy();
});

it('shows registered participants, readable status and a compact next action', async () => {
  render(
    <MemoryRouter>
      <InformationRequestsWorkspace role="supplier" initialDirection="received">
        <p>Ingredient evidence controls</p>
      </InformationRequestsWorkspace>
    </MemoryRouter>,
  );

  expect(await screen.findByText('Company identity verification')).toBeTruthy();
  expect(screen.getByText('Warehouse Company')).toBeTruthy();
  expect(screen.getByText('Rimba Cocoa Ingredients')).toBeTruthy();
  expect(screen.queryByText('Your company')).toBeNull();
  expect(screen.getByText('Awaiting response')).toBeTruthy();
  expect(screen.getByText('Review and respond')).toBeTruthy();
  expect(document.querySelector('.information-request-card__next p')?.textContent).toBe(
    'Next action: Review the request and choose whether to share your company evidence.',
  );
  expect(screen.getByRole('button', { name: 'Review request' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: /Company evidence/ })).toBeTruthy();
  expect(screen.getByRole('tab', { name: /Ingredient evidence/ })).toBeTruthy();

  const technical = screen.getByText('Technical details').closest('details');
  expect(technical?.hasAttribute('open')).toBe(false);
  expect(document.querySelector('.information-request-card__parties')).toBeTruthy();
  expect(document.querySelector('.information-request-card__next')).toBeTruthy();
});

it('uses Expired and Overdue labels without exposing the raw status in the summary', async () => {
  api.requests.mockResolvedValueOnce({
    requests: [
      {
        requestId: 'expired-proof',
        referenceId: shipment,
        context: 'delivery',
        direction: 'received',
        company: 'Warehouse Company',
        purpose: 'Confirm Supplier role',
        expiresAt: 1,
        status: 'EXPIRED',
      },
    ],
  });
  render(
    <MemoryRouter>
      <InformationRequestsWorkspace role="supplier" initialDirection="received" />
    </MemoryRouter>,
  );

  expect(await screen.findByText('Expired')).toBeTruthy();
  expect(screen.getByText('Overdue')).toBeTruthy();
  expect(document.querySelector('.information-request-card__heading')?.textContent).not.toContain(
    'EXPIRED',
  );
  expect(screen.getByText('EXPIRED').closest('details')?.hasAttribute('open')).toBe(false);
  expect(screen.getByText('No action available')).toBeTruthy();
});
it('denies an unrelated delivery reference in a direct URL', async () => {
  render(
    <MemoryRouter
      initialEntries={['/supplier/information-requests?context=delivery&referenceId=foreign']}
    >
      <InformationRequestsWorkspace role="supplier" />
    </MemoryRouter>,
  );
  expect(await screen.findByText(/not available to your company/)).toBeTruthy();
  expect(screen.queryByText(/Delivery proof manager/)).toBeNull();
});
it('preserves the existing ingredient-evidence workflow under its own category', async () => {
  render(
    <MemoryRouter>
      <InformationRequestsWorkspace role="supplier">
        <p>Existing ingredient request controls</p>
      </InformationRequestsWorkspace>
    </MemoryRouter>,
  );
  await screen.findByText('Warehouse Company');
  fireEvent.click(screen.getByRole('tab', { name: /Ingredient evidence/ }));
  expect(screen.getByText('Existing ingredient request controls')).toBeTruthy();
});
it('keeps company and ingredient evidence as compact tabs on the sent-request route', async () => {
  render(
    <MemoryRouter>
      <InformationRequestsWorkspace role="retailer" initialDirection="sent">
        <p>Retailer ingredient evidence controls</p>
      </InformationRequestsWorkspace>
    </MemoryRouter>,
  );
  await screen.findByText('Manufacturer Company');
  expect(screen.getByRole('tab', { name: /Company evidence/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Ingredient evidence/ }));
  expect(screen.getByText('Retailer ingredient evidence controls')).toBeTruthy();
  expect(screen.queryByText('Manufacturer Company')).toBeNull();
});
it('verifies an ingredient-linked company proof only after explicit action and shows check results', async () => {
  api.proofStatus.mockResolvedValue({ status: 'PRESENTED', requestId: 'ingredient-proof' });
  api.verify.mockResolvedValue({
    status: 'VERIFIED',
    checks: ['Signature and holder checks passed'],
    verifiedAt: '2026-11-15T10:00:00Z',
  });
  render(
    <MemoryRouter
      initialEntries={[
        '/supplier/information-requests?context=ingredient&referenceId=ingredient-proof',
      ]}
    >
      <InformationRequestsWorkspace role="supplier" />
    </MemoryRouter>,
  );
  const button = await screen.findByRole('button', { name: 'Verify company proof' });
  expect(api.verify).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(await screen.findByText('Signature and holder checks passed')).toBeTruthy();
  expect(api.verify).toHaveBeenCalledWith('ingredient-proof');
  expect(api.send).not.toHaveBeenCalled();
});

it('shows readable custody-offer context, compact tabs and collapsed technical details', async () => {
  const offerId = '0x' + 'c'.repeat(64);
  render(
    <MemoryRouter
      initialEntries={[`/supplier/information-requests?context=custody&referenceId=${offerId}`]}
    >
      <InformationRequestsWorkspace role="supplier" initialDirection="received">
        <p>Ingredient evidence controls</p>
      </InformationRequestsWorkspace>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'Company evidence request' })).toBeTruthy();
  expect(await screen.findByText('Unsweetened Cocoa Powder')).toBeTruthy();
  expect(screen.getAllByText('Bayu Food Logistics').length).toBeGreaterThan(0);
  expect(screen.getByText('8 kg')).toBeTruthy();
  expect(screen.getByText('Awaiting acceptance')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'View custody offer' }).getAttribute('href')).toContain(
    '/supplier/transfers?offerId=',
  );
  expect(screen.getByRole('tab', { name: /Company evidence/ })).toBeTruthy();
  expect(screen.getByRole('tab', { name: /Ingredient evidence/ })).toBeTruthy();
  const technical = screen.getAllByText('Technical details')[0]!.closest('details');
  expect(technical?.hasAttribute('open')).toBe(false);
  expect(screen.queryByRole('button', { name: 'Back to company requests' })).toBeNull();
});
