// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import LoginPage from './LoginPage';

const walletMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  connectMobile: vi.fn(),
}));

vi.mock('./useWalletAuthentication', () => ({
  shortenAddress: (address: string) => address,
  useWalletAuthentication: () => ({
    cancelConnection: vi.fn(),
    connect: walletMocks.connect,
    connectMobile: walletMocks.connectMobile,
    credentialState: { message: '', phase: 'idle', reasons: [] },
    logout: vi.fn(),
    presentCredential: vi.fn(),
    state: {
      authorizationReady: false,
      credentialVerified: false,
      locallyVerified: false,
      message: 'Ready to connect',
      onChainStatusChecked: false,
      phase: 'idle',
    },
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
});
