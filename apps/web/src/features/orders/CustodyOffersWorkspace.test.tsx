// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  list: vi.fn(),
  orders: vi.fn(),
  create: vi.fn(),
  act: vi.fn(),
  prepare: vi.fn(),
  sign: vi.fn(),
}));
vi.mock('./orders.api', () => ({
  getCustodyOffers: api.list,
  getOrders: api.orders,
  createCustodyOffer: api.create,
  actCustodyOffer: api.act,
  prepareCustodyOffer: api.prepare,
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
    offer.status =
      input.action === 'accept' ? 'ACCEPTED' : input.action === 'reject' ? 'REJECTED' : 'SCHEDULED';
    if (input.pickupAt) offer.pickupAt = input.pickupAt;
    return { offer };
  });
  api.prepare.mockResolvedValue({ transaction: { to: 'registry' }, resultId: 'shipment' });
  api.sign.mockResolvedValue({});
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
it('rejects a custody offer without a dispatch or stock transaction', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Reject offer' }));
  await screen.findByText('Custody offer rejected. No stock moved.');
  expect(api.sign).not.toHaveBeenCalled();
  expect(api.prepare).not.toHaveBeenCalled();
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
  await screen.findByText('Waiting for the Distributor’s decision.');
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
