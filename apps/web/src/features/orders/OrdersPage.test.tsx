// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  locations: [{ company: actor, location: 'factory', label: 'My factory' }],
};
describe('browse and request-only UI', () => {
  it('requests summary pages first and fetches full detail only when a row is opened', async () => {
    const rows = [
      {
        orderId: 'summary-order',
        itemId: 'item',
        seller: actor,
        buyer: 'manufacturer',
        requested: '12',
        status: 1,
        expiresAt: '2000000000',
      },
    ];
    const summary = {
      ...state,
      orders: rows,
      catalogue: [{ itemId: 'item', name: 'Listed ingredient', unit: 'kg' }],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 41,
        counts: { all: 41, attention: 41, evidence: 0, approved: 0, closed: 0 },
      },
    };
    api.getOrders.mockImplementation(async (scope, options) =>
      scope === 'order-detail'
        ? {
            ...summary,
            pagination: undefined,
            orders: rows.map((row) => ({
              ...row,
              isRequestOnly: true,
              details: { note: 'Authorized private detail' },
            })),
          }
        : { ...summary, pagination: { ...summary.pagination, page: options?.page ?? 1 } },
    );
    render(
      <MemoryRouter>
        <OrdersPage role="supplier" />
      </MemoryRouter>,
    );
    await screen.findByText(/Page 1 of 3/);
    expect(api.getOrders.mock.calls[0][0]).toBe('order-list');
    expect(screen.queryByText('Authorized private detail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText(/Page 2 of 3/);
    expect(api.getOrders.mock.calls.at(-1)![1]).toMatchObject({ page: 2, direction: 'received' });
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    await screen.findByText('Private note: Authorized private detail');
    expect(api.getOrders.mock.calls.at(-1)).toEqual(['order-detail', { orderId: 'summary-order' }]);
  });
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
  const distributor = '0x2000000000000000000000000000000000000002';
  const shipmentId = `0x${'a'.repeat(64)}`;
  function manufacturerIngredientOrderState({
    withShipment = true,
    withEvidenceRequest = false,
  } = {}) {
    const detailedOrder = {
      ...order,
      sellerName: 'Rimba Cocoa Ingredients',
      buyerName: 'Melur Chocolate Works',
      requested: '4',
      requestedBatch: 'batch-cocoa',
      createdAt: '1794800000',
      decision: { status: 1, recordedAt: '1794800300' },
      identityChallenge: withEvidenceRequest ? '0x1234' : undefined,
      custodyOrder: {
        arranged: true,
        batchId: 'batch-cocoa',
        dispatched: withShipment ? '4' : '0',
        received: '0',
        distributor,
        location: 'warehouse-klang',
        receivingLocation: 'factory-shah-alam',
        warehouseName: 'Klang Food Warehouse',
        unit: 'kg',
        expectedAt: '1794900000',
      },
    };
    return {
      ...state,
      catalogue: [
        {
          itemId: 'item',
          name: 'Unsweetened Cocoa Powder',
          batchReference: 'COCOA-2026-012',
          category: 'Cocoa',
          kind: 1,
          unit: 'kg',
          batches: ['batch-cocoa'],
          batchDetails: [{ batchId: 'batch-cocoa', status: 1 }],
        },
      ],
      companies: [
        { wallet: 'supplier', companyName: 'Rimba Cocoa Ingredients', role: 'SUPPLIER' },
        { wallet: distributor, companyName: 'Bayu Food Logistics', role: 'DISTRIBUTOR' },
        { wallet: actor, companyName: 'Melur Chocolate Works', role: 'MANUFACTURER' },
      ],
      locations: [
        { company: distributor, location: 'warehouse-klang', label: 'Klang Food Warehouse' },
        { company: actor, location: 'factory-shah-alam', label: 'Shah Alam Chocolate Plant' },
      ],
      orders: [detailedOrder],
      logistics: {
        warehouses: [
          {
            distributor,
            location: 'warehouse-klang',
            name: 'Klang Food Warehouse',
          },
        ],
        positions: [],
        productStock: [],
        shipments: withShipment
          ? [
              {
                shipmentId,
                orderId: 'request',
                batchId: 'batch-cocoa',
                sender: distributor,
                recipient: actor,
                fromLocation: 'warehouse-klang',
                toLocation: 'factory-shah-alam',
                quantity: '4',
                received: '0',
                unit: 'kg',
                vehicle: 'WC 1233',
                dispatchedAt: '1794800500',
                expectedAt: '1794900000',
                status: 1,
              },
            ]
          : [],
      },
    };
  }
  it('shows the shared catalogue skeleton while authoritative data loads', () => {
    api.getOrders.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status', { name: 'Loading catalogue' })).toBeTruthy();
    expect(container.querySelector('.page-skeleton--cards .page-skeleton__item')).toBeTruthy();
  });
  it('uses the compact Supplier ingredients route heading and filter state', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      catalogue: [
        {
          itemId: 'registered',
          name: 'Cocoa powder',
          seller: 'supplier',
          kind: 1,
          unit: 'kg',
          active: true,
          batches: ['batch'],
          batchDetails: [{ batchId: 'batch', supplierAvailable: '100' }],
          custodyPositions: [
            {
              positionId: 'position',
              batchId: 'batch',
              warehouseName: 'Warehouse A',
              distributorName: 'Distributor A',
              available: '40',
              orderable: true,
            },
          ],
        },
      ],
    });
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" mode="browse" />
      </MemoryRouter>,
    );

    await screen.findByText('Cocoa powder');
    expect(screen.getByRole('heading', { name: 'Supplier ingredients' })).toBeTruthy();
    expect(
      screen.getByText('Browse supplier ingredients, check stock, or request evidence.'),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Registered ingredients & products' })).toBeNull();
    expect(screen.getByText('1 ingredient')).toBeTruthy();
    const clear = screen.getByRole('button', { name: 'Clear filters' }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Search catalogue'), {
      target: { value: 'cocoa' },
    });
    expect(clear.disabled).toBe(false);
    fireEvent.click(clear);
    expect((screen.getByLabelText('Search catalogue') as HTMLInputElement).value).toBe('');
    expect(clear.disabled).toBe(true);
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
    const { container } = render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    await screen.findByText('Ingredient from chain records');
    expect(screen.queryByRole('button', { name: 'Publish catalogue entry' })).toBeNull();
    expect(screen.getByText('MYR 12.50 / litre')).toBeTruthy();
    expect(container.querySelector('.workspace-shell')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    // Details are a page now; no modal until a request form is opened.
    expect(container.querySelectorAll('.workspace-dialog__body')).toHaveLength(0);
    expect(container.querySelector('.catalogue-detail-page')).toBeTruthy();
    expect(container.querySelector('.catalogue-dialog-content')).toBeTruthy();
    expect(container.querySelector('.catalogue-dialog-hero')).toBeTruthy();
    expect(container.querySelector('.catalogue-stock-section')).toBeTruthy();
    expect(container.querySelector('.catalogue-batch-section')).toBeTruthy();
    expect(container.querySelector('.catalogue-credential-section')).toBeTruthy();
    expect(container.querySelectorAll('.catalogue-dialog-alert')).toHaveLength(0);
    expect(screen.getByText(/does not independently prove physical quality/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Request evidence or information' }));
    expect(container.querySelectorAll('.catalogue-dialog-alert')).toHaveLength(1);
    expect(container.querySelector('.catalogue-request-form')).toBeTruthy();
    expect(screen.getByLabelText('Ingredient expiry date disclosure')).toBeTruthy();
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
        <OrdersPage role="manufacturer" evidenceOnly initialOrderId={order.orderId} />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Preview requested Company Role VP' }),
    );
    expect(screen.queryByRole('navigation', { name: 'Order direction' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to requests' })).toBeNull();
    await screen.findByLabelText('Share companyName');
    expect(screen.queryByLabelText('Presentation key backup password')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Manage legacy presentation keys' }).getAttribute('href'),
    ).toBe('/manufacturer/credentials#legacy-presentation-signing');
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
  it('submits quantity interest with the owned receiving location and leaves delivery selection to the Supplier', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Request quantity' }));
    fireEvent.change(screen.getByLabelText(/Requested quantity/), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/Response deadline/), {
      target: { value: '2099-01-01T10:00' },
    });
    fireEvent.change(screen.getByLabelText(/Your receiving location/), {
      target: { value: 'factory' },
    });
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
    expect(api.prepareOrder.mock.calls[0][0].location).toBe('factory');
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
    await screen.findAllByRole('button', { name: 'View details' });
    fireEvent.click(screen.getAllByRole('button', { name: 'View details' })[0]);
    expect(await screen.findByRole('button', { name: 'Request company evidence' })).toBeTruthy();
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
    const longName = screen.getByText(
      'Single Origin Fermented Cocoa Beans With A Deliberately Long Catalogue Name',
    );
    const longNameCard = longName.closest('.catalogue-card');
    expect(longNameCard).toBeTruthy();
    fireEvent.click(
      within(longNameCard as HTMLElement).getByRole('button', { name: 'View details' }),
    );
    const dialog = document.querySelector('.catalogue-detail-page') as HTMLElement;
    expect(dialog.querySelector('.catalogue-dialog-hero')).toBeTruthy();
    expect(dialog.textContent).toContain(
      'Single Origin Fermented Cocoa Beans With A Deliberately Long Catalogue Name',
    );
    expect(dialog.textContent).toContain('Sabah Cocoa Cooperative');
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
    await screen.findAllByRole('button', { name: 'View details' });
    expect(container.querySelector('.requests-desktop')).toBeTruthy();
    expect(container.querySelector('.requests-mobile')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'View details' })).toHaveLength(2);
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
    fireEvent.change(screen.getByLabelText(/Your receiving location/), {
      target: { value: 'factory' },
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
    api.getOrders.mockRejectedValue(new Error('The order service is unavailable.'));
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" />
      </MemoryRouter>,
    );
    await screen.findByText('The order service is unavailable. Try again shortly.');
    expect(screen.queryByRole('button', { name: 'View details' })).toBeNull();
  });
  it('embeds Supplier ingredient details in Products without Browse or order tabs', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      catalogue: [
        {
          itemId: 'ingredient',
          name: 'Real ingredient',
          seller: 'supplier',
          sellerName: 'Supplier A',
          kind: 1,
          unit: 'kg',
          batches: ['batch'],
          custodyPositions: [
            {
              positionId: 'position',
              batchId: 'batch',
              warehouseName: 'Warehouse A',
              distributorName: 'Distributor A',
              available: '40',
              orderable: true,
            },
          ],
        },
        {
          itemId: 'product',
          name: 'Own finished product',
          seller: actor,
          kind: 2,
          batches: ['finished'],
        },
      ],
    });
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" mode="browse" initialBatchId="batch" />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Request evidence or information' });
    expect(screen.getByRole('button', { name: 'Request quantity' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Browse items' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'My requests' })).toBeNull();
    expect(screen.queryByText('Own finished product')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to catalogue' }));
    expect(screen.getByRole('searchbox', { name: 'Search catalogue' })).toBeTruthy();
    expect(screen.queryByText('Own finished product')).toBeNull();
    expect(api.prepareOrder).not.toHaveBeenCalled();
  });
  it('renders the compact Manufacturer ingredient order and shipment workflow without writes', async () => {
    api.getOrders.mockResolvedValue(
      manufacturerIngredientOrderState({ withShipment: true, withEvidenceRequest: true }),
    );
    const { container } = render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" mode="manage" initialOrderId="request" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Unsweetened Cocoa Powder' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Unsweetened Cocoa Powder' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Order request' })).toBeNull();
    expect(screen.getByRole('button', { name: /Ingredient requests to Suppliers/ })).toBeTruthy();
    expect(screen.getByText('Order and delivery details')).toBeTruthy();

    const progress = screen.getByRole('list', { name: 'Order progress' });
    for (const stage of ['Requested', 'Supplier review', 'Delivery', 'Received'])
      expect(within(progress).getByText(stage)).toBeTruthy();
    expect(within(progress).getByText('Delivery').closest('li')?.getAttribute('aria-current')).toBe(
      'step',
    );

    expect(screen.getByLabelText('Cocoa image placeholder')).toBeTruthy();
    expect(screen.getAllByText('Rimba Cocoa Ingredients').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bayu Food Logistics').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4 kg').length).toBeGreaterThan(0);
    expect(screen.getByText('COCOA-2026-012')).toBeTruthy();
    const route = screen.getByRole('list', {
      name: 'Supplier to Manufacturer delivery route',
    });
    expect(route.classList.contains('workspace-status-timeline--route')).toBe(true);
    expect(within(route).getByText('Klang Food Warehouse')).toBeTruthy();
    expect(within(route).getByText('Shah Alam Chocolate Plant')).toBeTruthy();
    expect(screen.getByText('Awaiting presentation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Respond to evidence request' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open shipment & scan receipt' })).toBeTruthy();
    expect(screen.getByText('SHP-AAAAAAAA')).toBeTruthy();
    expect(screen.getByText('Technical details').closest('details')?.open).toBe(false);
    expect(container.querySelector('.manufacturer-order-detail__columns')).toBeTruthy();
    expect(api.prepareOrder).not.toHaveBeenCalled();
  });
  it('shows a clear waiting state until the Distributor creates a shipment', async () => {
    api.getOrders.mockResolvedValue(manufacturerIngredientOrderState({ withShipment: false }));
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" mode="manage" initialOrderId="request" />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Bayu Food Logistics will dispatch the reserved warehouse stock.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Waiting for the Distributor to dispatch the reserved stock.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open shipment & scan receipt' })).toBeNull();
    expect(screen.getByText('Not requested')).toBeTruthy();
    expect(api.prepareOrder).not.toHaveBeenCalled();
  });
  it('separates Manufacturer sent and received orders and exposes seller decisions', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      catalogue: [{ itemId: 'item', name: 'Registered item', unit: 'kg' }],
      orders: [
        { ...order, orderId: 'sent-order', sellerName: 'Supplier A' },
        {
          ...order,
          orderId: 'incoming',
          seller: actor,
          buyer: 'retailer',
          buyerName: 'Retailer A',
          isRequestOnly: true,
          decision: { status: 0 },
        },
      ],
    });
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" mode="manage" />
      </MemoryRouter>,
    );
    await screen.findAllByText('Supplier A');
    expect(screen.queryByText('Retailer A')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Browse items' })).toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Received from buyers' }));
    expect((await screen.findAllByText('Retailer A')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Supplier A')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'View details' })[0]);
    expect((await screen.findByRole('button', { name: 'Approve' })).hasAttribute('disabled')).toBe(
      false,
    );
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request company evidence' })).toBeTruthy();
    expect(api.prepareOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('button', { name: 'Confirm approval' })).toBeTruthy();
    expect(api.prepareOrder).not.toHaveBeenCalled();
  });
  it('does not credit approved ingredients until the Manufacturer explicitly confirms a receipt', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      approvedReceiptsSupported: true,
      catalogue: [{ itemId: 'item', name: 'Cocoa', kind: 1, unit: 'g' }],
      orders: [
        { ...order, decision: { status: 1 }, isRequestOnly: true, approvedReceivedQuantity: '0' },
      ],
      locations: [{ company: actor, location: 'factory', label: 'Factory' }],
    });
    api.prepareOrder.mockResolvedValue({
      transaction: { chainId: 31337, to: actor, data: '0x1234', value: '0x0' },
    });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: { request: vi.fn() } });
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" mode="manage" initialOrderId="request" />
      </MemoryRouter>,
    );
    await screen.findByText('Confirm ingredients received');
    expect(api.prepareOrder).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Receiving \/ production location/), {
      target: { value: 'factory' },
    });
    fireEvent.change(screen.getByLabelText(/Quantity received/), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/Actual receipt date and time/), {
      target: { value: '2026-01-01T10:00:00' },
    });
    const confirm = screen.getByRole('button', { name: 'Confirm receipt with MetaMask' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText(/I confirm these ingredients physically arrived/));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.prepareOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'approved-receipt',
          orderId: 'request',
          location: 'factory',
          quantity: '12',
        }),
      ),
    );
  });
  it('shows why receipt is unavailable on an older deployment and hides unrelated company evidence controls', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      approvedReceiptsSupported: false,
      orders: [
        {
          ...order,
          decision: { status: 1, reason: 'Request approved' },
          identityChallenge: '0x0000',
        },
      ],
    });
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" mode="manage" initialOrderId="request" />
      </MemoryRouter>,
    );
    await screen.findByText('Supplier decision: Approved');
    expect(screen.getByText('Confirm ingredients received')).toBeTruthy();
    expect(
      screen.getByText(/Deploy the updated registry suite to enable receipt confirmation/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /company evidence request/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm receipt with MetaMask' })).toBeNull();
    expect(api.prepareOrder).not.toHaveBeenCalled();
  });
  it('keeps a confirmed approval separate from delivery arrangement, even during stale readback', async () => {
    api.getOrders.mockResolvedValue({
      ...state,
      productDeliverySupported: true,
      catalogue: [
        {
          itemId: 'item',
          name: 'Confirmed product',
          kind: 2,
          unit: 'each',
          batches: ['batch'],
          storageLocations: [],
        },
      ],
      orders: [
        {
          ...order,
          seller: actor,
          buyer: distributor,
          isRequestOnly: true,
          decision: { status: 0 },
          productDelivery: { stage: 0 },
          deliveryReceivingLocation: 'shop',
        },
      ],
    });
    api.prepareOrder.mockResolvedValue({
      transaction: { chainId: 31337, to: actor, data: '0x1234', value: '0x0' },
    });
    render(
      <MemoryRouter>
        <OrdersPage role="manufacturer" mode="manage" initialOrderId="request" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(
      await screen.findByRole('button', { name: 'Request Distributor delivery' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(api.prepareOrder).toHaveBeenCalledTimes(1);
    expect(api.prepareOrder.mock.calls[0][0].action).toBe('decide-request');
  });
});
