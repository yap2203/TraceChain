import type { Eip1193Provider } from 'ethers';
import type { createEVMClient } from '@metamask/connect-evm';

import { chainConfig, targetChainHex, targetChainId } from '../../config/network';

export const TARGET_CHAIN_ID = targetChainId;
export const TARGET_CHAIN_HEX = targetChainHex;

export type WalletProviderEvent = 'accountsChanged' | 'chainChanged' | 'disconnect';
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
  switchToTargetNetwork(): Promise<void>;
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
  getExtensionProvider: () => TraceChainWalletProvider | undefined;
  iconUrl: string;
  isMobile: () => boolean;
  origin: string;
}

const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

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
  private activeProvider?: TraceChainWalletProvider;
  private callbacks: WalletConnectionCallbacks = {};
  private connectionGeneration = 0;
  private pendingConnection?: Promise<WalletConnectionResult>;

  constructor(
    private readonly clientFactory: MetaMaskEvmClientFactory = defaultClientFactory,
    browser?: BrowserContext,
    private readonly connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
  ) {
    this.browser = browser;
  }

  async connect(
    callbacks: WalletConnectionCallbacks = {},
    preference: WalletConnectionPreference = 'automatic',
  ): Promise<WalletConnectionResult> {
    if (this.pendingConnection) return this.pendingConnection;

    this.callbacks = callbacks;
    const generation = this.connectionGeneration;
    const connection = this.connectOnce(preference, generation)
      .catch((error: unknown) => {
        throw normalizeConnectionError(error);
      })
      .finally(() => {
        if (this.pendingConnection === connection) this.pendingConnection = undefined;
        this.callbacks = {};
      });
    this.pendingConnection = connection;
    return connection;
  }

  private async connectOnce(
    preference: WalletConnectionPreference,
    generation: number,
  ): Promise<WalletConnectionResult> {
    if (preference === 'automatic') {
      const extensionProvider = this.getBrowser().getExtensionProvider();
      if (extensionProvider) return this.connectExtension(extensionProvider, generation);
    }

    return this.connectClient(preference, generation, true);
  }

  async disconnect() {
    this.connectionGeneration += 1;
    const clients = await Promise.allSettled(this.clientPromises.values());
    this.clientPromises.clear();
    this.activeClient = undefined;
    this.activeProvider = undefined;
    this.pendingConnection = undefined;
    this.callbacks = {};

    await Promise.all(
      clients.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value.disconnect()] : [],
      ),
    );
  }

  async switchToTargetNetwork() {
    const client = this.activeClient;
    if (client) {
      await client.switchChain({
        chainConfiguration: targetChainConfiguration(),
        chainId: TARGET_CHAIN_HEX,
      });
      return;
    }

    const provider = this.activeProvider;
    if (!provider) throw new Error('Connect MetaMask before switching networks.');

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: TARGET_CHAIN_HEX }],
      });
    } catch (error) {
      if (!isUnknownChainError(error)) throw error;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            ...targetChainConfiguration(),
            chainId: TARGET_CHAIN_HEX,
          },
        ],
      });
    }
  }

  private async connectExtension(
    provider: TraceChainWalletProvider,
    generation: number,
  ): Promise<WalletConnectionResult> {
    const result = await withConnectionTimeout(
      (async () => {
        const authorizedAccounts = normalizeAccounts(
          await provider.request({ method: 'eth_accounts' }),
        );
        const accounts =
          authorizedAccounts.length > 0
            ? authorizedAccounts
            : normalizeAccounts(await provider.request({ method: 'eth_requestAccounts' }));
        const chainId = await provider.request({ method: 'eth_chainId' });

        if (accounts.length === 0 || typeof chainId !== 'string') {
          throw new Error('MetaMask did not return an account and network.');
        }

        this.assertCurrentConnection(generation);
        this.activeClient = undefined;
        this.activeProvider = provider;
        return { accounts, chainId, provider };
      })(),
      this.connectionTimeoutMs,
    );

    return result;
  }

  private async connectClient(
    preference: WalletConnectionPreference,
    generation: number,
    allowStaleRetry: boolean,
  ): Promise<WalletConnectionResult> {
    if (preference === 'mobile' && !this.clientPromises.has('mobile')) {
      await this.getBrowser().clearTransportPreference();
    }

    const client = await this.getClient(preference);
    this.activeClient = client;
    this.activeProvider = undefined;

    try {
      const connection = await withConnectionTimeout(
        client.connect({ chainIds: [TARGET_CHAIN_HEX], forceRequest: false }),
        this.connectionTimeoutMs,
      );
      this.assertCurrentConnection(generation);
      const provider = client.getProvider() as TraceChainWalletProvider;
      this.activeProvider = provider;
      return {
        accounts: connection.accounts,
        chainId: connection.chainId,
        provider,
      };
    } catch (error) {
      if (
        generation !== this.connectionGeneration ||
        !allowStaleRetry ||
        !isStaleTransportError(error)
      ) {
        throw error;
      }

      await this.disconnectClient(preference, client);
      this.assertCurrentConnection(generation);
      return this.connectClient(preference, generation, false);
    }
  }

  private assertCurrentConnection(generation: number) {
    if (generation !== this.connectionGeneration) {
      throw new WalletConnectionError('CONNECTION_FAILED', 'MetaMask connection was cancelled.');
    }
  }

  private async disconnectClient(
    preference: WalletConnectionPreference,
    client: MetaMaskEvmClient,
  ) {
    this.clientPromises.delete(preference);
    if (this.activeClient === client) this.activeClient = undefined;
    try {
      await client.disconnect();
    } catch {
      // A stale transport may already be closed; removing this client is sufficient.
    }
  }

  private getClient(preference: WalletConnectionPreference) {
    let clientPromise = this.clientPromises.get(preference);
    if (!clientPromise) {
      const browser = this.getBrowser();
      clientPromise = this.clientFactory({
        analytics: { enabled: false },
        api: { supportedNetworks: { [TARGET_CHAIN_HEX]: chainConfig.rpcUrl } },
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
        skipAutoAnnounce: true,
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
  'CONNECTION_EXPIRED' | 'CONNECTION_FAILED' | 'CONNECTION_REJECTED' | 'CONNECTION_TIMEOUT';

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

function isStaleTransportError(error: unknown) {
  const normalized = normalizeConnectionError(error);
  if (normalized.code === 'CONNECTION_EXPIRED' || normalized.code === 'CONNECTION_TIMEOUT') {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  return /orphaned data|unknown response id|stale|transport.*closed|session.*closed/i.test(message);
}

function normalizeAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((account): account is string => typeof account === 'string');
}

function targetChainConfiguration() {
  return {
    chainName: chainConfig.name,
    nativeCurrency: {
      decimals: 18,
      name: chainConfig.currencySymbol,
      symbol: chainConfig.currencySymbol,
    },
    rpcUrls: [chainConfig.rpcUrl],
  };
}

function isUnknownChainError(error: unknown) {
  const candidate = error as { code?: number; data?: { originalError?: { code?: number } } };
  return candidate?.code === 4902 || candidate?.data?.originalError?.code === 4902;
}

function withConnectionTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(
        new WalletConnectionError(
          'CONNECTION_TIMEOUT',
          'MetaMask did not respond in time. Cancel or try the connection again.',
        ),
      );
    }, timeoutMs);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function browserContext(): BrowserContext {
  const origin = window.location.origin;
  return {
    clearTransportPreference: clearPersistedMetaMaskTransportPreference,
    getExtensionProvider: findMetaMaskExtensionProvider,
    iconUrl: new URL('/tracechain-mark.svg', origin).toString(),
    isMobile: () => /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent),
    origin,
  };
}

function findMetaMaskExtensionProvider(): TraceChainWalletProvider | undefined {
  const injected = window.ethereum as
    | (TraceChainWalletProvider & {
        isMetaMask?: boolean;
        providers?: Array<TraceChainWalletProvider & { isMetaMask?: boolean }>;
      })
    | undefined;
  if (!injected) return undefined;

  return (
    injected.providers?.find((provider) => provider.isMetaMask) ??
    (injected.isMetaMask ? injected : undefined)
  );
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
