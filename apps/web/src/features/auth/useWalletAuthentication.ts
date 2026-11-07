import { useCallback, useEffect, useRef, useState } from 'react';

import type { CompanyRole } from '@tracechain/shared';
import { BrowserProvider, getAddress, isAddress } from 'ethers';

import { chainConfig, targetChainId } from '../../config/network';
import {
  AuthApiError,
  deleteAuthSession,
  getAuthSession,
  requestNonce,
  type AuthenticatedSession,
  type CompanyRoleVerificationResponse,
  type CredentialFailureReason,
  verifyCompanyRoleCredential,
  verifySiweMessage,
} from './auth.api';
import {
  metaMaskConnection,
  type MobileConnectionMode,
  type TraceChainWalletProvider,
  type WalletConnectionAdapter,
  type WalletConnectionPreference,
  WalletConnectionError,
} from './metamask-connection';

export type WalletAuthPhase =
  | 'authenticated'
  | 'connecting'
  | 'error'
  | 'idle'
  | 'mobile_connecting'
  | 'rejected'
  | 'restoring'
  | 'signing'
  | 'switch_required'
  | 'unavailable'
  | 'verifying';

export interface WalletAuthState {
  address?: string;
  authorizationReady: boolean;
  authorizationStatus?: AuthenticatedSession['authorizationStatus'];
  applicationId?: string;
  applicationSubmittedAt?: number;
  applicationUpdatedAt?: number;
  credentialId?: string;
  companyName?: string;
  credentialVerified: boolean;
  locallyVerified: boolean;
  message: string;
  mobileConnectionMode?: MobileConnectionMode;
  onChainStatusChecked: boolean;
  phase: WalletAuthPhase;
  role?: CompanyRole;
  verifiedAt?: string;
}

export type CredentialVerificationPhase = 'error' | 'idle' | 'reading' | 'success' | 'verifying';

export interface CredentialVerificationState {
  expirationStatus?: CompanyRoleVerificationResponse['expirationStatus'];
  message: string;
  phase: CredentialVerificationPhase;
  reasons: CredentialFailureReason[];
}

const emptyAuthorization = {
  authorizationReady: false,
  credentialVerified: false,
  locallyVerified: false,
  onChainStatusChecked: false,
} as const;

function stateFromSession(session: AuthenticatedSession): WalletAuthState {
  return {
    address: session.address,
    authorizationReady: session.authorizationReady,
    authorizationStatus: session.authorizationStatus,
    applicationId: session.applicationId,
    applicationSubmittedAt: session.applicationSubmittedAt,
    applicationUpdatedAt: session.applicationUpdatedAt,
    credentialId: session.credentialId,
    companyName: session.companyName,
    credentialVerified: session.credentialVerified,
    locallyVerified: session.locallyVerified,
    message: session.message,
    onChainStatusChecked: session.onChainStatusChecked,
    phase: 'authenticated',
    role: session.role,
    verifiedAt: session.verifiedAt,
  };
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
  if (error instanceof AuthApiError || error instanceof WalletConnectionError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Wallet authentication could not be completed.';
}

function chainIdOf(value: string) {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function useWalletAuthentication(
  walletConnection: WalletConnectionAdapter = metaMaskConnection,
) {
  const [state, setState] = useState<WalletAuthState>({
    ...emptyAuthorization,
    message: 'Checking for an existing session',
    phase: 'restoring',
  });
  const [credentialState, setCredentialState] = useState<CredentialVerificationState>({
    message: '',
    phase: 'idle',
    reasons: [],
  });
  const [walletProvider, setWalletProvider] = useState<TraceChainWalletProvider | undefined>(
    undefined,
  );
  const authenticatedAddress = useRef<string | undefined>(undefined);
  const connectionAttempt = useRef(0);
  const connectionInFlight = useRef(false);
  const pendingConnection = useRef<
    | {
        address: string;
        provider: TraceChainWalletProvider;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    return () => {
      connectionAttempt.current += 1;
      connectionInFlight.current = false;
    };
  }, []);

  const clearSession = useCallback(
    async (message = 'Wallet session ended') => {
      connectionAttempt.current += 1;
      connectionInFlight.current = false;
      authenticatedAddress.current = undefined;
      pendingConnection.current = undefined;
      setWalletProvider(undefined);
      setCredentialState({ message: '', phase: 'idle', reasons: [] });
      setState({ ...emptyAuthorization, message, phase: 'idle' });

      await Promise.allSettled([deleteAuthSession(), walletConnection.disconnect()]);
    },
    [walletConnection],
  );

  useEffect(() => {
    let active = true;

    void getAuthSession()
      .then((session) => {
        if (!active) return;

        if (session.authenticated) {
          authenticatedAddress.current = session.address;
          setState(stateFromSession(session));
          return;
        }

        setState({ ...emptyAuthorization, message: 'Ready to connect', phase: 'idle' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ ...emptyAuthorization, message: errorMessage(error), phase: 'error' });
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!walletProvider?.on) return;

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
      const chainId = typeof args[0] === 'string' ? chainIdOf(args[0]) : null;
      if (chainId !== targetChainId && authenticatedAddress.current) {
        void clearSession(
          `Wallet network changed. Return to ${chainConfig.name} and sign in again.`,
        );
      }
    };
    const handleDisconnect = () => {
      if (authenticatedAddress.current)
        void clearSession('Wallet disconnected. Sign in again to continue.');
    };

    walletProvider.on('accountsChanged', handleAccountsChanged);
    walletProvider.on('chainChanged', handleChainChanged);
    walletProvider.on('disconnect', handleDisconnect);

    return () => {
      walletProvider.removeListener?.('accountsChanged', handleAccountsChanged);
      walletProvider.removeListener?.('chainChanged', handleChainChanged);
      walletProvider.removeListener?.('disconnect', handleDisconnect);
    };
  }, [clearSession, walletProvider]);

  const signIn = useCallback(async (provider: BrowserProvider, address: string) => {
    try {
      const [challenge, { SiweMessage }] = await Promise.all([
        requestNonce(address),
        import('siwe'),
      ]);
      const siweMessage = new SiweMessage({
        address,
        chainId: chainConfig.chainId,
        domain: window.location.host,
        expirationTime: challenge.expiresAt,
        issuedAt: new Date().toISOString(),
        nonce: challenge.nonce,
        statement: 'Sign in to TraceChain. This proves wallet ownership only.',
        uri: window.location.origin,
        version: '1',
      }).prepareMessage();

      setState({
        ...emptyAuthorization,
        address,
        message: 'Review the sign-in request in MetaMask',
        phase: 'signing',
      });
      const signer = await provider.getSigner(address);
      const signature = await signer.signMessage(siweMessage);

      setState({
        ...emptyAuthorization,
        address,
        message: 'Verifying the wallet and checking company authorization',
        phase: 'verifying',
      });
      const session = await verifySiweMessage(siweMessage, signature);

      authenticatedAddress.current = session.address;
      pendingConnection.current = undefined;
      setState(stateFromSession(session));
    } catch (error) {
      if (isUserRejection(error)) {
        setState({
          ...emptyAuthorization,
          address,
          message: 'The MetaMask login signature was rejected.',
          phase: 'rejected',
        });
        return;
      }

      setState({ ...emptyAuthorization, address, message: errorMessage(error), phase: 'error' });
    }
  }, []);

  const connect = useCallback(
    async (preference: WalletConnectionPreference = 'automatic') => {
      if (connectionInFlight.current) return;
      connectionInFlight.current = true;
      const attempt = ++connectionAttempt.current;

      try {
        setState({
          ...emptyAuthorization,
          message: 'Opening MetaMask connection options',
          phase: 'connecting',
        });
        const connection = await walletConnection.connect(
          {
            onMobileConnection: (mode) => {
              if (attempt !== connectionAttempt.current) return;
              setState({
                ...emptyAuthorization,
                message:
                  mode === 'qr'
                    ? 'Scan with MetaMask Mobile, then approve the connection and login signature on your phone.'
                    : 'Approve the connection and login signature in MetaMask Mobile.',
                mobileConnectionMode: mode,
                phase: 'mobile_connecting',
              });
            },
          },
          preference,
        );
        if (attempt !== connectionAttempt.current) return;

        const address = connection.accounts[0] ? getAddress(connection.accounts[0]) : undefined;
        if (!address) throw new Error('MetaMask did not return a wallet account.');

        setWalletProvider(connection.provider);
        if (chainIdOf(connection.chainId) !== targetChainId) {
          pendingConnection.current = { address, provider: connection.provider };
          setState({
            ...emptyAuthorization,
            address,
            message: `${chainConfig.name} is required. Confirm the network switch to continue.`,
            phase: 'switch_required',
          });
          return;
        }

        await signIn(new BrowserProvider(connection.provider), address);
      } catch (error) {
        if (attempt !== connectionAttempt.current) return;
        if (error instanceof WalletConnectionError && error.code === 'CONNECTION_REJECTED') {
          setState({ ...emptyAuthorization, message: error.message, phase: 'rejected' });
          return;
        }

        setState({ ...emptyAuthorization, message: errorMessage(error), phase: 'error' });
      } finally {
        if (attempt === connectionAttempt.current) connectionInFlight.current = false;
      }
    },
    [signIn, walletConnection],
  );

  const cancelConnection = useCallback(async () => {
    connectionAttempt.current += 1;
    connectionInFlight.current = false;
    pendingConnection.current = undefined;
    setWalletProvider(undefined);
    setState({ ...emptyAuthorization, message: 'MetaMask connection cancelled', phase: 'idle' });

    try {
      await walletConnection.disconnect();
    } catch {
      // A pending remote session may already be closed or expired.
    }
  }, [walletConnection]);

  const switchToTargetNetwork = useCallback(async () => {
    const connection = pendingConnection.current;

    if (!connection) {
      setState({
        ...emptyAuthorization,
        message: 'Reconnect MetaMask before switching networks.',
        phase: 'error',
      });
      return;
    }

    try {
      setState({
        ...emptyAuthorization,
        address: connection.address,
        message: `Waiting for ${chainConfig.name} network confirmation`,
        phase: 'connecting',
      });
      await walletConnection.switchToTargetNetwork();
      await signIn(new BrowserProvider(connection.provider), connection.address);
    } catch (error) {
      if (isUserRejection(error)) {
        setState({
          ...emptyAuthorization,
          address: connection.address,
          message: `The ${chainConfig.name} network switch was rejected.`,
          phase: 'rejected',
        });
        return;
      }

      setState({
        ...emptyAuthorization,
        address: connection.address,
        message: errorMessage(error),
        phase: 'error',
      });
    }
  }, [signIn, walletConnection]);

  const presentCredential = useCallback(async (credential: Record<string, unknown>) => {
    setCredentialState({ message: 'Verifying credential', phase: 'verifying', reasons: [] });
    try {
      const result = await verifyCompanyRoleCredential(credential);
      if (!result.verified || !result.session) {
        setCredentialState({
          expirationStatus: result.expirationStatus,
          message: 'The credential could not be verified.',
          phase: 'error',
          reasons: result.reasons,
        });
        return;
      }

      setState(stateFromSession(result.session));
      setCredentialState({
        expirationStatus: result.expirationStatus,
        message:
          'Credential verified locally. Blockchain status verification is required before workspace access.',
        phase: 'success',
        reasons: [],
      });
    } catch (error) {
      setCredentialState({ message: errorMessage(error), phase: 'error', reasons: [] });
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const session = await getAuthSession();
      if (!session.authenticated) {
        setState({
          ...emptyAuthorization,
          message: 'Session expired. Sign in again.',
          phase: 'idle',
        });
        return;
      }
      setState(stateFromSession(session));
    } catch (error) {
      setState((current) => ({ ...current, message: errorMessage(error), phase: 'error' }));
    }
  }, []);

  return {
    cancelConnection,
    connect,
    connectMobile: () => connect('mobile'),
    credentialState,
    logout: clearSession,
    presentCredential,
    refreshSession,
    state,
    switchToTargetNetwork,
  };
}
