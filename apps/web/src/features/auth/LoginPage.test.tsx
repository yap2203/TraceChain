// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

  afterEach(() => cleanup());

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
