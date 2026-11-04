// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { getAddress } from 'ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SEPOLIA_CHAIN_HEX,
  WalletConnectionError,
  type TraceChainWalletProvider,
  type WalletConnectionAdapter,
  type WalletConnectionResult,
} from './metamask-connection';
import { useWalletAuthentication } from './useWalletAuthentication';

const ACCOUNT = '0x1000000000000000000000000000000000000001';
const OTHER_ACCOUNT = '0x2000000000000000000000000000000000000002';

const authMocks = vi.hoisted(() => ({
  deleteAuthSession: vi.fn(),
  getAuthSession: vi.fn(),
  requestNonce: vi.fn(),
  verifyCompanyRoleCredential: vi.fn(),
  verifySiweMessage: vi.fn(),
}));

vi.mock('./auth.api', () => ({
  AuthApiError: class AuthApiError extends Error {},
  ...authMocks,
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  return {
    ...actual,
    BrowserProvider: class BrowserProvider {
      constructor(private readonly provider: TraceChainWalletProvider) {}

      async getSigner(address: string) {
        return {
          signMessage: (message: string) =>
            this.provider.request({
              method: 'personal_sign',
              params: [message, address],
            }),
        };
      }
    },
  };
});

vi.mock('siwe', () => ({
  SiweMessage: class SiweMessage {
    constructor(private readonly fields: { address: string; statement: string }) {}

    prepareMessage() {
      return `${this.fields.statement}\n${this.fields.address}`;
    }
  },
}));

class MockProvider implements TraceChainWalletProvider {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly request = vi.fn().mockImplementation(({ method }: { method: string }) => {
    if (method === 'personal_sign') return Promise.resolve('0xsigned');
    return Promise.resolve(null);
  });

  on(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(
    event: 'accountsChanged' | 'chainChanged',
    listener: (...args: unknown[]) => void,
  ) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: 'accountsChanged' | 'chainChanged', value: unknown) {
    this.listeners.get(event)?.forEach((listener) => listener(value));
  }
}

function setupAdapter(chainId: string = SEPOLIA_CHAIN_HEX) {
  const provider = new MockProvider();
  const adapter: WalletConnectionAdapter = {
    connect: vi.fn().mockResolvedValue({ accounts: [ACCOUNT], chainId, provider }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    switchToSepolia: vi.fn().mockResolvedValue(undefined),
  };
  return { adapter, provider };
}

const authenticatedSession = {
  address: getAddress(ACCOUNT),
  authenticated: true as const,
  authorizationReady: false as const,
  credentialVerified: false as const,
  expiresAt: '2026-11-05T00:00:00.000Z',
  locallyVerified: false as const,
  message: 'Wallet verified. Company Role Credential verification is required.' as const,
  onChainStatusChecked: false as const,
};

describe('wallet authentication with MetaMask Connect', () => {
  beforeEach(() => {
    Object.values(authMocks).forEach((mock) => mock.mockReset());
    authMocks.deleteAuthSession.mockResolvedValue(undefined);
    authMocks.getAuthSession.mockResolvedValue({ authenticated: false });
    authMocks.requestNonce.mockResolvedValue({
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      nonce: 'a'.repeat(32),
    });
    authMocks.verifySiweMessage.mockResolvedValue(authenticatedSession);
  });

  it('restores the TraceChain session without initializing or connecting the wallet', async () => {
    authMocks.getAuthSession.mockResolvedValue(authenticatedSession);
    const { adapter } = setupAdapter();
    const { result } = renderHook(() => useWalletAuthentication(adapter));

    await waitFor(() => expect(result.current.state.phase).toBe('authenticated'));

    expect(adapter.connect).not.toHaveBeenCalled();
    expect(result.current.state.address).toBe(getAddress(ACCOUNT));
  });

  it('continues a connected account through nonce, SIWE signing, and API verification', async () => {
    const { adapter, provider } = setupAdapter();
    const { result } = renderHook(() => useWalletAuthentication(adapter));
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));

    await act(() => result.current.connect());

    expect(authMocks.requestNonce).toHaveBeenCalledWith(getAddress(ACCOUNT));
    expect(provider.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'personal_sign' }),
    );
    expect(authMocks.verifySiweMessage).toHaveBeenCalledWith(
      expect.stringContaining('Sign in to TraceChain'),
      '0xsigned',
    );
    expect(result.current.state.phase).toBe('authenticated');
  });

  it('requests the official mobile transport when the QR alternative is selected', async () => {
    const { adapter } = setupAdapter();
    const { result } = renderHook(() => useWalletAuthentication(adapter));
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));

    await act(() => result.current.connectMobile());

    expect(adapter.connect).toHaveBeenCalledWith(expect.any(Object), 'mobile');
    expect(result.current.state.phase).toBe('authenticated');
  });

  it('requires a Sepolia switch before starting SIWE', async () => {
    const { adapter } = setupAdapter('0x1');
    const { result } = renderHook(() => useWalletAuthentication(adapter));
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));

    await act(() => result.current.connect());
    expect(result.current.state.phase).toBe('switch_required');
    expect(authMocks.requestNonce).not.toHaveBeenCalled();

    await act(() => result.current.switchToSepolia());
    expect(adapter.switchToSepolia).toHaveBeenCalledOnce();
    expect(result.current.state.phase).toBe('authenticated');
  });

  it('handles a rejected wallet connection', async () => {
    const { adapter } = setupAdapter();
    vi.mocked(adapter.connect).mockRejectedValueOnce(
      new WalletConnectionError('CONNECTION_REJECTED', 'Connection rejected.'),
    );
    const { result } = renderHook(() => useWalletAuthentication(adapter));
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));

    await act(() => result.current.connect());

    expect(result.current.state.phase).toBe('rejected');
    expect(result.current.state.message).toBe('Connection rejected.');
  });

  it('shows and cancels a pending desktop QR connection', async () => {
    const { adapter, provider } = setupAdapter();
    let finishConnection: ((value: WalletConnectionResult) => void) | undefined;
    vi.mocked(adapter.connect).mockImplementationOnce(
      (callbacks) =>
        new Promise((resolve) => {
          finishConnection = resolve;
          callbacks?.onMobileConnection?.('qr');
        }) as ReturnType<WalletConnectionAdapter['connect']>,
    );
    const { result } = renderHook(() => useWalletAuthentication(adapter));
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));

    act(() => void result.current.connect());
    await waitFor(() => expect(result.current.state.phase).toBe('mobile_connecting'));
    expect(result.current.state.mobileConnectionMode).toBe('qr');

    await act(() => result.current.cancelConnection());
    expect(adapter.disconnect).toHaveBeenCalledOnce();
    expect(result.current.state.phase).toBe('idle');

    finishConnection?.({ accounts: [ACCOUNT], chainId: SEPOLIA_CHAIN_HEX, provider });
  });

  it('handles a rejected SIWE signature separately from wallet connection', async () => {
    const { adapter, provider } = setupAdapter();
    provider.request.mockRejectedValueOnce({ code: 4001 });
    const { result } = renderHook(() => useWalletAuthentication(adapter));
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));

    await act(() => result.current.connect());

    expect(result.current.state.phase).toBe('rejected');
    expect(result.current.state.message).toContain('login signature was rejected');
    expect(authMocks.verifySiweMessage).not.toHaveBeenCalled();
  });

  it('clears the authenticated session when the connected account changes', async () => {
    const { adapter, provider } = setupAdapter();
    const { result } = renderHook(() => useWalletAuthentication(adapter));
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));
    await act(() => result.current.connect());

    act(() => provider.emit('accountsChanged', [OTHER_ACCOUNT]));
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));

    expect(authMocks.deleteAuthSession).toHaveBeenCalledOnce();
    expect(adapter.disconnect).toHaveBeenCalledOnce();
    expect(result.current.state.message).toContain('account changed');
  });

  it('clears the authenticated session when the network leaves Sepolia', async () => {
    const { adapter, provider } = setupAdapter();
    const { result } = renderHook(() => useWalletAuthentication(adapter));
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));
    await act(() => result.current.connect());

    act(() => provider.emit('chainChanged', '0x1'));
    await waitFor(() => expect(result.current.state.phase).toBe('idle'));

    expect(authMocks.deleteAuthSession).toHaveBeenCalledOnce();
    expect(adapter.disconnect).toHaveBeenCalledOnce();
    expect(result.current.state.message).toContain('network changed');
  });
});
