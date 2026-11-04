import type { Eip1193Provider } from 'ethers';
import type { createEVMClient } from '@metamask/connect-evm';

export const SEPOLIA_CHAIN_ID = 11_155_111n;
export const SEPOLIA_CHAIN_HEX = '0xaa36a7' as const;

export type WalletProviderEvent = 'accountsChanged' | 'chainChanged';
export type MobileConnectionMode = 'deeplink' | 'qr';
export type WalletConnectionPreference = 'automatic' | 'mobile';

export interface TraceChainWalletProvider extends Eip1193Provider {
  on?(event: WalletProviderEvent, listener: (...args: unknown[]) => void): void;
  removeListener?(event: WalletProviderEvent, listener: (...args: unknown[]) => void): void;
}

export interface WalletConnectionResult {
  accounts: readonly string[];
  chainId: string;
  provider: TraceChainWalletProvider;
}

export interface WalletConnectionCallbacks {
  onMobileConnection?(mode: MobileConnectionMode): void;
}

export interface WalletConnectionAdapter {
  connect(
    callbacks?: WalletConnectionCallbacks,
    preference?: WalletConnectionPreference,
  ): Promise<WalletConnectionResult>;
  disconnect(): Promise<void>;
  switchToSepolia(): Promise<void>;
}

type EvmClientOptions = Parameters<typeof createEVMClient>[0];
export interface MetaMaskEvmClient {
  connect(options?: {
    account?: string;
    chainIds?: `0x${string}`[];
    forceRequest?: boolean;
  }): Promise<{
    accounts: `0x${string}`[];
    chainId: `0x${string}`;
  }>;
  disconnect(): Promise<void>;
  getProvider(): TraceChainWalletProvider;
  switchChain(options: {
    chainConfiguration?: {
      blockExplorerUrls?: string[];
      chainId?: string;
      chainName?: string;
      nativeCurrency?: { decimals?: number; name?: string; symbol?: string };
      rpcUrls?: string[];
    };
    chainId: `0x${string}`;
  }): Promise<void>;
}

export type MetaMaskEvmClientFactory = (options: EvmClientOptions) => Promise<MetaMaskEvmClient>;

interface BrowserContext {
  clearTransportPreference: () => Promise<void>;
  iconUrl: string;
  isMobile: () => boolean;
  origin: string;
  rpcUrl: string;
}

const defaultClientFactory: MetaMaskEvmClientFactory = async (options) => {
  const { createEVMClient: createClient } = await import('@metamask/connect-evm');
  return createClient(options);
};

export class MetaMaskConnectionAdapter implements WalletConnectionAdapter {
  private browser?: BrowserContext;
  private readonly clientPromises = new Map<
    WalletConnectionPreference,
    Promise<MetaMaskEvmClient>
  >();
  private activeClient?: MetaMaskEvmClient;
  private callbacks: WalletConnectionCallbacks = {};

  constructor(
    private readonly clientFactory: MetaMaskEvmClientFactory = defaultClientFactory,
    browser?: BrowserContext,
  ) {
    this.browser = browser;
  }

  async connect(
    callbacks: WalletConnectionCallbacks = {},
    preference: WalletConnectionPreference = 'automatic',
  ): Promise<WalletConnectionResult> {
    this.callbacks = callbacks;

    try {
      if (preference === 'mobile' && !this.clientPromises.has('mobile')) {
        await this.getBrowser().clearTransportPreference();
      }
      const client = await this.getClient(preference);
      this.activeClient = client;
      const connection = await client.connect({ chainIds: [SEPOLIA_CHAIN_HEX] });
      return {
        accounts: connection.accounts,
        chainId: connection.chainId,
        provider: client.getProvider() as TraceChainWalletProvider,
      };
    } catch (error) {
      throw normalizeConnectionError(error);
    } finally {
      this.callbacks = {};
    }
  }

  async disconnect() {
    const clients = await Promise.allSettled(this.clientPromises.values());
    this.clientPromises.clear();
    this.activeClient = undefined;

    await Promise.all(
      clients.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value.disconnect()] : [],
      ),
    );
  }

  async switchToSepolia() {
    const client = this.activeClient;
    if (!client) throw new Error('Connect MetaMask before switching networks.');
    const browser = this.getBrowser();
    await client.switchChain({
      chainConfiguration: {
        blockExplorerUrls: ['https://sepolia.etherscan.io'],
        chainId: SEPOLIA_CHAIN_HEX,
        chainName: 'Ethereum Sepolia',
        nativeCurrency: { decimals: 18, name: 'Sepolia Ether', symbol: 'ETH' },
        rpcUrls: [browser.rpcUrl],
      },
      chainId: SEPOLIA_CHAIN_HEX,
    });
  }

  private getClient(preference: WalletConnectionPreference) {
    let clientPromise = this.clientPromises.get(preference);
    if (!clientPromise) {
      const browser = this.getBrowser();
      clientPromise = this.clientFactory({
        analytics: { enabled: false },
        api: { supportedNetworks: { [SEPOLIA_CHAIN_HEX]: browser.rpcUrl } },
        dapp: {
          iconUrl: browser.iconUrl,
          name: 'TraceChain',
          url: browser.origin,
        },
        eventHandlers: {
          displayUri: () => {
            this.callbacks.onMobileConnection?.(browser.isMobile() ? 'deeplink' : 'qr');
          },
        },
        ui: {
          headless: false,
          preferExtension: preference === 'automatic',
          showInstallModal: true,
        },
      }).catch((error: unknown) => {
        this.clientPromises.delete(preference);
        throw error;
      });
      this.clientPromises.set(preference, clientPromise);
    }
    return clientPromise;
  }

  private getBrowser() {
    this.browser ??= browserContext();
    return this.browser;
  }
}

export type WalletConnectionErrorCode =
  'CONNECTION_EXPIRED' | 'CONNECTION_FAILED' | 'CONNECTION_REJECTED';

export class WalletConnectionError extends Error {
  constructor(
    readonly code: WalletConnectionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function normalizeConnectionError(error: unknown) {
  if (error instanceof WalletConnectionError) return error;
  const candidate = error as {
    code?: number | string;
    info?: { error?: { code?: number } };
    message?: string;
  };
  const message = candidate?.message ?? '';

  if (
    candidate?.code === 4001 ||
    candidate?.code === 'ACTION_REJECTED' ||
    candidate?.info?.error?.code === 4001
  ) {
    return new WalletConnectionError(
      'CONNECTION_REJECTED',
      'The MetaMask connection request was rejected.',
      { cause: error },
    );
  }

  if (/expired|timed?\s*out|timeout|session.*closed/i.test(message)) {
    return new WalletConnectionError(
      'CONNECTION_EXPIRED',
      'The MetaMask Mobile QR session expired. Try again to create a new connection.',
      { cause: error },
    );
  }

  return new WalletConnectionError(
    'CONNECTION_FAILED',
    'MetaMask could not connect. Check your wallet or relay connection and try again.',
    { cause: error },
  );
}

function browserContext(): BrowserContext {
  const origin = window.location.origin;
  return {
    clearTransportPreference: clearPersistedMetaMaskTransportPreference,
    iconUrl: new URL('/tracechain-mark.svg', origin).toString(),
    isMobile: () => /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent),
    origin,
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
  };
}

async function clearPersistedMetaMaskTransportPreference() {
  if (!window.indexedDB) return;

  await new Promise<void>((resolve) => {
    const request = window.indexedDB.open('mmconnect-kv-store');

    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve();
    };
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('sdk-kv-store')) {
        database.close();
        resolve();
        return;
      }

      const transaction = database.transaction('sdk-kv-store', 'readwrite');
      transaction.objectStore('sdk-kv-store').delete('multichain-transport');
      transaction.onabort = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        resolve();
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
    };
  });
}

export const metaMaskConnection = new MetaMaskConnectionAdapter();
