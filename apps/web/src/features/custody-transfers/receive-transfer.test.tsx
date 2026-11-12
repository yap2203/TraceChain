// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:5173/" }

import { CompanyRole } from '@tracechain/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  connectMobile: vi.fn(),
  state: {
    authorizationReady: false,
    credentialVerified: false,
    locallyVerified: false,
    message: 'Ready to connect',
    onChainStatusChecked: false,
    phase: 'idle',
  } as Record<string, unknown>,
}));

vi.mock('../auth/useWalletAuthentication', () => ({
  useWalletAuthentication: () => ({
    connect: mocks.connect,
    connectMobile: mocks.connectMobile,
    state: mocks.state,
    switchToTargetNetwork: vi.fn(),
  }),
}));

vi.mock('./TransferQrScanner', () => ({
  TransferQrScanner: ({ initialPayload }: { initialPayload: string }) => (
    <div data-testid="resolved-direct-link">{initialPayload}</div>
  ),
}));

import { ReceiveTransferPage, safeReceiptReturnTo } from './ReceiveTransferPage';

const transferId = `0x${'11'.repeat(32)}`;
const contract = '0x4000000000000000000000000000000000000004';
const path = `/receive/transfer?v=1&chainId=31337&contract=${contract}&transferId=${transferId}`;

beforeEach(() => {
  window.history.replaceState(null, '', path);
  mocks.state = {
    authorizationReady: false,
    credentialVerified: false,
    locallyVerified: false,
    message: 'Ready to connect',
    onChainStatusChecked: false,
    phase: 'idle',
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('direct receipt-confirmation route', () => {
  it('shows an unauthenticated MetaMask login state without resolving shipment data', () => {
    render(<ReceiveTransferPage />);
    expect(screen.getByText('Sign in with MetaMask to continue')).toBeTruthy();
    expect(screen.queryByTestId('resolved-direct-link')).toBeNull();
  });

  it('restores an authorized session and passes the complete current URL to the resolver', () => {
    mocks.state = {
      ...mocks.state,
      authorizationReady: true,
      phase: 'authenticated',
      role: CompanyRole.RETAILER,
    };
    render(<ReceiveTransferPage />);
    expect(screen.getByTestId('resolved-direct-link').textContent).toBe(window.location.href);
  });

  it('uses the existing MetaMask Mobile connection on phone browsers', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 iPhone Mobile');
    render(<ReceiveTransferPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Open MetaMask Mobile' }));
    expect(mocks.connectMobile).toHaveBeenCalledOnce();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('allows only validated internal receipt return paths', () => {
    expect(safeReceiptReturnTo(path, 'http://localhost:5173')).toBe(path);
    expect(
      safeReceiptReturnTo('https://evil.example/receive/transfer', 'http://localhost:5173'),
    ).toBeNull();
    expect(safeReceiptReturnTo(`${path}#secret`, 'http://localhost:5173')).toBeNull();
  });
});
