import type { WalletAuthPhase } from './useWalletAuthentication';

interface LoginAuthPresentationInput {
  credentialVerified: boolean;
  locallyVerified: boolean;
  phase: WalletAuthPhase;
}

export interface LoginAuthPresentation {
  authenticated: boolean;
  authenticationTitle: string;
  heroActionLabel: string;
  locallyVerified: boolean;
  securityActionLabel: string;
}

export function getLoginAuthPresentation(state: LoginAuthPresentationInput): LoginAuthPresentation {
  const authenticated = state.phase === 'authenticated';
  const locallyVerified = authenticated && state.credentialVerified && state.locallyVerified;

  if (locallyVerified) {
    return {
      authenticated,
      authenticationTitle: 'Role verified locally',
      heroActionLabel: 'View authorization status',
      locallyVerified,
      securityActionLabel: 'View authorization status',
    };
  }

  if (authenticated) {
    return {
      authenticated,
      authenticationTitle: 'Wallet connected',
      heroActionLabel: 'Continue verification',
      locallyVerified,
      securityActionLabel: 'Continue verification',
    };
  }

  return {
    authenticated,
    authenticationTitle: 'Connect to TraceChain',
    heroActionLabel: 'Get started',
    locallyVerified,
    securityActionLabel: 'Get started',
  };
}

export function credentialFailureHeading(hasVerifiedCredential: boolean) {
  return hasVerifiedCredential ? 'Selected replacement was rejected' : 'Verification unsuccessful';
}
