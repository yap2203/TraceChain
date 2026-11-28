// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompanyRole, encodeShipmentQr } from '@tracechain/shared';
const mocks = vi.hoisted(() => ({
  state: {} as any,
  getOrders: vi.fn(),
  connect: vi.fn(),
  sign: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('../auth/useWalletAuthentication', () => ({
  useWalletAuthentication: () => ({
    state: mocks.state,
    connect: mocks.connect,
    connectMobile: vi.fn(),
    switchToTargetNetwork: vi.fn(),
    logout: mocks.logout,
  }),
}));
vi.mock('./orders.api', () => ({ getOrders: mocks.getOrders }));
vi.mock('./ShipmentsWorkspace', () => ({
  ShipmentsWorkspace: (props: any) => (
    <div
      data-testid="receipt-workspace"
      data-payload={props.initialQr}
      data-shipment={props.initialShipmentId}
      data-order={props.initialOrderId}
    />
  ),
}));
vi.mock('../production-flow/production-flow.transaction', () => ({
  submitProductionTransaction: mocks.sign,
}));
import { ReceiveShipmentPage } from './ReceiveShipmentPage';
const actor = '0x1000000000000000000000000000000000000001';
const registry = '0x2000000000000000000000000000000000000002';
const shipmentId = ('0x' + '11'.repeat(32)) as `0x${string}`;
const origin = window.location.origin;
function link(kind: 'ingredient' | 'product' = 'product') {
  return encodeShipmentQr({
    chainId: 31337,
    ordersAddress: registry,
    shipmentId,
    kind,
    publicAppUrl: origin,
  });
}
function open(url = link()) {
  const parsed = new URL(url);
  const path = parsed.pathname + parsed.search + parsed.hash;
  window.history.replaceState({}, '', path);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReceiveShipmentPage />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_PUBLIC_APP_URL', undefined);
  Object.assign(mocks.state, {
    phase: 'authenticated',
    authorizationReady: true,
    onChainStatusChecked: true,
    address: actor,
    role: CompanyRole.DISTRIBUTOR,
  });
  mocks.getOrders.mockResolvedValue({
    actor,
    chainId: 31337,
    ordersAddress: registry,
    orders: [],
    logistics: { shipments: [{ shipmentId, recipient: actor, sender: registry, kind: 'product' }] },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
});
it('opens a generated shipment link when the deployed public URL setting is omitted', async () => {
  const qr = link();
  open(qr);
  expect((await screen.findByTestId('receipt-workspace')).getAttribute('data-payload')).toBe(qr);
  expect(mocks.sign).not.toHaveBeenCalled();
});
it.each(['ingredient', 'product'] as const)(
  'opens an existing valid %s link with an explicit origin',
  async (kind) => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', origin + '/');
    mocks.getOrders.mockResolvedValue({
      actor,
      chainId: 31337,
      ordersAddress: registry,
      orders: [],
      logistics: { shipments: [{ shipmentId, recipient: actor, kind }] },
    });
    open(link(kind));
    expect((await screen.findByTestId('receipt-workspace')).getAttribute('data-shipment')).toBe(
      shipmentId,
    );
    expect(mocks.sign).not.toHaveBeenCalled();
  },
);
it('retains every QR parameter during inline login without automatic connection or receipt confirmation', async () => {
  Object.assign(mocks.state, { phase: 'idle', authorizationReady: false });
  const qr = link(),
    view = open(qr);
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.getOrders).not.toHaveBeenCalled();
  const login = screen.getByRole('link', { name: 'Continue on sign-in page' });
  expect(new URL(login.getAttribute('href')!, origin).searchParams.get('returnTo')).toBe(
    new URL(qr).pathname + new URL(qr).search,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Connect MetaMask & sign in' }));
  expect(mocks.connect).toHaveBeenCalledTimes(1);
  Object.assign(mocks.state, { phase: 'authenticated', authorizationReady: true });
  view.rerender(
    <MemoryRouter>
      <ReceiveShipmentPage />
    </MemoryRouter>,
  );
  expect((await screen.findByTestId('receipt-workspace')).getAttribute('data-payload')).toBe(qr);
  expect(mocks.sign).not.toHaveBeenCalled();
});
it.each(['&v=1', '&extra=1', '#unexpected'])(
  'rejects malformed links without an authorized shipment read: %s',
  async (suffix) => {
    open(link() + suffix);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(mocks.getOrders).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  },
);
it.each([
  ['v=1', 'v=2'],
  ['chainId=31337', 'chainId=11155111'],
])('rejects changed version/network fields: %s', (from, to) => {
  open(link().replace(from, to));
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(mocks.getOrders).not.toHaveBeenCalled();
});
it('reports malformed explicit public configuration without a raw URL constructor exception', () => {
  vi.stubEnv('VITE_PUBLIC_APP_URL', 'not-a-url');
  open();
  expect(screen.getByRole('alert').textContent).toContain('VITE_PUBLIC_APP_URL must be');
  expect(mocks.getOrders).not.toHaveBeenCalled();
});
it('checks the QR registry against the API instead of trusting its own query parameter', async () => {
  mocks.getOrders.mockResolvedValue({ actor, chainId: 31337, ordersAddress: actor, orders: [] });
  open();
  expect(
    await screen.findByText('This shipment QR belongs to a different Orders contract.'),
  ).toBeTruthy();
  expect(screen.queryByTestId('receipt-workspace')).toBeNull();
});
it('shows an actionable wrong-account message to a sender who is not the recipient', async () => {
  mocks.getOrders.mockResolvedValue({
    actor,
    chainId: 31337,
    ordersAddress: registry,
    orders: [],
    logistics: { shipments: [{ shipmentId, sender: actor, recipient: registry, kind: 'product' }] },
  });
  open();
  expect(await screen.findByText(/Wrong account or unavailable shipment/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Switch wallet' }));
  expect(mocks.logout).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('receipt-workspace')).toBeNull();
  expect(mocks.sign).not.toHaveBeenCalled();
});
it('preserves the existing authorized rejected-ingredient return receipt', async () => {
  Object.assign(mocks.state, { role: CompanyRole.SUPPLIER });
  mocks.getOrders.mockResolvedValue({
    actor,
    chainId: 31337,
    ordersAddress: registry,
    orders: [],
    logistics: {
      shipments: [
        { shipmentId, sender: actor, recipient: registry, kind: 'ingredient', leg: 1, status: 4 },
      ],
    },
  });
  open(link('ingredient'));
  expect(await screen.findByTestId('receipt-workspace')).toBeTruthy();
});
it('preserves an assigned Distributor product-order pickup link without automatically dispatching', async () => {
  mocks.getOrders.mockResolvedValue({
    actor,
    chainId: 31337,
    ordersAddress: registry,
    orders: [{ orderId: shipmentId, productDelivery: { distributor: actor, stage: 3 } }],
    logistics: { shipments: [] },
  });
  open();
  expect((await screen.findByTestId('receipt-workspace')).getAttribute('data-order')).toBe(
    shipmentId,
  );
  expect(mocks.sign).not.toHaveBeenCalled();
});
it('does not read or open shipment actions for an authenticated but unauthorized company', () => {
  Object.assign(mocks.state, { authorizationReady: false });
  open();
  expect(mocks.getOrders).not.toHaveBeenCalled();
  expect(screen.queryByTestId('receipt-workspace')).toBeNull();
});
