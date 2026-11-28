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
    offer.status = input.action === 'reject' ? 'REJECTED' : 'SCHEDULED';
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

const pickupValue = (hours = 1) => {
  const date = new Date(Date.now() + hours * 3600000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
it('refreshes a new Manufacturer product offer into the Distributor inbox without signing in again', async () => {
  api.list.mockResolvedValueOnce({ offers: [] });
  offer.kind = 2;
  offer.itemName = 'Manufacturer product';
  offer.senderName = 'Actual Manufacturer';
  render(
    <MemoryRouter>
      <CustodyOffersWorkspace role="distributor" receiver />
    </MemoryRouter>,
  );
  await screen.findByText('Offers from Suppliers and Manufacturers will appear here.');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('Manufacturer product');
  expect(screen.getByText('Actual Manufacturer')).toBeTruthy();
  expect(screen.getAllByText('Manufacturer product')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Take action' }));
  expect(
    await screen.findByRole('button', { name: 'Accept with pickup arrangement' }),
  ).toBeTruthy();
  expect(api.create).not.toHaveBeenCalled();
  expect(api.sign).not.toHaveBeenCalled();
});

const fillArrangement = () => {
  fireEvent.change(screen.getByLabelText(/Planned custody pickup/), {
    target: { value: pickupValue(1) },
  });
  fireEvent.change(screen.getByLabelText(/Pickup vehicle registration/), {
    target: { value: 'vab 1234' },
  });
  fireEvent.change(screen.getByLabelText(/Expected warehouse arrival/), {
    target: { value: pickupValue(5) },
  });
};
const supplierState = {
  actor: sender,
  role: 'SUPPLIER',
  orders: [],
  catalogue: [],
  locations: [],
  logistics: { warehouses: [] },
};
it('accepts only together with a pickup time, completing the offer without moving inventory', async () => {
  show();
  await screen.findByText('Actual ingredient');
  expect(screen.getByRole('heading', { name: 'Custody offer' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Custody offers' }).getAttribute('href')).toBe(
    '/distributor/intake',
  );
  const accept = await screen.findByRole('button', { name: 'Accept with pickup arrangement' });
  expect((accept as HTMLButtonElement).disabled).toBe(true);
  fillArrangement();
  await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(accept);
  await waitFor(() =>
    expect(api.act).toHaveBeenCalledWith(
      offerId,
      expect.objectContaining({
        action: 'accept',
        pickupAt: expect.any(Number),
        vehicle: 'VAB 1234',
        expectedAt: expect.any(Number),
      }),
    ),
  );
  expect(await screen.findByRole('button', { name: 'Open shipment' })).toBeTruthy();
  expect(screen.getByText(/Custody offer complete/)).toBeTruthy();
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.sign).not.toHaveBeenCalled();
});
it('explains a pickup time that has already passed instead of silently disabling accept', async () => {
  show();
  await screen.findByRole('button', { name: 'Accept with pickup arrangement' });
  fillArrangement();
  fireEvent.change(screen.getByLabelText(/Planned custody pickup/), {
    target: { value: '2020-01-01T10:00' },
  });
  expect(await screen.findByText(/This time has passed/)).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Accept with pickup arrangement' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it('links the company evidence request to Evidence Exchange instead of a modal', async () => {
  show();
  const link = await screen.findByRole('link', { name: 'Request sender company evidence' });
  expect(link.getAttribute('href')).toBe(
    '/distributor/information-requests/sent?context=custody&referenceId=' + offerId,
  );

  expect(screen.queryByRole('dialog')).toBeNull();
});
it('disables accept and reject until requested company evidence is verified', async () => {
  api.identity.mockResolvedValue({
    status: 'PRESENTED',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  });
  show();
  await screen.findByText(/available after the requested company evidence is verified/);
  expect(
    (screen.getByRole('button', { name: 'Accept with pickup arrangement' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByRole('button', { name: 'Reject offer' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByRole('link', { name: 'View in Evidence Exchange' })).toBeTruthy();
});
it('reports an expired company request and lets the Distributor request again or decide', async () => {
  api.identity.mockResolvedValue({
    status: 'REQUESTED',
    expiresAt: Math.floor(Date.now() / 1000) - 60,
  });
  show();
  expect(await screen.findByText(/The company identity request has expired/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Request company evidence again' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Reject offer' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  fillArrangement();
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Accept with pickup arrangement' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});
it('presents the Supplier custody request detail as a two-step offer', async () => {
  api.orders.mockResolvedValue(supplierState);
  show(false);
  await screen.findByRole('heading', { name: 'Custody offer' });
  expect(screen.getByRole('link', { name: 'Send to custody' }).getAttribute('href')).toBe(
    '/supplier/transfers',
  );
  const timeline = screen.getByRole('list', { name: 'Custody offer progress' });
  const stages = within(timeline).getAllByRole('listitem');
  expect(stages).toHaveLength(2);
  expect(stages[0]?.classList.contains('is-complete')).toBe(true);
  expect(stages[1]?.getAttribute('aria-current')).toBe('step');
  expect(
    screen.getByText('Waiting for Actual Distributor to accept with a pickup time, or reject.'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Accept with pickup arrangement' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Confirm handoff with MetaMask' })).toBeNull();
  const technical = screen.getByText('Technical details').closest('details');
  expect(technical?.open).toBe(false);
});
it('rejects a custody offer without a dispatch or stock transaction', async () => {
  show();
  const reject = await screen.findByRole('button', { name: 'Reject offer' });
  await waitFor(() => expect((reject as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(reject);
  await screen.findByText('Custody offer rejected. No stock moved.');
  expect(api.sign).not.toHaveBeenCalled();
  expect(api.prepare).not.toHaveBeenCalled();
});
it('keeps expired offers visible without actionable controls', async () => {
  offer.status = 'EXPIRED';
  api.orders.mockResolvedValue(supplierState);
  show(false);
  expect(
    await screen.findByText(
      'This custody offer expired before pickup was arranged. No stock moved.',
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Accept with pickup arrangement' })).toBeNull();
});
it('sends the sender to Shipments for the label and handoff once pickup is arranged', async () => {
  api.orders.mockResolvedValue(supplierState);
  offer.status = 'SCHEDULED';
  offer.pickupAt = Math.floor(Date.now() / 1000) + 3600;
  show(false);
  expect(
    await screen.findByText(/Print the label and confirm the handoff in Shipments/),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open shipment' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm handoff with MetaMask' })).toBeNull();
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
