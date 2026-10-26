const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

export interface AuthenticatedSession {
  address: string;
  authenticated: true;
  credentialVerified: false;
  expiresAt: string;
  message: 'Wallet verified. Company Role Credential verification is required.';
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

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/auth${path}`, {
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
  return authRequest<NonceResponse>('/nonce', {
    body: JSON.stringify({ address }),
    method: 'POST',
  });
}

export function verifySiweMessage(message: string, signature: string) {
  return authRequest<AuthenticatedSession>('/verify', {
    body: JSON.stringify({ message, signature }),
    method: 'POST',
  });
}

export function getAuthSession() {
  return authRequest<SessionResponse>('/session');
}

export function deleteAuthSession() {
  return authRequest<void>('/logout', { method: 'POST' });
}
