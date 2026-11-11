// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getOrders: vi.fn(),
  prepareOrder: vi.fn(),
  orderIdentity: vi.fn(),
  getRecall: vi.fn(),
  prepareOrderEvidence: vi.fn(),
}));
vi.mock('./orders.api', () => api);
vi.mock('../production-flow/production-flow.transaction', () => ({
  submitProductionTransaction: vi.fn().mockResolvedValue({}),
}));
const holderProof = vi.hoisted(() => ({
  selective: vi.fn().mockResolvedValue('holder-selected-proof'),
}));
vi.mock('../didcomm/didcomm-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../didcomm/didcomm-agent')>()),
  getActiveMessagingAgent: () => ({ did: 'did:key:test-holder' }),
  createSelectiveCompanyIdentityPresentation: holderProof.selective,
}));
import { OrdersPage } from './OrdersPage';
const actor = '0x1000000000000000000000000000000000000001';
const state = {
  actor,
  role: 'MANUFACTURER',
  catalogue: [],
  orders: [],
  shipments: [],
  locations: [],
};
describe('browse and request-only UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getOrders.mockResolvedValue(state);
  });
  afterEach(cleanup);
  const order = {
    orderId: 'request',
    itemId: 'item',
    buyer: actor,
    seller: 'supplier',
    requested: '12',
    status: '1',
    expiresAt: '2000000000',
    details: { requestOnly: true, note: 'Please review' },
  };
  it('shows registered items in a grid with price and a detail view without publishing', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      catalogue: [
        {
          itemId: 'registered',
          name: 'Ingredient from chain records',
          seller: 'seller',
          kind: 1,
          unit: 'litre',
          active: true,
          price: '12.50',
          currency: 'MYR',
          batches: ['batch'],
          batchDetails: [
            { batchId: 'batch', status: '1', expiresAt: '2000000000', supplierAvailable: '500' },
          ],
          registeredBatch: true,
        },
      ],
    });
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    await screen.findByText('Ingredient from chain records');
    expect(screen.queryByRole('button', { name: 'Publish catalogue entry' })).toBeNull();
    expect(screen.getByText('MYR 12.50 / litre')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getByText(/Requests do not take payment/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Request ingredient details' }));
    expect(screen.getByLabelText('expiryDate disclosure requirement')).toBeTruthy();
    expect(screen.getByText('Request a quantity')).toBeTruthy();
    expect(api.prepareOrder).not.toHaveBeenCalled();
  });
  it('lets the holder choose optional company claims while keeping binding claims necessary', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      orders: [{ ...order, buyer: actor, seller: 'seller', identityRequired: true }],
    });
    api.orderIdentity.mockImplementation(async (_id, input) =>
      input.action === 'material'
        ? {
            format: 'COMPANY_IDENTITY_SD_JWT',
            sdJwt: 'authority-signed-selective-material',
            holderDid: 'did:key:test-holder',
            audience: 'supplier',
            challenge: 'challenge',
            expiresAt: '2000000000',
            requiredClaims: ['id', 'walletAddress', 'role'],
            claims: {
              id: 'did:ethr:company',
              walletAddress: actor,
              role: 'MANUFACTURER',
              companyName: 'Actual company',
              companyRegistrationNumber: 'PRIVATE-OPTIONAL',
            },
          }
        : { status: 'PRESENTED' },
    );
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    await screen.findByText(/No registered ingredients or products found/);
    fireEvent.click(screen.getByRole('button', { name: 'My requests' }));
    fireEvent.click(screen.getByRole('button', { name: 'View request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview requested Company Role VP' }));
    await screen.findByLabelText('Share companyName');
    expect(screen.queryByLabelText('Presentation key backup password')).toBeNull();
    expect(
      screen
        .getByRole('link', { name: 'Manage presentation signing in My company credential' })
        .getAttribute('href'),
    ).toBe('/manufacturer/credentials#presentation-signing');
    expect((screen.getByLabelText('Share role') as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText('Share companyRegistrationNumber') as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.click(screen.getByLabelText('Share companyName'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected claims & send proof' }));
    await waitFor(() =>
      expect(holderProof.selective).toHaveBeenCalledWith(
        expect.anything(),
        'authority-signed-selective-material',
        {
          audience: 'supplier',
          nonce: 'challenge',
          claims: ['id', 'walletAddress', 'role', 'companyName'],
        },
      ),
    );
  });

  it('does not expose fulfilment stages or require location setup', async () => {
    render(
      <MemoryRouter>
        <OrdersPage role="supplier" />
      </MemoryRouter>,
    );
    await screen.findByText('No requests for your wallet.');
    expect(screen.queryByText('Your workflow')).toBeNull();
    for (const name of [
      /reserve stock/i,
      /physical dispatch/i,
      /Finalize receipt/,
      /Register location/,
      /Recall & tracing/,
      /Propose & reserve/,
    ])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Browse items' })).toBeNull();
    expect(screen.getByText('No requests for your wallet.')).toBeTruthy();
    expect(api.prepareOrder).not.toHaveBeenCalled();
  });
  it('submits quantity interest without location, reservation or dispatch prerequisites', async () => {
    Object.defineProperty(window, 'ethereum', { configurable: true, value: { request: vi.fn() } });
    api.getOrders.mockResolvedValue({
      ...state,
      catalogue: [
        {
          itemId: 'item',
          name: 'Registered ingredient',
          seller: 'supplier',
          kind: 1,
          unit: 'g',
          active: true,
          batches: ['batch'],
          batchDetails: [],
        },
      ],
    });
    api.prepareOrder.mockResolvedValue({
      resultId: 'request',
      transaction: { chainId: 31337, to: actor, data: '0x1234', value: '0x0' },
    });
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    await screen.findByText('Registered ingredient');
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    fireEvent.click(screen.getByText('Request a quantity'));
    fireEvent.change(screen.getByLabelText(/Requested quantity/), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/Request deadline/), {
      target: { value: '2099-01-01T10:00' },
    });
    expect(screen.queryByLabelText('Receiving location')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findByText(/Request submitted. The recipient can review it/);
    expect(api.prepareOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'request',
        requestOnly: true,
        batchId: 'batch',
        kind: 1,
        quantity: '12',
        evidenceRequired: false,
      }),
    );
    expect(api.prepareOrder.mock.calls[0][0]).not.toHaveProperty('location');
  });
  it('allows a recipient to request company evidence before any physical process', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      orders: [{ ...order, seller: actor, buyer: 'buyer' }],
    });
    render(
      <MemoryRouter>
        <OrdersPage role="supplier" />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'View request' });
    fireEvent.click(screen.getByRole('button', { name: 'View request' }));
    expect(screen.getByRole('button', { name: 'Request company evidence' })).toBeTruthy();
    expect(screen.queryByLabelText('Dispatch quantity')).toBeNull();
    expect(screen.queryByLabelText('Allocation quantity')).toBeNull();
    expect(screen.getByText(/This request does not reserve stock/)).toBeTruthy();
    expect(api.prepareOrder).not.toHaveBeenCalled();
  });
  it('shows errors without inserting sample items', async () => {
    api.getOrders.mockRejectedValue(new Error('Service unavailable'));
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    await screen.findByText('Service unavailable');
    expect(screen.queryByRole('button', { name: 'View details' })).toBeNull();
  });
});
