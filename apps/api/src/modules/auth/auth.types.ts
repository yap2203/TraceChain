import type { CompanyRole } from '@tracechain/shared';

export interface AuthConfiguration {
  chainId: number;
  domain: string;
  nonceTtlMs: number;
  sessionTtlMs: number;
  uri: string;
}

export interface NonceRecord {
  address: string;
  consumedAt?: Date;
  createdAt: Date;
  expiresAt: Date;
  nonce: string;
}

export interface SessionRecord {
  address: string;
  credentialVerification?: CredentialVerificationSummary;
  onChainAuthorization?: OnChainAuthorizationSummary;
  createdAt: Date;
  expiresAt: Date;
  id: string;
}

export type OnChainAuthorizationStatus =
  | 'AUTHORIZED'
  | 'UNREGISTERED'
  | 'APPLICATION_PENDING'
  | 'ADDITIONAL_EVIDENCE_REQUIRED'
  | 'APPLICATION_REJECTED'
  | 'ACTIVATION_PENDING'
  | 'SUSPENDED'
  | 'REVOKED'
  | 'EXPIRED'
  | 'UNAUTHORIZED'
  | 'UNAVAILABLE';

export interface OnChainAuthorizationSummary {
  applicationId?: string;
  applicationSubmittedAt?: number;
  applicationUpdatedAt?: number;
  checkedAt: Date;
  credentialHash?: string;
  credentialId?: string;
  companyName?: string;
  role?: CompanyRole;
  status: OnChainAuthorizationStatus;
}

export interface CredentialVerificationSummary {
  authorizationReady: boolean;
  credentialHash: string;
  credentialId: string;
  issuerDid: string;
  locallyVerified: true;
  onChainStatusChecked: boolean;
  role: CompanyRole;
  subjectDid: string;
  verifiedAt: Date;
}

interface AuthenticatedSessionBase {
  address: string;
  authenticated: true;
  authorizationReady: boolean;
  expiresAt: string;
  onChainStatusChecked: boolean;
  authorizationStatus: OnChainAuthorizationStatus;
  applicationId?: string;
  applicationSubmittedAt?: number;
  applicationUpdatedAt?: number;
  credentialId?: string;
  companyName?: string;
  role?: CompanyRole;
  verifiedAt?: string;
}

export interface WalletOnlyAuthenticatedSession extends AuthenticatedSessionBase {
  credentialVerified: false;
  locallyVerified: false;
  message: string;
}

export interface LocallyVerifiedAuthenticatedSession extends AuthenticatedSessionBase {
  credentialId: string;
  credentialVerified: true;
  locallyVerified: true;
  message: string;
  role: CompanyRole;
  verifiedAt: string;
}

export type AuthenticatedSession =
  WalletOnlyAuthenticatedSession | LocallyVerifiedAuthenticatedSession;

export interface UnauthenticatedSession {
  authenticated: false;
}

export type SessionResponse = AuthenticatedSession | UnauthenticatedSession;
