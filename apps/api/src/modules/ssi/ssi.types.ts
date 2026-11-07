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

export type IdentityCheckStatus = 'FAILED' | 'PASSED' | 'UNAVAILABLE';

export interface CompanyIdentityCheck {
  detail: string;
  label: string;
  status: IdentityCheckStatus;
}

export interface CompanyIdentityVerification {
  checks: CompanyIdentityCheck[];
  outcome: 'CHECKS_FAILED' | 'CHECKS_PASSED' | 'SERVICE_UNAVAILABLE';
  verifiedAt: string;
}

export interface CompanyIdentityResponse {
  identity: {
    applicationReference: string;
    associatedWallet: string;
    chainId: number;
    companyName: string;
    companyRegistrationNumber: string;
    credentialHash: string;
    credentialId: string;
    encryptedCredentialCid: string;
    expiresAt: string;
    issuerDid: string;
    issuerName: string;
    issuedAt: string;
    lifecycleStatus: 'ACTIVE' | 'EXPIRED' | 'REPLACED' | 'REVOKED' | 'SUSPENDED' | 'UNKNOWN';
    registryCredentialId: string;
    registryReferences: {
      credentialRegistry: string;
      stakeholderRegistry: string;
    };
    role: CompanyRole;
    subjectDid: string;
    updatedAt: string;
  };
  verification?: CompanyIdentityVerification;
}
