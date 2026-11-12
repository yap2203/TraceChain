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
  it('shows catalogue skeleton cards while authoritative data loads', () => {
    api.getOrders.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status', { name: 'Loading catalogue' })).toBeTruthy();
    expect(container.querySelectorAll('.catalogue-skeleton')).toHaveLength(4);
  });
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
    expect(screen.getByText(/does not independently prove physical quality/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Request evidence or information' }));
    expect(screen.getByLabelText('expiryDate disclosure')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request quantity' })).toBeTruthy();
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
    await screen.findByText('No registered items');
    fireEvent.click(screen.getByRole('button', { name: 'My requests' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'View request' })[0]);
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
    await screen.findByText('No incoming requests');
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
    expect(screen.getByText('No incoming requests')).toBeTruthy();
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
    fireEvent.click(screen.getAllByRole('button', { name: 'Request quantity' })[1]);
    fireEvent.change(screen.getByLabelText(/Requested quantity/), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/Response deadline/), {
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
    await screen.findAllByRole('button', { name: 'View request' });
    fireEvent.click(screen.getAllByRole('button', { name: 'View request' })[0]);
    expect(screen.getByRole('button', { name: 'Request company evidence' })).toBeTruthy();
    expect(screen.queryByLabelText('Dispatch quantity')).toBeNull();
    expect(screen.queryByLabelText('Allocation quantity')).toBeNull();
    expect(screen.getByText(/This request does not reserve stock/)).toBeTruthy();
    expect(api.prepareOrder).not.toHaveBeenCalled();
  });
  it('searches, filters and clears a mixed responsive catalogue without commerce controls', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      catalogue: [
        {
          itemId: 'cocoa',
          name: 'Single Origin Fermented Cocoa Beans With A Deliberately Long Catalogue Name',
          seller: 'supplier-a',
          sellerName: 'Sabah Cocoa Cooperative',
          category: 'Cocoa',
          countryOfOrigin: 'Malaysia',
          kind: 1,
          unit: 'kg',
          active: true,
          credentialStatus: 1,
          registeredBlock: 10,
          batches: ['batch-a'],
          batchDetails: [{ status: 1, expiresAt: 2000000000, supplierAvailable: '20' }],
        },
        {
          itemId: 'oil',
          name: 'Refined Sunflower Oil',
          seller: 'supplier-b',
          sellerName: 'Eastern Oils Sdn. Bhd.',
          category: 'Oil',
          countryOfOrigin: 'Thailand',
          kind: 1,
          unit: 'litre',
          active: false,
          credentialStatus: 0,
          registeredBlock: 20,
          batches: ['batch-b'],
          batchDetails: [{ status: 2, expiresAt: 2000000000, supplierAvailable: '0' }],
        },
      ],
    });
    const { container } = render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    await screen.findByText(/Single Origin Fermented Cocoa Beans/);
    expect(container.querySelector('.catalogue-grid')).toBeTruthy();
    expect(screen.getByLabelText('Cocoa image placeholder')).toBeTruthy();
    expect(screen.getByLabelText('Sabah Cocoa Cooperative initials')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cart|checkout|buy|pay/i })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search catalogue'), {
      target: { value: 'sunflower' },
    });
    expect(screen.queryByText(/Single Origin Fermented Cocoa Beans/)).toBeNull();
    expect(screen.getByText('Refined Sunflower Oil')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Credential status'), {
      target: { value: 'active' },
    });
    expect(screen.getByText('No items match these filters')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(screen.getByText(/Single Origin Fermented Cocoa Beans/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'newest' } });
    expect(container.querySelector('.catalogue-card h4')?.textContent).toBe(
      'Refined Sunflower Oil',
    );
  });
  it('keeps invalid quantity requests disabled and presents desktop and mobile request views', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      catalogue: [
        {
          itemId: 'item',
          name: 'Registered ingredient',
          seller: 'supplier',
          sellerName: 'Supplier Company',
          kind: 1,
          unit: 'g',
          active: true,
          batches: ['batch'],
          batchDetails: [{ status: 1, expiresAt: '2000000000', supplierAvailable: '50' }],
        },
      ],
      orders: [{ ...order, sellerName: 'Supplier Company' }],
    });
    const { container } = render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    await screen.findByText('Registered ingredient');
    fireEvent.click(screen.getByRole('button', { name: 'Request quantity' }));
    const submit = screen.getByRole('button', { name: 'Submit request' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Requested quantity/), { target: { value: '0' } });
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Close dialog'));
    fireEvent.click(screen.getByRole('button', { name: 'My requests' }));
    expect(container.querySelector('.requests-desktop')).toBeTruthy();
    expect(container.querySelector('.requests-mobile')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'View request' })).toHaveLength(2);
  });
  it('prevents a duplicate quantity submission while preparation is active', async () => {
    Object.defineProperty(window, 'ethereum', { configurable: true, value: { request: vi.fn() } });
    api.getOrders.mockResolvedValue({
      ...state,
      catalogue: [
        {
          itemId: 'item',
          name: 'Duplicate-safe ingredient',
          seller: 'supplier',
          sellerName: 'Supplier Company',
          kind: 1,
          unit: 'kg',
          active: true,
          batches: ['batch'],
          batchDetails: [{ status: 1, expiresAt: 2000000000, supplierAvailable: '50' }],
        },
      ],
    });
    let resolvePreparation!: (value: any) => void;
    api.prepareOrder.mockImplementation(
      () => new Promise((resolve) => (resolvePreparation = resolve)),
    );
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    await screen.findByText('Duplicate-safe ingredient');
    fireEvent.click(screen.getByRole('button', { name: 'Request quantity' }));
    fireEvent.change(screen.getByLabelText(/Requested quantity/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Response deadline/), {
      target: { value: '2030-01-01T00:00' },
    });
    const submit = screen.getByRole('button', { name: 'Submit request' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.prepareOrder).toHaveBeenCalledTimes(1);
    resolvePreparation({
      resultId: 'request',
      transaction: { chainId: 31337, to: actor, data: '0x1234', value: '0x0' },
    });
    await screen.findByText(/Request submitted/);
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
