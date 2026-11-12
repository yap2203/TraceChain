// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  listEvidenceRequests: vi.fn(),
  getCompanyIdentityProofStatus: vi.fn(),
  getOrders: vi.fn(),
  orderIdentity: vi.fn(),
}));
vi.mock('../../../orders/orders.api', () => ({
  getOrders: mocks.getOrders,
  orderIdentity: mocks.orderIdentity,
}));
vi.mock('../../../production-flow/production-flow.api', () => ({
  listEvidenceRequests: mocks.listEvidenceRequests,
  getCompanyIdentityProofStatus: mocks.getCompanyIdentityProofStatus,
}));
vi.mock('../../../orders/OrdersPage', () => ({
  OrdersPage: (props: any) => (
    <div>
      Order proof {props.role} {props.initialOrderId} {String(props.evidenceOnly)}
    </div>
  ),
}));
vi.mock('./IngredientEvidencePage', () => ({
  IngredientEvidence: (props: any) => (
    <div>
      Ingredient review {props.requestId} {String(props.hideComposer)}
    </div>
  ),
}));
vi.mock('../../../production-flow/CompanyIdentityProofAction', () => ({
  CompanyIdentityProofAction: (props: any) => (
    <button>
      Company preview {props.role} {props.requestId}
    </button>
  ),
}));
import { ManufacturerInformationRequests } from './ManufacturerInformationRequests';
import { workspaceNavigation } from '../../workspace-navigation';
import { workspacePage, workspacePath } from '../../workspace-paths';
const actor = 'manufacturer';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listEvidenceRequests.mockResolvedValue({
    requests: [
      {
        requestId: 'ingredient-request',
        supplier: 'supplier',
        supplierName: 'Supplier A',
        ingredientBatchId: 'batch',
        dueAt: 2000000000,
        status: 2,
      },
    ],
  });
  mocks.getCompanyIdentityProofStatus.mockResolvedValue({
    status: 'REQUESTED',
    purpose: 'Check ingredient requester',
    expiresAt: 2000000000,
  });
  mocks.getOrders.mockResolvedValue({
    actor,
    orders: [
      {
        orderId: 'order-request',
        buyer: actor,
        seller: 'supplier',
        sellerName: 'Supplier B',
        identityChallenge: '0x12',
      },
    ],
  });
  mocks.orderIdentity.mockResolvedValue({
    status: 'REQUESTED',
    purpose: 'Check quantity requester',
    expiresAt: 2000000000,
  });
});
afterEach(cleanup);
describe('Manufacturer information request management', () => {
  it('keeps ingredient reviews separate from both received company-proof contexts', async () => {
    render(
      <MemoryRouter>
        <ManufacturerInformationRequests />
      </MemoryRouter>,
    );
    await screen.findByText('Ingredient evidence');
    expect(screen.queryByText('Check quantity requester')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View request' }));
    expect(screen.getByText('Ingredient review ingredient-request true')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Information requests' }));
    await waitFor(() => expect(screen.queryByText('Loading information requests…')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Received requests' }));
    await screen.findByText('Check quantity requester');
    expect(screen.getByText('Check ingredient requester')).toBeTruthy();
    expect(screen.queryByText('Ingredient evidence')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'View request' })[0]);
    expect(
      screen.getByRole('button', { name: 'Company preview manufacturer ingredient-request' }),
    ).toBeTruthy();
    expect(mocks.orderIdentity.mock.calls.every(([, input]) => input.action === 'status')).toBe(
      true,
    );
  });
  it('opens a quantity-linked proof with Manufacturer identity and preserves its request binding', async () => {
    render(
      <MemoryRouter>
        <ManufacturerInformationRequests
          initialOrderId="order-request"
          initialDirection="received"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Order proof manufacturer order-request true')).toBeTruthy();
    await waitFor(() => expect(mocks.getOrders).toHaveBeenCalled());
  });
  it('reports unavailable proof checks without fabricating a received request', async () => {
    mocks.getCompanyIdentityProofStatus.mockRejectedValue(new Error('RPC unavailable'));
    mocks.getOrders.mockRejectedValue(new Error('Ledger unavailable'));
    render(
      <MemoryRouter>
        <ManufacturerInformationRequests initialDirection="received" />
      </MemoryRouter>,
    );
    await screen.findByText(/Some company proof statuses are unavailable/);
    expect(screen.queryByRole('button', { name: 'View request' })).toBeNull();
    expect(screen.getByText(/No received information requests/)).toBeTruthy();
  });
  it('replaces Manufacturer Browse navigation and keeps old evidence links usable', () => {
    const labels = workspaceNavigation.manufacturer.map(([, label]) => label);
    expect(labels).toContain('Products');
    expect(labels).toContain('My orders');
    expect(labels).toContain('Information requests');
    expect(labels).not.toContain('Browse & requests');
    expect(workspacePage('manufacturer', 'ingredient-evidence')).toBe('requests');
    expect(workspacePath('manufacturer', 'evidence')).toBe('/manufacturer/information-requests');
  });
});
