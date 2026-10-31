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
  createdAt: Date;
  expiresAt: Date;
  id: string;
}

export interface CredentialVerificationSummary {
  authorizationReady: false;
  credentialHash: string;
  credentialId: string;
  issuerDid: string;
  locallyVerified: true;
  onChainStatusChecked: false;
  role: CompanyRole;
  subjectDid: string;
  verifiedAt: Date;
}

interface AuthenticatedSessionBase {
  address: string;
  authenticated: true;
  authorizationReady: false;
  expiresAt: string;
  onChainStatusChecked: false;
}

export interface WalletOnlyAuthenticatedSession extends AuthenticatedSessionBase {
  credentialVerified: false;
  locallyVerified: false;
  message: 'Wallet verified. Company Role Credential verification is required.';
}

export interface LocallyVerifiedAuthenticatedSession extends AuthenticatedSessionBase {
  credentialId: string;
  credentialVerified: true;
  locallyVerified: true;
  message: 'Credential verified locally. Blockchain status verification is required.';
  role: CompanyRole;
  verifiedAt: string;
}

export type AuthenticatedSession =
  WalletOnlyAuthenticatedSession | LocallyVerifiedAuthenticatedSession;

export interface UnauthenticatedSession {
  authenticated: false;
}

export type SessionResponse = AuthenticatedSession | UnauthenticatedSession;
