import { describe, expect, it, vi } from 'vitest';

import {
  MetaMaskConnectionAdapter,
  TARGET_CHAIN_HEX,
  WalletConnectionError,
  type MetaMaskEvmClient,
  type MetaMaskEvmClientFactory,
  type TraceChainWalletProvider,
} from './metamask-connection';

const ACCOUNT = '0x1000000000000000000000000000000000000001';

function setup({
  displayMobileUri = false,
  extensionProvider,
  mobile = false,
}: {
  displayMobileUri?: boolean;
  extensionProvider?: TraceChainWalletProvider;
  mobile?: boolean;
} = {}) {
  const clearTransportPreference = vi.fn().mockResolvedValue(undefined);
  const provider = { request: vi.fn() } as unknown as TraceChainWalletProvider;
  const client: MetaMaskEvmClient = {
    connect: vi.fn().mockResolvedValue({ accounts: [ACCOUNT], chainId: TARGET_CHAIN_HEX }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getProvider: vi.fn().mockReturnValue(provider),
    switchChain: vi.fn().mockResolvedValue(undefined),
  };
  const factory = vi.fn<MetaMaskEvmClientFactory>().mockImplementation(async (options) => {
    if (displayMobileUri) options.eventHandlers?.displayUri?.('wc:test-uri');
    return client;
  });
  const adapter = new MetaMaskConnectionAdapter(factory, {
    clearTransportPreference,
    getExtensionProvider: () => extensionProvider,
    iconUrl: 'https://tracechain.example/tracechain-mark.svg',
    isMobile: () => mobile,
    origin: 'https://tracechain.example',
  });

  return { adapter, clearTransportPreference, client, factory, provider };
}

describe('MetaMask Connect adapter', () => {
  it('does not initialize MetaMask Connect until connect is requested', () => {
    const { factory } = setup();
    expect(factory).not.toHaveBeenCalled();
  });

  it('connects an extension-style provider on the configured target chain', async () => {
    const { adapter, client, provider } = setup();
    const onMobileConnection = vi.fn();

    const connection = await adapter.connect({ onMobileConnection });

    expect(client.connect).toHaveBeenCalledWith({
      chainIds: [TARGET_CHAIN_HEX],
      forceRequest: false,
    });
    expect(connection).toEqual({
      accounts: [ACCOUNT],
      chainId: TARGET_CHAIN_HEX,
      provider,
    });
    expect(onMobileConnection).not.toHaveBeenCalled();
  });

  it('reuses an existing authorized MetaMask extension account without another permission prompt', async () => {
    const extensionProvider = {
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === 'eth_accounts') return Promise.resolve([ACCOUNT]);
        if (method === 'eth_chainId') return Promise.resolve(TARGET_CHAIN_HEX);
        throw new Error(`Unexpected method ${method}`);
      }),
    } as unknown as TraceChainWalletProvider;
    const { adapter, factory } = setup({ extensionProvider });

    const connection = await adapter.connect();

    expect(connection).toMatchObject({ accounts: [ACCOUNT], chainId: TARGET_CHAIN_HEX });
    expect(extensionProvider.request).toHaveBeenCalledWith({ method: 'eth_accounts' });
    expect(extensionProvider.request).not.toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('requests access once when MetaMask is unlocked but the site is not authorized yet', async () => {
    const extensionProvider = {
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === 'eth_accounts') return Promise.resolve([]);
        if (method === 'eth_requestAccounts') return Promise.resolve([ACCOUNT]);
        if (method === 'eth_chainId') return Promise.resolve(TARGET_CHAIN_HEX);
        throw new Error(`Unexpected method ${method}`);
      }),
    } as unknown as TraceChainWalletProvider;
    const { adapter, factory } = setup({ extensionProvider });

    await adapter.connect();

    expect(extensionProvider.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('shares one active connection across repeated connect-button clicks', async () => {
    let releaseAccounts: ((accounts: string[]) => void) | undefined;
    const extensionProvider = {
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === 'eth_accounts') {
          return new Promise<string[]>((resolve) => {
            releaseAccounts = resolve;
          });
        }
        if (method === 'eth_chainId') return Promise.resolve(TARGET_CHAIN_HEX);
        return Promise.resolve([]);
      }),
    } as unknown as TraceChainWalletProvider;
    const { adapter } = setup({ extensionProvider });

    const first = adapter.connect();
    const second = adapter.connect();
    releaseAccounts?.([ACCOUNT]);

    await Promise.all([first, second]);
    expect(extensionProvider.request).toHaveBeenCalledTimes(2);
    expect(extensionProvider.request).toHaveBeenCalledWith({ method: 'eth_accounts' });
    expect(extensionProvider.request).toHaveBeenCalledWith({ method: 'eth_chainId' });
  });

  it('reports desktop QR connection while using the same provider flow', async () => {
    const { adapter } = setup({ displayMobileUri: true });
    const onMobileConnection = vi.fn();

    await adapter.connect({ onMobileConnection });

    expect(onMobileConnection).toHaveBeenCalledWith('qr');
  });

  it('can explicitly prefer MetaMask Mobile even when an extension is available', async () => {
    const { adapter, clearTransportPreference, factory } = setup({ displayMobileUri: true });

    await adapter.connect({}, 'mobile');

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        ui: expect.objectContaining({ preferExtension: false, showInstallModal: true }),
      }),
    );
    expect(clearTransportPreference).toHaveBeenCalledOnce();
  });

  it('reports a mobile deep link connection on phone browsers', async () => {
    const { adapter } = setup({ displayMobileUri: true, mobile: true });
    const onMobileConnection = vi.fn();

    await adapter.connect({ onMobileConnection });

    expect(onMobileConnection).toHaveBeenCalledWith('deeplink');
  });

  it('classifies rejected and expired connections for retry UX', async () => {
    const rejected = setup();
    vi.mocked(rejected.client.connect).mockRejectedValueOnce({ code: 4001 });
    await expect(rejected.adapter.connect()).rejects.toMatchObject({
      code: 'CONNECTION_REJECTED',
    });

    const expired = setup({ displayMobileUri: true });
    vi.mocked(expired.client.connect).mockRejectedValue(new Error('WalletConnect session expired'));
    await expect(expired.adapter.connect()).rejects.toEqual(
      expect.objectContaining<Partial<WalletConnectionError>>({
        code: 'CONNECTION_EXPIRED',
      }),
    );
  });

  it('disconnects only a stale client and retries once with a fresh client', async () => {
    const provider = { request: vi.fn() } as unknown as TraceChainWalletProvider;
    const staleClient: MetaMaskEvmClient = {
      connect: vi.fn().mockRejectedValue(new Error('session closed')),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockReturnValue(provider),
      switchChain: vi.fn().mockResolvedValue(undefined),
    };
    const freshClient: MetaMaskEvmClient = {
      connect: vi.fn().mockResolvedValue({ accounts: [ACCOUNT], chainId: TARGET_CHAIN_HEX }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockReturnValue(provider),
      switchChain: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi
      .fn<MetaMaskEvmClientFactory>()
      .mockResolvedValueOnce(staleClient)
      .mockResolvedValueOnce(freshClient);
    const adapter = new MetaMaskConnectionAdapter(factory, {
      clearTransportPreference: vi.fn().mockResolvedValue(undefined),
      getExtensionProvider: () => undefined,
      iconUrl: 'https://tracechain.example/tracechain-mark.svg',
      isMobile: () => false,
      origin: 'https://tracechain.example',
    });

    await expect(adapter.connect()).resolves.toMatchObject({ accounts: [ACCOUNT] });

    expect(factory).toHaveBeenCalledTimes(2);
    expect(staleClient.disconnect).toHaveBeenCalledOnce();
    expect(freshClient.disconnect).not.toHaveBeenCalled();
  });

  it('times out an unresponsive extension connection', async () => {
    vi.useFakeTimers();
    try {
      const extensionProvider = {
        request: vi.fn().mockReturnValue(new Promise(() => undefined)),
      } as unknown as TraceChainWalletProvider;
      const base = setup({ extensionProvider });
      const adapter = new MetaMaskConnectionAdapter(
        base.factory,
        {
          clearTransportPreference: base.clearTransportPreference,
          getExtensionProvider: () => extensionProvider,
          iconUrl: 'https://tracechain.example/tracechain-mark.svg',
          isMobile: () => false,
          origin: 'https://tracechain.example',
        },
        100,
      );
      const rejection = expect(adapter.connect()).rejects.toMatchObject({
        code: 'CONNECTION_TIMEOUT',
      });

      await vi.advanceTimersByTimeAsync(100);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches only to the configured target network and disconnects cleanly', async () => {
    const { adapter, client } = setup();
    await adapter.connect();

    await adapter.switchToTargetNetwork();
    await adapter.disconnect();

    expect(client.switchChain).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: TARGET_CHAIN_HEX }),
    );
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});
