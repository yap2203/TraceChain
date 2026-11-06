import type { WalletAuthPhase } from './useWalletAuthentication';

interface LoginAuthPresentationInput {
  authorizationReady?: boolean;
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
  const locallyVerified = false;

  if (authenticated && state.authorizationReady) {
    return {
      authenticated,
      authenticationTitle: 'Company access verified',
      heroActionLabel: 'Open workspace',
      locallyVerified,
      securityActionLabel: 'Open workspace',
    };
  }

  if (authenticated) {
    return {
      authenticated,
      authenticationTitle: 'Company access status',
      heroActionLabel: 'View authorization status',
      locallyVerified,
      securityActionLabel: 'View authorization status',
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
