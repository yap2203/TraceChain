// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./orders.api', () => ({ prepareCustodyOffer: vi.fn() }));
vi.mock('../production-flow/production-flow.transaction', () => ({
  submitProductionTransaction: vi.fn(),
}));
vi.mock('../product-traceability/ProductQrDisplay', () => ({
  ProductQrDisplay: () => <p>Shipment QR label</p>,
}));
import { CustodyPickupPanel } from './CustodyPickupPanel';
import { prepareCustodyOffer } from './orders.api';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';

const sender = '0x1000000000000000000000000000000000000001',
  distributor = '0x2000000000000000000000000000000000000002';
const offer: any = {
  offerId: '0x' + '12'.repeat(32),
  kind: 1,
  batchId: 'batch',
  quantity: '25',
  unit: 'kg',
  sender,
  distributor,
  senderName: 'Actual Supplier',
  distributorName: 'Actual Distributor',
  itemName: 'Actual ingredient',
  fromLocation: 'factory',
  toLocation: 'warehouse',
  expiresAt: Math.floor(Date.now() / 1000) + 86400,
  pickupAt: Math.floor(Date.now() / 1000) + 3600,
  plannedShipmentId: '0x' + 'ab'.repeat(32),
  status: 'SCHEDULED',
};
const state = (actor: string): any => ({
  actor,
  chainId: 11155111,
  ordersAddress: '0x3000000000000000000000000000000000000003',
  orders: [],
  catalogue: [],
  locations: [],
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('keeps a confirmed handoff locked when refreshing its shipment fails', async () => {
  vi.mocked(prepareCustodyOffer).mockResolvedValue({ transaction: {} } as any);
  vi.mocked(submitProductionTransaction).mockResolvedValue(undefined);
  const refresh = vi.fn().mockRejectedValue(new Error('RPC unavailable'));
  render(
    <CustodyPickupPanel
      offer={{ ...offer, vehicle: 'VAB 1234', expectedAt: offer.pickupAt + 7200 }}
      data={state(sender)}
      onChanged={refresh}
    />,
  );
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirm handoff with MetaMask' }));
  });
  expect(
    screen.getByText(/handoff transaction was confirmed, but the shipment refresh is pending/),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm handoff with MetaMask' })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh records' }));
  });
  expect(submitProductionTransaction).toHaveBeenCalledTimes(1);
  expect(prepareCustodyOffer).toHaveBeenCalledTimes(1);
});

it('shows the sender the label before the handoff confirmation', () => {
  vi.stubEnv('VITE_PUBLIC_APP_URL', 'https://app.example');
  render(<CustodyPickupPanel offer={offer} data={state(sender)} onChanged={vi.fn()} />);
  const step1 = screen.getByText('Step 1 · Print and attach the label');
  const step2 = screen.getByText('Step 2 · Confirm the handoff at pickup');
  expect(step1.compareDocumentPosition(step2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Confirm handoff with MetaMask' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it('gives the Distributor no handoff controls', () => {
  render(<CustodyPickupPanel offer={offer} data={state(distributor)} onChanged={vi.fn()} />);
  expect(screen.getByText(/check the TraceChain label/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm handoff with MetaMask' })).toBeNull();
});

it('blocks a second handoff while the submitted one awaits chain confirmation', () => {
  render(
    <CustodyPickupPanel
      offer={{ ...offer, shipmentId: offer.plannedShipmentId }}
      data={state(sender)}
      onChanged={vi.fn()}
    />,
  );
  expect(screen.getByText(/Do not submit the handoff again/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm handoff with MetaMask' })).toBeNull();
});

it('asks the sender only to confirm, showing the arranged vehicle and arrival', () => {
  const arranged = { ...offer, vehicle: 'VAB 1234', expectedAt: offer.pickupAt + 7200 };
  render(<CustodyPickupPanel offer={arranged} data={state(sender)} onChanged={vi.fn()} />);
  expect(screen.getByText('VAB 1234')).toBeTruthy();
  expect(screen.queryByLabelText(/Pickup vehicle registration/)).toBeNull();
  expect(screen.queryByLabelText(/handoff time/i)).toBeNull();
  const confirm = screen.getByRole('button', { name: 'Confirm handoff with MetaMask' });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  expect((confirm as HTMLButtonElement).disabled).toBe(false);
});

it('blocks the handoff once the arranged arrival has passed', () => {
  const late = { ...offer, vehicle: 'VAB 1234', expectedAt: Math.floor(Date.now() / 1000) - 60 };
  render(<CustodyPickupPanel offer={late} data={state(sender)} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText(/planned warehouse arrival has passed/)).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Confirm handoff with MetaMask' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it('never asks the sender for vehicle or arrival when the Distributor has not arranged them', () => {
  render(<CustodyPickupPanel offer={offer} data={state(sender)} onChanged={vi.fn()} />);
  expect(screen.getAllByText('Not arranged yet')).toHaveLength(2);
  expect(
    screen.getByText(/has not arranged the pickup vehicle and expected arrival yet/),
  ).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(
    (screen.getByRole('button', { name: 'Confirm handoff with MetaMask' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
