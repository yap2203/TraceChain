// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getOrders: vi.fn(),
  prepareOrder: vi.fn(),
  orderIdentity: vi.fn(),
  listEvidenceRequests: vi.fn(),
  getCompanyIdentityProofStatus: vi.fn(),
  imageFilePayload: vi.fn(),
  uploadIngredientCatalogueImage: vi.fn(),
}));
vi.mock('../../orders/orders.api', () => api);
vi.mock('../../production-flow/production-flow.api', async (original) => ({
  ...(await original<typeof import('../../production-flow/production-flow.api')>()),
  listEvidenceRequests: api.listEvidenceRequests,
  getCompanyIdentityProofStatus: api.getCompanyIdentityProofStatus,
}));
vi.mock('../../production-flow/production-flow.transaction', () => ({
  submitProductionTransaction: vi.fn().mockResolvedValue({}),
}));
import { IngredientBatches } from './batches/IngredientBatchesPage';
import { InformationRequests } from './evidence/InformationRequestsPage';
import { OrdersPage } from '../../orders/OrdersPage';
import { workspaceNavigation } from '../workspace-navigation';
const actor = '0x2000000000000000000000000000000000000002',
  buyer = '0x3000000000000000000000000000000000000003';
const batchId = '0x' + '11'.repeat(32);
const item = {
  itemId: 'item',
  kind: 1,
  seller: actor,
  name: 'Supplier cocoa',
  category: 'cocoa',
  batchReference: 'COCOA-1',
  unit: 'g',
  price: '12.50',
  currency: 'MYR',
  listingSupported: true,
  listingHash: '0x' + '0'.repeat(64),
  batches: [batchId],
  batchDetails: [{ batchId, status: 1, expiresAt: 2000000000, supplierAvailable: '100' }],
};
const order = {
  orderId: 'order',
  itemId: 'item',
  seller: actor,
  buyer,
  buyerName: 'Manufacturer One',
  requested: '12',
  expiresAt: 2000000000,
  status: '1',
  isRequestOnly: true,
  decision: { status: '0' },
  details: { requestOnly: true, note: 'For our next production run' },
};
const state = {
  actor,
  role: 'SUPPLIER',
  catalogue: [item],
  orders: [order],
  locations: [],
  shipments: [],
};
function mount(element: React.ReactNode) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  api.getOrders.mockResolvedValue(state);
  api.prepareOrder.mockResolvedValue({
    transaction: { chainId: 31337, to: actor, data: '0x1234', value: '0x0' },
  });
  api.listEvidenceRequests.mockResolvedValue({ requests: [] });
  api.getCompanyIdentityProofStatus.mockResolvedValue({ status: 'NOT_REQUESTED' });
  api.imageFilePayload.mockResolvedValue({
    data: 'safe-image',
    fileName: 'ingredient.png',
    mimeType: 'image/png',
  });
  api.uploadIngredientCatalogueImage.mockResolvedValue({
    image: { path: `/catalogue/ingredients/${batchId}/image` },
  });
  api.orderIdentity.mockResolvedValue({
    status: 'REQUESTED',
    purpose: 'Confirm requester company',
    expiresAt: 2000000000,
  });
});
afterEach(cleanup);
describe('Supplier ingredient and request management', () => {
  it('labels the Supplier navigation as Order requests', () => {
    expect(workspaceNavigation.supplier.find(([id]) => id === 'orders')?.[1]).toBe(
      'Order requests',
    );
  });
  it('edits only listing fields and requires confirmation before archiving', async () => {
    mount(<IngredientBatches onNew={vi.fn()} />);
    await screen.findByText('Supplier cocoa');
    fireEvent.click(screen.getByRole('button', { name: 'Edit listing' }));
    fireEvent.change(screen.getByLabelText(/Listing name/), {
      target: { value: 'Supplier cocoa listing' },
    });
    fireEvent.change(screen.getByLabelText(/Price per/), { target: { value: '15.25' } });
    expect(screen.queryByLabelText(/Origin/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save listing' }));
    await waitFor(() =>
      expect(api.prepareOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ingredient-update',
          batchId,
          name: 'Supplier cocoa listing',
          price: '15.25',
          expectedHash: item.listingHash,
        }),
      ),
    );
    await screen.findByText(/Listing updated successfully/);
    api.prepareOrder.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(api.prepareOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
    await waitFor(() =>
      expect(api.prepareOrder).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ingredient-archive', batchId, archived: true }),
      ),
    );
  });
  it('uploads an optional Supplier-owned catalogue image without changing credential fields', async () => {
    mount(<IngredientBatches onNew={vi.fn()} />);
    await screen.findByText('Supplier cocoa');
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    const file = new File(['image'], 'ingredient.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose ingredient image'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    await waitFor(() =>
      expect(api.uploadIngredientCatalogueImage).toHaveBeenCalledWith(batchId, {
        data: 'safe-image',
        fileName: 'ingredient.png',
        mimeType: 'image/png',
      }),
    );
    expect(api.prepareOrder).not.toHaveBeenCalled();
    expect(screen.getByText(/Credential claims and batch history are unchanged/)).toBeTruthy();
  });
  it('shows archived ingredients only on request and offers restore', async () => {
    api.getOrders.mockResolvedValue({ ...state, catalogue: [{ ...item, archived: true }] });
    mount(<IngredientBatches onNew={vi.fn()} />);
    await screen.findByText('No batches match these filters');
    fireEvent.click(screen.getByLabelText('Show archived'));
    expect(screen.getByText('Supplier cocoa')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(api.prepareOrder).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ingredient-archive', batchId, archived: false }),
      ),
    );
  });
  it('shows requests as responsive cards and separates approval from stock or evidence', async () => {
    mount(<OrdersPage role="supplier" />);
    await screen.findAllByText('Manufacturer One');
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.querySelector('.supplier-requests-list')).toBeTruthy();
    expect(document.querySelector('.supplier-request-row.supplier-request-card')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Browse items' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Review request' })[0]);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(screen.getByText(/For our next production run/)).toBeTruthy();
    const technical = within(dialog).getByText('Technical details').closest('details');
    expect(technical?.open).toBe(false);
    expect(within(technical as HTMLElement).getByText('Request ID')).toBeTruthy();
    expect(within(technical as HTMLElement).getByText('Requester wallet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request company evidence' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /payment|checkout|cart|dispatch|reserve stock/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(
      (screen.getByRole('button', { name: 'Confirm rejection' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(api.prepareOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await waitFor(() =>
      expect(api.prepareOrder).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'decide-request', orderId: 'order', decision: 1 }),
      ),
    );
  });
  it('prevents duplicate decision submission while preparation is active', async () => {
    api.prepareOrder.mockImplementation(() => new Promise(() => undefined));
    mount(<OrdersPage role="supplier" />);
    await screen.findAllByRole('button', { name: 'Review request' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Review request' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const confirm = screen.getByRole('button', { name: 'Confirm approval' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(api.prepareOrder).toHaveBeenCalledTimes(1);
  });
  it('shows a clear RPC-unavailable state without inserting requests', async () => {
    api.getOrders.mockRejectedValue(new Error('RPC provider unavailable'));
    mount(<OrdersPage role="supplier" />);
    await screen.findByText(
      'Blockchain/RPC unavailable. Try again when the configured network is reachable.',
    );
    expect(screen.queryByRole('button', { name: 'Review request' })).toBeNull();
  });
  it('keeps received ingredient requests and sent company proofs in separate tables', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      orders: [{ ...order, identityChallenge: '0x' + '22'.repeat(32) }],
    });
    api.listEvidenceRequests.mockResolvedValue({
      requests: [
        {
          requestId: 'incoming',
          requester: buyer,
          requesterName: 'Incoming company',
          dueAt: 2000000000,
          status: 1,
        },
      ],
    });
    const respond = vi.fn();
    mount(<InformationRequests onRespond={respond} />);
    await screen.findByText('Incoming company');
    expect(screen.getByRole('columnheader', { name: 'From company' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sent requests' }));
    expect(screen.getByRole('columnheader', { name: 'To company' })).toBeTruthy();
    expect(screen.getByText('Manufacturer One')).toBeTruthy();
    expect(screen.queryByText('Incoming company')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View evidence request' }));
    await screen.findByRole('button', { name: 'Request company identity proof' });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
