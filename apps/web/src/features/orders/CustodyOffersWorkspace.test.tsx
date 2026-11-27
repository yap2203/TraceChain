// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  list: vi.fn(),
  orders: vi.fn(),
  create: vi.fn(),
  act: vi.fn(),
  prepare: vi.fn(),
  sign: vi.fn(),
  identity: vi.fn(),
}));
vi.mock('./orders.api', () => ({
  getCustodyOffers: api.list,
  getOrders: api.orders,
  createCustodyOffer: api.create,
  actCustodyOffer: api.act,
  prepareCustodyOffer: api.prepare,
  deliveryIdentity: api.identity,
}));
vi.mock('../production-flow/production-flow.transaction', () => ({
  submitProductionTransaction: api.sign,
}));
vi.mock('../product-traceability/ProductQrDisplay', () => ({
  ProductQrDisplay: () => <p>Shipment QR label</p>,
}));
vi.mock('./ShipmentsWorkspace', () => ({
  ShipmentsWorkspace: (props: { initialShipmentId: string; embedded?: boolean }) => (
    <p>
      Receipt for {props.initialShipmentId} {props.embedded ? '(embedded)' : ''}
    </p>
  ),
}));
import { CustodyOffersWorkspace } from './CustodyOffersWorkspace';
const sender = '0x1000000000000000000000000000000000000001',
  distributor = '0x2000000000000000000000000000000000000002',
  offerId = '0x' + '12'.repeat(32);
let offer: any;
beforeEach(() => {
  offer = {
    offerId,
    kind: 1,
    batchId: 'actual-batch',
    quantity: '25',
    unit: 'kg',
    sender,
    distributor,
    senderName: 'Actual Supplier',
    distributorName: 'Actual Distributor',
    itemName: 'Actual ingredient',
    fromLocation: 'factory',
    toLocation: 'warehouse',
    fromLocationName: 'Actual source site',
    toLocationName: 'Actual warehouse',
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
    status: 'REQUESTED',
  };
  api.list.mockImplementation(async () => ({ offers: [structuredClone(offer)] }));
  api.orders.mockResolvedValue({
    actor: distributor,
    role: 'DISTRIBUTOR',
    orders: [],
    catalogue: [],
    locations: [],
    logistics: { warehouses: [] },
  });
  api.act.mockImplementation(async (_id, input) => {
    offer.status =
      input.action === 'accept' ? 'ACCEPTED' : input.action === 'reject' ? 'REJECTED' : 'SCHEDULED';
    if (input.pickupAt) offer.pickupAt = input.pickupAt;
    return { offer };
  });
  api.prepare.mockResolvedValue({ transaction: { to: 'registry' }, resultId: 'shipment' });
  api.sign.mockResolvedValue({});
  api.identity.mockResolvedValue({ status: 'NOT_REQUESTED' });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function show(receiver = true) {
  return render(
    <MemoryRouter initialEntries={['/?offerId=' + offerId]}>
      <CustodyOffersWorkspace role={receiver ? 'distributor' : 'supplier'} receiver={receiver} />
    </MemoryRouter>,
  );
}
it('requires Distributor acceptance then explicit pickup scheduling without moving inventory', async () => {
  show();
  await screen.findByText('Actual ingredient');
  expect(screen.getByRole('heading', { name: 'Custody offer' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Custody offers' }).getAttribute('href')).toBe(
    '/distributor/intake',
  );
  expect(screen.getByRole('region', { name: 'Transfer details' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Next action' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm handoff with MetaMask' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Accept custody offer' }));
  await screen.findByLabelText(/Planned custody pickup/);
  const date = new Date(Date.now() + 3600000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  fireEvent.change(screen.getByLabelText(/Planned custody pickup/), {
    target: { value: date.toISOString().slice(0, 16) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm pickup time' }));
  await waitFor(() =>
    expect(api.act).toHaveBeenLastCalledWith(
      offerId,
      expect.objectContaining({ action: 'schedule', pickupAt: expect.any(Number) }),
    ),
  );
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.sign).not.toHaveBeenCalled();
});
it('opens the custody company-evidence request in a modal without leaving the offer', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Request sender company evidence' }));
  expect(await screen.findByRole('dialog', { name: /Request company evidence/ })).toBeTruthy();
  expect(screen.getAllByText('Actual Supplier').length).toBeGreaterThan(0);
  expect(screen.getByRole('heading', { name: 'Custody offer' })).toBeTruthy();
});
it('presents the Supplier custody request detail as a compact workflow', async () => {
  api.orders.mockResolvedValue({
    actor: sender,
    role: 'SUPPLIER',
    orders: [],
    catalogue: [],
    locations: [],
    logistics: { warehouses: [] },
  });
  show(false);

  await screen.findByRole('heading', { name: 'Custody offer' });
  expect(screen.getByRole('link', { name: 'Send to custody' }).getAttribute('href')).toBe(
    '/supplier/transfers',
  );
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();

  const timeline = screen.getByRole('list', { name: 'Custody request progress' });
  const stages = within(timeline).getAllByRole('listitem');
  expect(stages).toHaveLength(5);
  expect(stages[0]?.classList.contains('is-complete')).toBe(true);
  expect(stages[1]?.classList.contains('is-current')).toBe(true);
  expect(stages[1]?.getAttribute('aria-current')).toBe('step');
  expect(within(timeline).getAllByText('Actual Supplier')).toHaveLength(2);
  expect(within(timeline).getAllByText('Actual Distributor')).toHaveLength(3);

  expect(screen.getByRole('region', { name: 'Transfer details' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Next action' })).toBeTruthy();
  expect(screen.getByText('Actual source site')).toBeTruthy();
  expect(screen.getByText('Actual warehouse')).toBeTruthy();
  expect(screen.getByText(/Stock moves only after physical handoff/)).toBeTruthy();

  const technical = screen.getByText('Technical details').closest('details');
  expect(technical?.open).toBe(false);
});
it('rejects a custody offer without a dispatch or stock transaction', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Reject offer' }));
  await screen.findByText('Custody offer rejected. No stock moved.');
  expect(api.sign).not.toHaveBeenCalled();
  expect(api.prepare).not.toHaveBeenCalled();
});
it('keeps expired Distributor requests visible without actionable workflow controls', async () => {
  offer.status = 'EXPIRED';
  api.orders.mockResolvedValue({
    actor: sender,
    role: 'SUPPLIER',
    orders: [],
    catalogue: [],
    locations: [],
    logistics: { warehouses: [] },
  });
  show(false);

  expect(await screen.findByText('Expired')).toBeTruthy();
  expect(screen.getByText('This custody offer expired before the handoff.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Accept custody offer' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Confirm pickup time' })).toBeNull();
});
it('keeps the sender waiting until pickup is arranged and exposes only sender handoff controls afterwards', async () => {
  api.orders.mockResolvedValue({
    actor: sender,
    role: 'SUPPLIER',
    orders: [],
    catalogue: [],
    locations: [],
    logistics: { warehouses: [] },
  });
  const view = show(false);
  await screen.findByText('Waiting for Actual Distributor to accept or reject the offer.');
  expect(screen.queryByRole('button', { name: 'Accept custody offer' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Confirm handoff with MetaMask' })).toBeNull();
  view.unmount();
  offer.status = 'SCHEDULED';
  offer.pickupAt = Math.floor(Date.now() / 1000) + 3600;
  show(false);
  const handoff = await screen.findByRole('button', { name: 'Confirm handoff with MetaMask' });
  expect((handoff as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Confirm pickup time' })).toBeNull();
});

it('shows the validated Manufacturer balance for the selected production pickup location', async () => {
  api.list.mockResolvedValue({ offers: [] });
  api.orders.mockResolvedValue({
    actor: sender,
    role: 'MANUFACTURER',
    orders: [],
    catalogue: [
      {
        active: true,
        archived: false,
        batches: ['fresh-product'],
        itemId: 'product-item',
        kind: 2,
        name: 'Fresh finished product',
        seller: sender,
        unit: 'units',
      },
    ],
    locations: [{ company: sender, label: 'Main production floor', location: 'factory' }],
    logistics: {
      productStock: [
        {
          available: '123',
          batchId: 'fresh-product',
          initialized: false,
          locations: [],
          productionLocation: 'factory',
          tracked: false,
        },
      ],
      warehouses: [{ distributor, location: 'warehouse', name: 'Actual Distributor warehouse' }],
    },
  });
  render(
    <MemoryRouter>
      <CustodyOffersWorkspace role="manufacturer" />
    </MemoryRouter>,
  );

  // Stock is chosen in the shared picker dialog, which shows availability per batch.
  fireEvent.click(await screen.findByRole('button', { name: /Choose stock/ }));
  const option = screen.getByRole('button', { name: /Fresh finished product/ });
  expect(option.textContent).toContain('Available: 123 units');
  fireEvent.click(option);
  fireEvent.click(screen.getByRole('button', { name: 'Use this stock' }));
  expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Choose pickup location/ }));
  const site = screen.getByRole('button', { name: /Main production floor/ });
  expect(site.textContent).toContain('Available here: 123 units');
  fireEvent.click(site);
  fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));

  expect((await screen.findByText(/Available at this pickup location:/)).textContent).toBe(
    'Available at this pickup location: 123 units',
  );
  expect(api.create).not.toHaveBeenCalled();
});

it('lets the sender print the label once pickup is arranged, before confirming the handoff', async () => {
  vi.stubEnv('VITE_PUBLIC_APP_URL', 'https://app.example');
  api.orders.mockResolvedValue({
    actor: sender,
    role: 'SUPPLIER',
    chainId: 11155111,
    ordersAddress: '0x3000000000000000000000000000000000000003',
    orders: [],
    catalogue: [],
    locations: [],
    logistics: { warehouses: [] },
  });
  offer.status = 'SCHEDULED';
  offer.pickupAt = Math.floor(Date.now() / 1000) + 3600;
  offer.plannedShipmentId = '0x' + 'ab'.repeat(32);
  show(false);
  const step1 = await screen.findByText('Step 1 · Print and attach the label');
  const step2 = screen.getByText('Step 2 · Confirm the handoff at pickup');
  expect(screen.getByText('Shipment QR label')).toBeTruthy();
  // The label step comes before the handoff step on the page.
  expect(step1.compareDocumentPosition(step2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  vi.unstubAllEnvs();
});

it('turns the Distributor offer page into the label scan and receipt once the goods are on the way', async () => {
  offer.status = 'DISPATCHED';
  offer.shipmentId = '0x' + 'cd'.repeat(32);
  show(true);
  expect(await screen.findByText(/Receipt for 0xcdcd.*embedded/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Open warehouse arrival/ })).toBeNull();
});
