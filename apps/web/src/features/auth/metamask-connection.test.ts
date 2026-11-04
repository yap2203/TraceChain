import { describe, expect, it, vi } from 'vitest';

import {
  MetaMaskConnectionAdapter,
  SEPOLIA_CHAIN_HEX,
  WalletConnectionError,
  type MetaMaskEvmClient,
  type MetaMaskEvmClientFactory,
  type TraceChainWalletProvider,
} from './metamask-connection';

const ACCOUNT = '0x1000000000000000000000000000000000000001';

function setup({ displayMobileUri = false, mobile = false } = {}) {
  const clearTransportPreference = vi.fn().mockResolvedValue(undefined);
  const provider = { request: vi.fn() } as unknown as TraceChainWalletProvider;
  const client: MetaMaskEvmClient = {
    connect: vi.fn().mockResolvedValue({ accounts: [ACCOUNT], chainId: SEPOLIA_CHAIN_HEX }),
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
    iconUrl: 'https://tracechain.example/tracechain-mark.svg',
    isMobile: () => mobile,
    origin: 'https://tracechain.example',
    rpcUrl: 'https://rpc.example',
  });

  return { adapter, clearTransportPreference, client, factory, provider };
}

describe('MetaMask Connect adapter', () => {
  it('does not initialize MetaMask Connect until connect is requested', () => {
    const { factory } = setup();
    expect(factory).not.toHaveBeenCalled();
  });

  it('connects an extension-style provider on Sepolia', async () => {
    const { adapter, client, provider } = setup();
    const onMobileConnection = vi.fn();

    const connection = await adapter.connect({ onMobileConnection });

    expect(client.connect).toHaveBeenCalledWith({ chainIds: [SEPOLIA_CHAIN_HEX] });
    expect(connection).toEqual({
      accounts: [ACCOUNT],
      chainId: SEPOLIA_CHAIN_HEX,
      provider,
    });
    expect(onMobileConnection).not.toHaveBeenCalled();
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
    vi.mocked(expired.client.connect).mockRejectedValueOnce(
      new Error('WalletConnect session expired'),
    );
    await expect(expired.adapter.connect()).rejects.toEqual(
      expect.objectContaining<Partial<WalletConnectionError>>({
        code: 'CONNECTION_EXPIRED',
      }),
    );
  });

  it('switches only to the configured Sepolia network and disconnects cleanly', async () => {
    const { adapter, client } = setup();
    await adapter.connect();

    await adapter.switchToSepolia();
    await adapter.disconnect();

    expect(client.switchChain).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: SEPOLIA_CHAIN_HEX }),
    );
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});
