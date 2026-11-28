// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CompanyRole, encodeShipmentQr } from '@tracechain/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from './LoginPage';

const walletMocks = vi.hoisted(() => ({
  cancelConnection: vi.fn(),
  connect: vi.fn(),
  connectMobile: vi.fn(),
  state: {
    authorizationReady: false,
    credentialVerified: false,
    locallyVerified: false,
    message: 'Ready to connect',
    onChainStatusChecked: false,
    phase: 'idle',
  },
}));

vi.mock('./useWalletAuthentication', () => ({
  shortenAddress: (address: string) => address,
  useWalletAuthentication: () => ({
    cancelConnection: walletMocks.cancelConnection,
    connect: walletMocks.connect,
    connectMobile: walletMocks.connectMobile,
    credentialState: { message: '', phase: 'idle', reasons: [] },
    logout: vi.fn(),
    presentCredential: vi.fn(),
    refreshSession: vi.fn(),
    state: walletMocks.state,
    switchToTargetNetwork: vi.fn(),
  }),
}));

describe('login wallet connection tabs', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    });
  });

  beforeEach(() => {
    walletMocks.cancelConnection.mockReset();
    walletMocks.connect.mockReset();
    walletMocks.connectMobile.mockReset();
    Object.assign(walletMocks.state, {
      authorizationReady: false,
      credentialVerified: false,
      locallyVerified: false,
      message: 'Ready to connect',
      onChainStatusChecked: false,
      phase: 'idle',
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('returns an authorized login to the complete shipment link and rejects external return targets', async () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', window.location.origin);
    const qr = encodeShipmentQr({
      publicAppUrl: window.location.origin,
      chainId: 31337,
      ordersAddress: '0x1000000000000000000000000000000000000001',
      shipmentId: ('0x' + '11'.repeat(32)) as `0x${string}`,
      kind: 'product',
    });
    const path = new URL(qr).pathname + new URL(qr).search;
    const Destination = () => {
      const location = useLocation();
      return <p data-testid="destination">{location.pathname + location.search}</p>;
    };
    const Router = ({ target }: { target: string }) => (
      <MemoryRouter initialEntries={[`/login?returnTo=${encodeURIComponent(target)}`]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/receive/shipment" element={<Destination />} />
          <Route path="/distributor/overview" element={<Destination />} />
        </Routes>
      </MemoryRouter>
    );
    const view = render(<Router target={path} />);
    expect(screen.queryByTestId('destination')).toBeNull();
    Object.assign(walletMocks.state, {
      phase: 'authenticated',
      authorizationReady: true,
      onChainStatusChecked: true,
      role: CompanyRole.DISTRIBUTOR,
    });
    view.rerender(<Router target={path} />);
    expect((await screen.findByTestId('destination')).textContent).toBe(path);
    view.unmount();
    render(<Router target={`https://evil.example${path}`} />);
    expect((await screen.findByTestId('destination')).textContent).toBe('/distributor/overview');
  });

  it('lets an extension user explicitly switch to the mobile QR flow', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('tab', { name: 'Browser extension' }).getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Mobile QR' }));

    expect(screen.getByText('Connect with MetaMask Mobile')).toBeTruthy();
    expect(screen.getByText(/Display a QR code, then scan and approve it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Display QR code' }));

    expect(walletMocks.connectMobile).toHaveBeenCalledOnce();
    expect(walletMocks.connect).not.toHaveBeenCalled();
  });

  it('keeps the authentication card visible with local progress and cancellation', () => {
    Object.assign(walletMocks.state, {
      message: 'Opening MetaMask connection options',
      phase: 'connecting',
    });

    const { container } = render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Connect to TraceChain' })).toBeTruthy();
    expect(screen.getAllByText('Opening MetaMask connection options')).not.toHaveLength(0);
    expect(container.querySelector('.loading-indicator--screen')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(walletMocks.cancelConnection).toHaveBeenCalledOnce();
  });

  it('does not present Company Role VC upload during login', () => {
    Object.assign(walletMocks.state, {
      authorizationStatus: 'APPLICATION_PENDING',
      message: 'The company application is awaiting administrator review.',
      phase: 'authenticated',
    });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Choose credential file')).toBeNull();
    expect(screen.getByText('Application pending')).toBeTruthy();
  });
});
