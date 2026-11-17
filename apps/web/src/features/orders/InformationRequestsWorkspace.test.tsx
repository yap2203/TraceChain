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
}));
vi.mock('../production-flow/production-flow.api', () => ({
  getCompanyIdentityProofStatus: api.proofStatus,
  verifyCompanyIdentityProof: api.verify,
  requestCompanyIdentityProof: api.requestProof,
  getEvidenceDetails: api.details,
}));
vi.mock('../production-flow/evidence-didcomm', () => ({
  sendCompanyIdentityRequestMessage: api.send,
}));
vi.mock('./orders.api', () => ({ getInformationRequests: api.requests, getOrders: api.orders }));
vi.mock('./DeliveryIdentityPanel', () => ({
  DeliveryIdentityPanel: ({ order }: { order: { orderId: string } }) => (
    <p>Delivery proof manager: {order.orderId}</p>
  ),
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
        expiresAt: 2000000000,
        status: 'PRESENTED',
      },
    ],
  });
  api.orders.mockResolvedValue({
    actor: supplier,
    role: 'SUPPLIER',
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
  fireEvent.click(screen.getByRole('button', { name: 'Manage proof request' }));
  expect(screen.getByText('Delivery proof manager: ' + shipment)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to company requests' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sent requests' }));
  expect(await screen.findByText('Manufacturer Company')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Manage proof request' }));
  expect(screen.getByText('Order proof manager')).toBeTruthy();
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
  fireEvent.click(screen.getByRole('button', { name: 'Ingredient evidence' }));
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
  expect(screen.getByRole('button', { name: 'Company evidence' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ingredient evidence' }));
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
