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
  createdAt: Date;
  expiresAt: Date;
  id: string;
}

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
