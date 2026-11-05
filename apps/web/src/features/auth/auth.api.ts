const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

export interface AuthenticatedSession {
  address: string;
  authenticated: true;
  authorizationReady: boolean;
  credentialId?: string;
  credentialVerified: boolean;
  expiresAt: string;
  locallyVerified: boolean;
  message: string;
  onChainStatusChecked: boolean;
  role?: CompanyRole;
  verifiedAt?: string;
}

export interface UnauthenticatedSession {
  authenticated: false;
}

export type SessionResponse = AuthenticatedSession | UnauthenticatedSession;

interface NonceResponse {
  expiresAt: string;
  nonce: string;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new AuthApiError(
      body.error?.message ?? 'Authentication could not be completed.',
      body.error?.code ?? 'AUTHENTICATION_ERROR',
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function requestNonce(address: string) {
  return apiRequest<NonceResponse>('/api/auth/nonce', {
    body: JSON.stringify({ address }),
    method: 'POST',
  });
}

export function verifySiweMessage(message: string, signature: string) {
  return apiRequest<AuthenticatedSession>('/api/auth/verify', {
    body: JSON.stringify({ message, signature }),
    method: 'POST',
  });
}

export function getAuthSession() {
  return apiRequest<SessionResponse>('/api/auth/session');
}

export function deleteAuthSession() {
  return apiRequest<void>('/api/auth/logout', { method: 'POST' });
}
import type { CompanyRole } from '@tracechain/shared';
import type { PreparedTransaction } from '../blockchain/blockchain.api';

export type CredentialFailureReason =
  | 'MALFORMED_CREDENTIAL'
  | 'INVALID_SIGNATURE'
  | 'UNTRUSTED_ISSUER'
  | 'WRONG_WALLET'
  | 'UNSUPPORTED_ROLE'
  | 'NOT_YET_VALID'
  | 'EXPIRED'
  | 'INACTIVE_STATUS';

export interface CompanyRoleVerificationResponse {
  authorizationReady: boolean;
  credentialId?: string;
  expirationStatus: 'EXPIRED' | 'NOT_YET_VALID' | 'UNKNOWN' | 'VALID';
  locallyVerified: boolean;
  onChainStatusChecked: boolean;
  reasons: CredentialFailureReason[];
  role?: CompanyRole;
  session?: AuthenticatedSession;
  verified: boolean;
}

export function verifyCompanyRoleCredential(credential: Record<string, unknown>) {
  return apiRequest<CompanyRoleVerificationResponse>('/api/ssi/company-role/verify', {
    body: JSON.stringify({ credential }),
    method: 'POST',
  });
}

export interface CompanyRoleIssuanceResponse {
  approvalTransaction?: PreparedTransaction;
  applicationStatus: number;
  credential: Record<string, unknown>;
  credentialId: string;
  credentialRegistrationTransaction?: PreparedTransaction;
  encryptedCredentialCid: string;
  issuanceState: 'APPLICATION_PENDING' | 'CREDENTIAL_ACTIVE' | 'CREDENTIAL_REGISTRATION_PENDING';
}

export function issueCompanyRoleCredential(input: {
  applicationId: string;
  approvedRole: number;
  companyName: string;
  companyRegistrationNumber: string;
  expirationDate: string;
}) {
  return apiRequest<CompanyRoleIssuanceResponse>('/api/ssi/company-role/issue', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}
