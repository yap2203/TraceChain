import type { CompanyRole } from '@tracechain/shared';

import type { AuthenticatedSession } from '../auth/auth.types.js';

export type CredentialExpirationStatus = 'VALID' | 'EXPIRED' | 'NOT_YET_VALID' | 'UNKNOWN';

export interface CompanyRoleVerificationApiResponse {
  authorizationReady: boolean;
  credentialId?: string;
  expirationStatus: CredentialExpirationStatus;
  locallyVerified: boolean;
  onChainStatusChecked: boolean;
  reasons: string[];
  role?: CompanyRole;
  session?: AuthenticatedSession;
  verified: boolean;
}
