import { useCallback, useEffect, useRef, useState } from 'react';

import { BrowserProvider, getAddress, isAddress, type Eip1193Provider } from 'ethers';

import {
  AuthApiError,
  deleteAuthSession,
  getAuthSession,
  requestNonce,
  verifySiweMessage,
} from './auth.api';

const SEPOLIA_CHAIN_ID = 11155111n;
const SEPOLIA_CHAIN_HEX = '0xaa36a7';
const VERIFIED_MESSAGE = 'Wallet verified. Company Role Credential verification is required.';

type ProviderEvent = 'accountsChanged' | 'chainChanged';

interface InjectedProvider extends Eip1193Provider {
  isMetaMask?: boolean;
  on?(event: ProviderEvent, listener: (...args: unknown[]) => void): void;
  removeListener?(event: ProviderEvent, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

export type WalletAuthPhase =
  | 'authenticated'
  | 'connecting'
  | 'error'
  | 'idle'
  | 'rejected'
  | 'restoring'
  | 'signing'
  | 'switch_required'
  | 'unavailable'
  | 'verifying';

interface WalletAuthState {
  address?: string;
  message: string;
  phase: WalletAuthPhase;
}

function getInjectedMetaMask() {
  const provider = window.ethereum;
  return provider?.isMetaMask ? provider : undefined;
}

function isUserRejection(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: number | string; info?: { error?: { code?: number } } };
  return (
    candidate.code === 4001 ||
    candidate.code === 'ACTION_REJECTED' ||
    candidate.info?.error?.code === 4001
  );
}

function errorMessage(error: unknown) {
  if (error instanceof AuthApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Wallet authentication could not be completed.';
}

export function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function useWalletAuthentication() {
  const [state, setState] = useState<WalletAuthState>({
    message: 'Checking for an existing session',
    phase: 'restoring',
  });
  const authenticatedAddress = useRef<string | undefined>(undefined);
  const pendingAddress = useRef<string | undefined>(undefined);

  const clearSession = useCallback(async (message = 'Wallet session ended') => {
    try {
      await deleteAuthSession();
    } catch {
      // Local state is still cleared when the API cannot be reached.
    }

    authenticatedAddress.current = undefined;
    pendingAddress.current = undefined;
    setState({ message, phase: getInjectedMetaMask() ? 'idle' : 'unavailable' });
  }, []);

  useEffect(() => {
    let active = true;

    void getAuthSession()
      .then((session) => {
        if (!active) return;

        if (session.authenticated) {
          authenticatedAddress.current = session.address;
          setState({ address: session.address, message: session.message, phase: 'authenticated' });
          return;
        }

        setState({
          message: getInjectedMetaMask() ? 'Ready to connect' : 'MetaMask was not detected',
          phase: getInjectedMetaMask() ? 'idle' : 'unavailable',
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ message: errorMessage(error), phase: 'error' });
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const injectedProvider = getInjectedMetaMask();
    if (!injectedProvider?.on) return;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      const activeAddress = authenticatedAddress.current;
      const nextAddress = accounts[0] && isAddress(accounts[0]) ? getAddress(accounts[0]) : null;

      if (
        activeAddress &&
        (!nextAddress || nextAddress.toLowerCase() !== activeAddress.toLowerCase())
      ) {
        void clearSession('Wallet account changed. Sign in again to continue.');
      }
    };

    const handleChainChanged = (...args: unknown[]) => {
      let chainId: bigint | null = null;

      try {
        chainId = typeof args[0] === 'string' ? BigInt(args[0]) : null;
      } catch {
        chainId = null;
      }

      if (chainId !== SEPOLIA_CHAIN_ID && authenticatedAddress.current) {
        void clearSession('Wallet network changed. Return to Sepolia and sign in again.');
      }
    };

    injectedProvider.on('accountsChanged', handleAccountsChanged);
    injectedProvider.on('chainChanged', handleChainChanged);

    return () => {
      injectedProvider.removeListener?.('accountsChanged', handleAccountsChanged);
      injectedProvider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [clearSession]);

  const signIn = useCallback(async (provider: BrowserProvider, address: string) => {
    try {
      const [challenge, { SiweMessage }] = await Promise.all([
        requestNonce(address),
        import('siwe'),
      ]);
      const siweMessage = new SiweMessage({
        address,
        chainId: Number(SEPOLIA_CHAIN_ID),
        domain: window.location.host,
        expirationTime: challenge.expiresAt,
        issuedAt: new Date().toISOString(),
        nonce: challenge.nonce,
        statement: 'Sign in to TraceChain. This proves wallet ownership only.',
        uri: window.location.origin,
        version: '1',
      }).prepareMessage();

      setState({ address, message: 'Review the sign-in request in MetaMask', phase: 'signing' });
      const signer = await provider.getSigner(address);
      const signature = await signer.signMessage(siweMessage);

      setState({ address, message: 'Verifying the wallet signature', phase: 'verifying' });
      const session = await verifySiweMessage(siweMessage, signature);

      authenticatedAddress.current = session.address;
      pendingAddress.current = undefined;
      setState({ address: session.address, message: VERIFIED_MESSAGE, phase: 'authenticated' });
    } catch (error) {
      if (isUserRejection(error)) {
        setState({ address, message: 'The MetaMask request was rejected.', phase: 'rejected' });
        return;
      }

      setState({ address, message: errorMessage(error), phase: 'error' });
    }
  }, []);

  const connect = useCallback(async () => {
    const injectedProvider = getInjectedMetaMask();

    if (!injectedProvider) {
      setState({ message: 'MetaMask was not detected in this browser.', phase: 'unavailable' });
      return;
    }

    try {
      setState({ message: 'Waiting for MetaMask account access', phase: 'connecting' });
      const provider = new BrowserProvider(injectedProvider);
      const accounts = (await provider.send('eth_requestAccounts', [])) as string[];
      const address = accounts[0] ? getAddress(accounts[0]) : undefined;

      if (!address) throw new Error('MetaMask did not return a wallet account.');

      const network = await provider.getNetwork();
      if (network.chainId !== SEPOLIA_CHAIN_ID) {
        pendingAddress.current = address;
        setState({
          address,
          message: 'Sepolia is required. Confirm the network switch to continue.',
          phase: 'switch_required',
        });
        return;
      }

      await signIn(provider, address);
    } catch (error) {
      if (isUserRejection(error)) {
        setState({ message: 'The MetaMask connection request was rejected.', phase: 'rejected' });
        return;
      }

      setState({ message: errorMessage(error), phase: 'error' });
    }
  }, [signIn]);

  const switchToSepolia = useCallback(async () => {
    const injectedProvider = getInjectedMetaMask();
    const address = pendingAddress.current;

    if (!injectedProvider || !address) {
      setState({ message: 'Reconnect MetaMask before switching networks.', phase: 'error' });
      return;
    }

    try {
      setState({
        address,
        message: 'Waiting for Sepolia network confirmation',
        phase: 'connecting',
      });
      await injectedProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_HEX }],
      });
      await signIn(new BrowserProvider(injectedProvider), address);
    } catch (error) {
      if (isUserRejection(error)) {
        setState({
          address,
          message: 'The Sepolia network switch was rejected.',
          phase: 'rejected',
        });
        return;
      }

      setState({ address, message: errorMessage(error), phase: 'error' });
    }
  }, [signIn]);

  return {
    connect,
    logout: clearSession,
    state,
    switchToSepolia,
  };
}
