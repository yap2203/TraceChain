// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeShipmentQr } from '@tracechain/shared';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  prepare: vi.fn(),
  sign: vi.fn(),
  image: vi.fn(),
  camera: vi.fn(),
  offers: vi.fn(),
  media: vi.fn(),
}));
vi.mock('../custody-transfers/qr-reader', () => ({
  ZxingTransferQrReader: class {
    decodeImage(file: File) {
      return mocks.image(file);
    }
    startCamera(...args: unknown[]) {
      return mocks.camera(...args);
    }
  },
  cameraErrorMessage: (cause: Error) => cause.message,
  qrImageErrorMessage: (cause: Error) => cause.message,
}));
vi.mock('./orders.api', () => ({
  CatalogueMediaError: class CatalogueMediaError extends Error {
    reason = 'missing';
  },
  deliveryIdentity: vi.fn(),
  fetchCatalogueMedia: mocks.media,
  getOrders: mocks.get,
  getCustodyOffers: mocks.offers,
  prepareLogistics: mocks.prepare,
  prepareOrder: mocks.prepare,
}));
vi.mock('../production-flow/production-flow.transaction', () => ({
  submitProductionTransaction: mocks.sign,
}));
vi.mock('../product-traceability/ProductQrDisplay', () => ({
  ProductQrDisplay: () => <p>Print shipment label</p>,
}));
vi.mock('./DeliveryIdentityPanel', () => ({
  DeliveryIdentityPanel: () => <p>Optional Supplier company evidence</p>,
}));
import { ShipmentsWorkspace } from './ShipmentsWorkspace';
import type { OrdersState } from './orders.api';
const supplier = '0x2000000000000000000000000000000000000002',
  carrier = '0x3000000000000000000000000000000000000003';
const hash = (digit: string) => '0x' + digit.repeat(64);
const batchId = hash('1'),
  shipmentId = hash('2'),
  location = hash('3'),
  source = hash('4');
const ordersAddress = '0x1000000000000000000000000000000000000001';
const now = Math.floor(Date.now() / 1000);
const state: OrdersState = {
  actor: carrier,
  role: 'DISTRIBUTOR',
  chainId: 31337,
  ordersAddress,
  warehouseSupported: true,
  shipmentReviewSupported: true,
  catalogue: [
    {
      itemId: hash('5'),
      name: 'Actual flour',
      kind: 1,
      unit: 'kg',
      seller: supplier,
      batches: [batchId],
      batchDetails: [{ batchId, supplierAvailable: '100' }],
    },
  ],
  orders: [],
  shipments: [],
  locations: [
    { company: supplier, location: source, label: 'Supplier dispatch' },
    { company: carrier, location, label: 'Warehouse A' },
  ],
  logistics: {
    warehouses: [{ location, name: 'Warehouse A', distributor: carrier }],
    positions: [
      {
        positionId: hash('6'),
        batchId,
        supplier,
        distributor: carrier,
        location,
        quantity: '70',
        reserved: '20',
        available: '50',
        unit: 'kg',
        warehouseName: 'Warehouse A',
      },
    ],
    productStock: [],
    shipments: [
      {
        shipmentId,
        batchId,
        sender: supplier,
        recipient: carrier,
        senderName: 'Actual Supplier Company',
        recipientName: 'Actual Distributor Company',
        itemName: 'Actual flour',
        kind: 'ingredient',
        leg: 1,
        custodyDecision: 1,
        status: 1,
        quantity: '100',
        received: '0',
        unit: 'kg',
        vehicle: 'VAB 1234',
        fromLocation: source,
        toLocation: location,
        dispatchedAt: now - 120,
        recordedAt: now - 100,
        expectedAt: now + 3600,
        confirmedBy: supplier,
      },
    ],
  },
};
const manufacturer = '0x4000000000000000000000000000000000000004';
const manufacturerLocation = hash('7');

function arrangedDeliveryState() {
  const next = structuredClone(state);
  next.catalogue[0].batchReference = 'FLOUR-2026-001';
  next.locations.push({
    company: manufacturer,
    location: manufacturerLocation,
    label: 'Manufacturer receiving dock',
  });
  next.orders = [
    {
      orderId: hash('a'),
      itemId: hash('5'),
      seller: supplier,
      sellerName: 'Actual Supplier Company',
      buyer: manufacturer,
      buyerName: 'Actual Manufacturer Company',
      requested: '10',
      status: 1,
      expiresAt: now + 86_400,
      decision: { status: 1 },
      custodyOrder: {
        arranged: true,
        arrangedAt: now - 300,
        batchId,
        dispatched: '0',
        distributor: carrier,
        expectedAt: now + 7_200,
        location,
        pickupAt: now - 60,
        receivingLocation: manufacturerLocation,
        unit: 'kg',
        vehicle: 'WXY 7788',
        warehouseName: 'Warehouse A',
      },
    },
  ];
  return next;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_PUBLIC_APP_URL', 'http://localhost:5173');
  mocks.get.mockResolvedValue(structuredClone(state));
  mocks.offers.mockResolvedValue({ offers: [] });
  mocks.prepare.mockResolvedValue({
    resultId: shipmentId,
    transaction: { chainId: 31337, to: ordersAddress, data: '0x', value: '0x0' },
  });
  mocks.sign.mockResolvedValue(undefined);
  mocks.media.mockRejectedValue(new Error('missing'));
  const qr = encodeShipmentQr({
    shipmentId: shipmentId as `0x${string}`,
    kind: 'ingredient',
    chainId: 31337,
    ordersAddress,
    publicAppUrl: 'http://localhost:5173',
  });
  mocks.image.mockResolvedValue(qr);
  mocks.camera.mockImplementation((_video, onScan) => {
    onScan(qr);
    return Promise.resolve(() => {});
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('unified warehouse shipments', () => {
  it('verifies a receipt landing QR without a public URL setting and never auto-confirms receipt', async () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', undefined);
    const qr = encodeShipmentQr({
      shipmentId: shipmentId as `0x${string}`,
      kind: 'ingredient',
      chainId: 31337,
      ordersAddress,
      publicAppUrl: window.location.origin,
    });
    render(
      <ShipmentsWorkspace
        role="distributor"
        section="intake"
        initialShipmentId={shipmentId}
        initialQr={qr}
      />,
    );
    expect(await screen.findByText('Shipment QR verified successfully.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Confirm receipt with MetaMask' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('renders the responsive custody-intake hierarchy with live names and a safe image fallback', async () => {
    render(
      <ShipmentsWorkspace role="distributor" section="intake" initialShipmentId={shipmentId} />,
    );

    expect(await screen.findByRole('heading', { name: 'Custody Intake' })).toBeTruthy();
    expect(screen.getByText('Review shipment details and confirm warehouse receipt.')).toBeTruthy();
    const progress = screen.getByRole('list', { name: 'Shipment progress' });
    expect(within(progress).getAllByRole('listitem')).toHaveLength(4);
    for (const stage of ['Dispatched', 'In Transit', 'Arrived', 'Received'])
      expect(within(progress).getByText(stage)).toBeTruthy();
    expect(screen.getByText('Actual flour')).toBeTruthy();
    expect(screen.getByText('Actual Supplier Company')).toBeTruthy();
    expect(screen.getByText('Actual Distributor Company')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Ingredient image placeholder' })).toBeTruthy();
    expect(document.querySelector('.workspace-arrival-detail__columns')).toBeTruthy();

    const confirm = screen.getByRole('button', { name: 'Confirm receipt with MetaMask' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    const technical = screen.getByText('Technical details').closest('details');
    expect(technical?.open).toBe(false);
  });

  it('shows the authenticated ingredient image when catalogue media is available', async () => {
    const next = structuredClone(state);
    next.catalogue[0].imagePath = '/catalogue/ingredients/actual/image';
    mocks.get.mockResolvedValue(next);
    mocks.media.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ingredient');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    render(
      <ShipmentsWorkspace role="distributor" section="intake" initialShipmentId={shipmentId} />,
    );

    const image = await screen.findByRole('img', { name: 'Actual flour' });
    expect(image.getAttribute('src')).toBe('blob:ingredient');
    expect(mocks.media).toHaveBeenCalledWith('/catalogue/ingredients/actual/image');
  });
  it('uses the accepted custody offer and requires scanning before both chain receipt confirmations', async () => {
    const next = structuredClone(state);
    next.logistics!.shipments[0].custodyDecision = 0;
    mocks.get.mockResolvedValue(next);
    mocks.offers.mockResolvedValue({
      offers: [
        {
          offerId: hash('a'),
          shipmentId,
          sender: supplier,
          distributor: carrier,
          status: 'DISPATCHED',
        },
      ],
    });
    render(
      <ShipmentsWorkspace role="distributor" section="intake" initialShipmentId={shipmentId} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Scan package QR' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm receipt with MetaMask' });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Accept custody delivery' })).toBeNull();
    // Pre-filled with the quantity still expected; the receiver only corrects a difference.
    expect(
      (screen.getByLabelText('Quantity physically received (kg)') as HTMLInputElement).value,
    ).toBe('100');
    fireEvent.change(screen.getByLabelText('Quantity physically received (kg)'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByLabelText(/I physically received/));
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(2));
    expect(mocks.prepare.mock.calls.map(([input]) => input.action)).toEqual([
      'warehouse-decision',
      'shipment-receive',
    ]);
  });
  it('shows direct-carrier requests separately from custody intake and permits accept/reject', async () => {
    const next = structuredClone(state);
    next.logistics!.shipments = [];
    next.orders = [
      {
        orderId: hash('a'),
        itemId: hash('5'),
        seller: supplier,
        buyer: ordersAddress,
        requested: '10',
        approvedReceivedQuantity: '0',
        delivery: { stage: 2, distributor: carrier, assignmentDeadline: now + 3600 },
      },
    ];
    mocks.get.mockResolvedValue(next);
    render(<ShipmentsWorkspace role="distributor" />);
    expect(await screen.findByText('Direct delivery — collect from Supplier')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline delivery' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept custody delivery' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Accept delivery' }));
    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delivery-respond', orderId: hash('a'), accept: true }),
      ),
    );
  });
  it('offers Distributor acceptance, rejection and Supplier proof separately from scanned receipt', async () => {
    const next = structuredClone(state);
    next.logistics!.shipments[0].custodyDecision = 0;
    next.logistics!.shipments[0].delivery = { stage: 2, distributor: carrier };
    mocks.get.mockResolvedValue(next);
    render(<ShipmentsWorkspace role="distributor" initialShipmentId={shipmentId} />);
    expect(await screen.findByRole('button', { name: 'Accept custody delivery' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject custody delivery' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Manage Supplier credential request/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scan package QR' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reject custody delivery' }));
    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'warehouse-decision', shipmentId, decision: 2 }),
      ),
    );
  });
  it('unlocks receipt through camera scanning without exposing a manual QR input', async () => {
    render(<ShipmentsWorkspace role="distributor" initialShipmentId={shipmentId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scan package QR' }));
    expect(
      await screen.findByRole('button', { name: 'Confirm receipt with MetaMask' }),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Shipment QR link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check label' })).toBeNull();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('hides ingredient dispatch jobs until the Supplier arranges an approved order', async () => {
    const next = structuredClone(state);
    next.orders = [
      {
        orderId: hash('a'),
        requested: '10',
        status: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        decision: { status: 1 },
        custodyOrder: { distributor: carrier, dispatched: '0', arranged: false },
      },
    ];
    mocks.get.mockResolvedValue(next);
    render(<ShipmentsWorkspace role="distributor" />);
    await screen.findByText('Custody intake & deliveries');
    expect(screen.queryByRole('button', { name: 'Record physical dispatch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New transfer' })).toBeNull();
  });
  it('renders an actionable ingredient delivery card and requires review before dispatch', async () => {
    mocks.get.mockResolvedValue(arrangedDeliveryState());

    render(<ShipmentsWorkspace role="distributor" section="deliveries" initialKind="ingredient" />);

    expect(await screen.findByRole('heading', { name: 'Ingredient deliveries' })).toBeTruthy();
    expect(screen.getByText('Manage ingredient shipments to Manufacturers.')).toBeTruthy();
    const awaitingSummary = screen.getByRole('button', { name: /Awaiting dispatch\s*1/ });
    expect(awaitingSummary).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Ingredient delivery status' })).getByRole(
        'button',
        { name: /Needs action\s*1/ },
      ),
    ).toBeTruthy();
    expect(screen.getByText('Actual flour')).toBeTruthy();
    expect(screen.getAllByText(/Actual Supplier Company/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Actual Manufacturer Company').length).toBeGreaterThan(0);
    expect(screen.getByText(/FLOUR-2026-001/)).toBeTruthy();
    expect(screen.getByText('10 kg')).toBeTruthy();
    expect(screen.getByText('Manufacturer receiving dock')).toBeTruthy();
    expect(screen.getByText('WXY 7788')).toBeTruthy();
    expect(
      screen.getByText(/Review the reserved stock and route before recording physical dispatch/),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Ingredient image placeholder' })).toBeTruthy();
    // Journey: from the Distributor's warehouse to the Manufacturer's destination.
    const journey = screen.getByLabelText('Delivery journey');
    expect(journey.textContent).toContain('Your warehouse');
    expect(journey.textContent).toContain('Actual Manufacturer Company');
    expect(screen.queryByText('No matching shipments')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record physical dispatch' })).toBeNull();
    fireEvent.click(awaitingSummary);
    expect(awaitingSummary.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getAllByRole('button', { name: 'Review delivery' })[0]!);

    expect(await screen.findByRole('heading', { name: 'Ingredient delivery review' })).toBeTruthy();
    const progress = screen.getByRole('list', { name: 'Ingredient delivery progress' });
    for (const label of [
      'Delivery arranged',
      'Distributor dispatches',
      'In transit',
      'Manufacturer receives',
    ])
      expect(within(progress).getByText(label)).toBeTruthy();
    expect(
      screen.getByText(/Actual Supplier Company.*Warehouse A.*Actual Manufacturer Company/),
    ).toBeTruthy();
    expect(screen.getByText('Technical details').closest('details')?.open).toBe(false);
    expect(screen.getByText(/requires confirmation in MetaMask/)).toBeTruthy();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Record dispatch' }));
    expect(await screen.findByRole('heading', { name: 'Record ingredient dispatch' })).toBeTruthy();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('shows the authenticated ingredient image in a delivery card', async () => {
    const next = arrangedDeliveryState();
    next.catalogue[0].imagePath = '/catalogue/ingredients/actual/image';
    mocks.get.mockResolvedValue(next);
    mocks.media.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:delivery-ingredient');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    render(<ShipmentsWorkspace role="distributor" section="deliveries" initialKind="ingredient" />);

    const image = await screen.findByRole('img', { name: 'Actual flour presentation image' });
    expect(image.getAttribute('src')).toBe('blob:delivery-ingredient');
  });
  it('filters ingredient delivery records with summaries and status tabs', async () => {
    const next = arrangedDeliveryState();
    next.orders[0].custodyOrder.dispatched = '10';
    next.logistics!.shipments.push({
      shipmentId: hash('b'),
      orderId: hash('a'),
      batchId,
      sender: carrier,
      recipient: manufacturer,
      itemName: 'Actual flour',
      kind: 'ingredient',
      leg: 2,
      status: 1,
      quantity: '10',
      received: '0',
      unit: 'kg',
      vehicle: 'WXY 7788',
      fromLocation: location,
      toLocation: manufacturerLocation,
      dispatchedAt: now - 120,
      recordedAt: now - 100,
      expectedAt: now + 3_600,
    });
    mocks.get.mockResolvedValue(next);

    render(<ShipmentsWorkspace role="distributor" section="deliveries" initialKind="ingredient" />);

    // Summary card and filter chip share the name; both are buttons.
    expect((await screen.findAllByRole('button', { name: /In transit\s*1/ })).length).toBe(2);
    const tab = within(screen.getByRole('group', { name: 'Ingredient delivery status' })).getByRole(
      'button',
      { name: /In transit\s*1/ },
    );
    fireEvent.click(tab);
    expect(screen.getByText(/SHP-BBBBBBBB/)).toBeTruthy();
    expect(screen.getByText(/Track the shipment until it reaches the Manufacturer/)).toBeTruthy();

    expect(screen.queryByLabelText('Status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByLabelText('Status')).toBeTruthy();
    expect(screen.getByLabelText('Warehouse')).toBeTruthy();
    expect(screen.getByLabelText('Supplier')).toBeTruthy();
    expect(screen.getByLabelText('Manufacturer')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Manufacturer'), {
      target: { value: 'Actual Manufacturer Company' },
    });
    expect(screen.getByText(/SHP-BBBBBBBB/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search deliveries'), {
      target: { value: 'not-a-delivery' },
    });
    expect(await screen.findByText('No deliveries match your filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText(/SHP-BBBBBBBB/)).toBeTruthy();
  });
  it('opens the existing dispatch form from the card without signing automatically', async () => {
    mocks.get.mockResolvedValue(arrangedDeliveryState());
    render(<ShipmentsWorkspace role="distributor" section="deliveries" initialKind="ingredient" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Record dispatch' }));

    expect(await screen.findByRole('heading', { name: 'Record ingredient dispatch' })).toBeTruthy();
    const progress = screen.getByRole('list', { name: 'Ingredient dispatch progress' });
    for (const label of [
      'Delivery arranged',
      'Route confirmed',
      'Record dispatch',
      'Manufacturer receives',
    ])
      expect(within(progress).getByText(label)).toBeTruthy();
    expect(screen.getByText('Dispatch summary')).toBeTruthy();
    expect(screen.getByText('Road dispatch details')).toBeTruthy();
    expect(screen.getByText('Actual quantity dispatched (kg)')).toBeTruthy();
    const companyRoute = screen.getByRole('list', { name: 'Dispatch company route' });
    expect(companyRoute.classList.contains('workspace-status-timeline--route')).toBe(true);
    expect(companyRoute.querySelectorAll('li')).toHaveLength(3);
    for (const participant of ['Supplier', 'Distributor', 'Manufacturer'])
      expect(within(companyRoute).getByText(participant)).toBeTruthy();
    const routePanel = screen.getByRole('heading', { name: 'Dispatch route' }).closest('section')!;
    expect(within(routePanel).getByText('Warehouse A')).toBeTruthy();
    expect(within(routePanel).getByText('Manufacturer receiving dock')).toBeTruthy();
    expect(
      within(routePanel).getByRole('link', { name: /Manage Supplier credential request/ }),
    ).toBeTruthy();
    expect(
      within(routePanel).queryByRole('button', { name: 'Set up a missing location' }),
    ).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Confirm dispatch with MetaMask' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText('Technical details').closest('details')?.open).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('offers location setup only when the delivery route is incomplete', async () => {
    const next = arrangedDeliveryState();
    next.orders[0].custodyOrder.receivingLocation = '';
    mocks.get.mockResolvedValue(next);
    render(<ShipmentsWorkspace role="distributor" section="deliveries" initialKind="ingredient" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Record dispatch' }));

    const routePanel = (await screen.findByRole('heading', { name: 'Dispatch route' })).closest(
      'section',
    )!;
    expect(
      within(routePanel).getByRole('button', { name: 'Set up a missing location' }),
    ).toBeTruthy();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('uses safe timing and vehicle fallbacks on an unscheduled delivery', async () => {
    const next = arrangedDeliveryState();
    delete next.orders[0].custodyOrder.pickupAt;
    delete next.orders[0].custodyOrder.expectedAt;
    delete next.orders[0].custodyOrder.vehicle;
    mocks.get.mockResolvedValue(next);

    render(<ShipmentsWorkspace role="distributor" section="deliveries" initialKind="ingredient" />);

    expect(await screen.findByText('Pickup Not recorded')).toBeTruthy();
    expect(screen.getByText('Arrives Not recorded')).toBeTruthy();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.shipment-journey')).toBeTruthy();
  });
  it('shows the genuine ingredient-delivery empty state without a false shipment message', async () => {
    render(<ShipmentsWorkspace role="distributor" section="deliveries" initialKind="ingredient" />);

    expect(await screen.findByText('No ingredient deliveries yet.')).toBeTruthy();
    expect(
      screen.getByText('Approved and arranged Supplier orders will appear here.'),
    ).toBeTruthy();
    expect(screen.queryByText('No matching shipments')).toBeNull();
  });
  it('uses Supplier-specific tracking and no inbound acceptance controls', async () => {
    mocks.get.mockResolvedValue({ ...structuredClone(state), actor: supplier });
    render(<ShipmentsWorkspace role="supplier" initialShipmentId={shipmentId} />);
    expect(await screen.findByRole('heading', { name: 'Shipment Tracking' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept custody delivery' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scan package QR' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send stock to custody' })).toBeTruthy();
  });
  it.each(['', hash('9')])(
    'renders a Manufacturer transfer safely without matching product stock (%s)',
    async (initialBatchId) => {
      mocks.get.mockResolvedValue({
        ...structuredClone(state),
        actor: supplier,
        role: 'MANUFACTURER',
      });
      render(
        <ShipmentsWorkspace
          role="manufacturer"
          initialView="transfer"
          initialBatchId={initialBatchId}
        />,
      );
      const dispatch = await screen.findByRole('button', {
        name: 'Confirm dispatch with MetaMask',
      });
      expect((dispatch as HTMLButtonElement).disabled).toBe(true);
      const locations = screen.getByLabelText('Dispatch location') as HTMLSelectElement;
      expect(locations.options).toHaveLength(1);
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.sign).not.toHaveBeenCalled();
    },
  );
  it('renders safely when a Distributor switches to products before selecting stock', async () => {
    render(<ShipmentsWorkspace role="distributor" initialView="transfer" />);
    fireEvent.change(await screen.findByLabelText('Transfer type'), {
      target: { value: 'product' },
    });
    expect(
      (screen.getByRole('button', { name: 'Confirm dispatch with MetaMask' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((screen.getByLabelText('Dispatch location') as HTMLSelectElement).options).toHaveLength(
      1,
    );
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('keeps product dispatch behind a read-only shipment review', async () => {
    const next = structuredClone(state);
    next.orders = [
      {
        orderId: hash('a'),
        itemId: hash('5'),
        seller: supplier,
        sellerName: 'Actual Manufacturer',
        buyer: ordersAddress,
        buyerName: 'Actual Retailer',
        requested: '2',
        requestedBatch: batchId,
        deliveryReceivingLocation: location,
        productDelivery: { stage: 3, mode: 2, distributor: carrier },
      },
    ];
    next.catalogue[0].kind = 2;
    next.catalogue[0].batchReference = 'PRODUCT-001';
    next.catalogue[0].unit = 'each';
    next.catalogue[0].imagePath = '/catalogue/products/product-batch/image';
    mocks.get.mockResolvedValue(next);

    render(<ShipmentsWorkspace role="distributor" initialKind="product" />);

    const review = await screen.findByRole('button', { name: 'View shipment' });
    expect(screen.queryByText('No shipments yet')).toBeNull();
    await waitFor(() =>
      expect(mocks.media).toHaveBeenCalledWith('/catalogue/products/product-batch/image'),
    );
    expect(screen.queryByRole('button', { name: 'Confirm product pickup & dispatch' })).toBeNull();
    fireEvent.click(review);
    expect(
      await screen.findByRole('button', { name: 'Confirm product pickup & dispatch' }),
    ).toBeTruthy();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('keeps custody inventory outside shipment navigation', async () => {
    render(<ShipmentsWorkspace role="distributor" />);
    await screen.findByText('Custody intake & deliveries');
    expect(screen.queryByRole('button', { name: 'Custody inventory' })).toBeNull();
    expect(screen.queryByText(/In custody: 70 kg/)).toBeNull();
  });
  it('requires an exact shipment label and explicit physical receipt before signing', async () => {
    render(
      <ShipmentsWorkspace role="distributor" section="intake" initialShipmentId={shipmentId} />,
    );
    await screen.findByText('VAB 1234');
    expect(
      (
        screen.getByRole('button', {
          name: 'Confirm receipt with MetaMask',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByLabelText('Shipment QR link')).toBeNull();
    const qr = encodeShipmentQr({
      shipmentId: shipmentId as `0x${string}`,
      kind: 'ingredient',
      chainId: 31337,
      ordersAddress,
      publicAppUrl: 'http://localhost:5173',
    });
    fireEvent.change(screen.getByLabelText('Upload QR image'), {
      target: { files: [new File(['qr'], 'label.png', { type: 'image/png' })] },
    });
    const confirm = (await screen.findByRole('button', {
      name: 'Confirm receipt with MetaMask',
    })) as HTMLButtonElement;
    expect(screen.getByText('Shipment QR verified · label.png')).toBeTruthy();
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Quantity physically received (kg)'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByLabelText(/I physically received/));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'shipment-receive',
          quantity: '40',
          shipmentId,
          qrPayload: qr,
        }),
      ),
    );
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
  it('keeps receipt disabled when an initial label targets a different shipment', async () => {
    const qr = encodeShipmentQr({
      shipmentId: hash('7') as `0x${string}`,
      kind: 'ingredient',
      chainId: 31337,
      ordersAddress,
      publicAppUrl: 'http://localhost:5173',
    });
    render(<ShipmentsWorkspace role="distributor" initialShipmentId={shipmentId} initialQr={qr} />);
    await screen.findByRole('button', { name: 'Scan package QR' });
    expect(
      (screen.getByRole('button', { name: 'Confirm receipt with MetaMask' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('distinguishes an unreadable QR image from a readable label for another shipment', async () => {
    render(
      <ShipmentsWorkspace role="distributor" section="intake" initialShipmentId={shipmentId} />,
    );
    const upload = await screen.findByLabelText('Upload QR image');
    mocks.image.mockRejectedValueOnce(new Error('No QR code was detected in the selected image.'));
    fireEvent.change(upload, {
      target: { files: [new File(['bad'], 'unreadable.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('No QR code was detected in the selected image.')).toBeTruthy();

    mocks.image.mockResolvedValueOnce(
      encodeShipmentQr({
        shipmentId: hash('7') as `0x${string}`,
        kind: 'ingredient',
        chainId: 31337,
        ordersAddress,
        publicAppUrl: 'http://localhost:5173',
      }),
    );
    fireEvent.change(upload, {
      target: { files: [new File(['qr'], 'different.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('This QR belongs to a different shipment.')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Confirm receipt with MetaMask',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it.each([
    [
      'a readable non-TraceChain QR',
      'https://example.com/not-a-tracechain-label',
      'The selected QR is not a valid TraceChain shipment label.',
    ],
    [
      'a shipment QR for another chain',
      encodeShipmentQr({
        shipmentId: shipmentId as `0x${string}`,
        kind: 'ingredient',
        chainId: 11_155_111,
        ordersAddress,
        publicAppUrl: 'http://localhost:5173',
      }),
      'This shipment QR is for a different blockchain network.',
    ],
    [
      'a shipment QR for another contract',
      encodeShipmentQr({
        shipmentId: shipmentId as `0x${string}`,
        kind: 'ingredient',
        chainId: 31_337,
        ordersAddress: '0x2000000000000000000000000000000000000002',
        publicAppUrl: 'http://localhost:5173',
      }),
      'This shipment QR belongs to a different Orders contract.',
    ],
  ])('rejects %s after image decoding', async (_case, decodedValue, expectedMessage) => {
    mocks.image.mockResolvedValue(decodedValue);
    render(
      <ShipmentsWorkspace role="distributor" section="intake" initialShipmentId={shipmentId} />,
    );
    const upload = await screen.findByLabelText('Upload QR image');
    fireEvent.change(upload, {
      target: { files: [new File(['qr'], 'readable.png', { type: 'image/png' })] },
    });

    expect(await screen.findByText(expectedMessage)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Confirm receipt with MetaMask' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('allows supplier to dispatch stock by choosing distributor without receiving location or vehicle', async () => {
    mocks.get.mockResolvedValue({
      ...structuredClone(state),
      actor: supplier,
      distributors: [{ wallet: carrier, companyName: 'Carrier Dist' }],
    });
    render(<ShipmentsWorkspace role="supplier" initialView="transfer" initialBatchId={batchId} />);
    await screen.findByRole('button', { name: 'Confirm dispatch with MetaMask' });
    expect(screen.getByLabelText(/On-chain Distributor/)).toBeTruthy();
    expect(screen.queryByLabelText(/Receiving location/)).toBeNull();
    expect(screen.queryByLabelText(/Vehicle registration number/)).toBeNull();
  });
});
