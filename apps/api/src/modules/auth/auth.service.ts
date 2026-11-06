import { randomBytes } from 'node:crypto';

import { getAddress } from 'ethers';
import { SiweMessage } from 'siwe';

import type { LoginAuthorizationResolver } from '../blockchain/login-authorization.service.js';
import type { NonceRepository, SessionRepository } from './auth.repository.js';
import { walletAddressSchema } from './auth.schema.js';
import type {
  AuthConfiguration,
  AuthenticatedSession,
  CredentialVerificationSummary,
  NonceRecord,
  SessionRecord,
  SessionResponse,
} from './auth.types.js';

const AUTHORIZED_MESSAGE =
  'Wallet verified and currently authorized by the configured registries.' as const;
const CLOCK_SKEW_MS = 60_000;

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface AuthServiceDependencies {
  authorizationResolver?: LoginAuthorizationResolver;
  clock?: () => Date;
  configuration: AuthConfiguration;
  nonceRepository: NonceRepository;
  sessionRepository: SessionRepository;
}

export class AuthService {
  private readonly clock: () => Date;
  private readonly configuration: AuthConfiguration;
  private readonly nonceRepository: NonceRepository;
  private readonly sessionRepository: SessionRepository;
  private readonly authorizationResolver?: LoginAuthorizationResolver;
  private readonly attempts = new Map<string, number[]>();

  constructor({
    authorizationResolver,
    clock = () => new Date(),
    configuration,
    nonceRepository,
    sessionRepository,
  }: AuthServiceDependencies) {
    this.clock = clock;
    this.authorizationResolver = authorizationResolver;
    this.configuration = configuration;
    this.nonceRepository = nonceRepository;
    this.sessionRepository = sessionRepository;
  }

  async createNonce(addressInput: string) {
    const address = getAddress(walletAddressSchema.parse(addressInput));
    this.checkRateLimit(`nonce:${address}`, 20);
    const createdAt = this.clock();
    const record: NonceRecord = {
      address,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + this.configuration.nonceTtlMs),
      nonce: randomBytes(16).toString('hex'),
    };

    await this.nonceRepository.save(record);

    return {
      nonce: record.nonce,
      expiresAt: record.expiresAt.toISOString(),
    };
  }

  async verify(messageInput: string, signature: string) {
    const now = this.clock();
    let message: SiweMessage;

    try {
      message = new SiweMessage(messageInput);
    } catch {
      throw new AuthError('INVALID_MESSAGE', 'The SIWE message is malformed.', 400);
    }

    const parsedAddress = walletAddressSchema.safeParse(message.address);
    if (!parsedAddress.success) {
      throw new AuthError('INVALID_ADDRESS', 'The SIWE wallet address is invalid.', 401);
    }
    this.checkRateLimit(`verify:${getAddress(parsedAddress.data)}`, 10);

    if (message.domain !== this.configuration.domain) {
      throw new AuthError('INVALID_DOMAIN', 'The SIWE domain is not accepted.', 401);
    }

    if (message.uri !== this.configuration.uri) {
      throw new AuthError('INVALID_URI', 'The SIWE URI is not accepted.', 401);
    }

    if (message.chainId !== this.configuration.chainId) {
      throw new AuthError('INVALID_CHAIN', 'The SIWE chain ID is not accepted.', 401);
    }

    const nonceRecord = await this.nonceRepository.find(message.nonce);
    if (
      !nonceRecord ||
      nonceRecord.consumedAt ||
      nonceRecord.expiresAt.getTime() <= now.getTime()
    ) {
      throw this.invalidNonceError();
    }

    if (getAddress(message.address) !== nonceRecord.address) {
      throw new AuthError('ADDRESS_MISMATCH', 'The nonce was not issued for this wallet.', 401);
    }

    const issuedAt = message.issuedAt ? new Date(message.issuedAt) : null;
    if (
      !issuedAt ||
      Number.isNaN(issuedAt.getTime()) ||
      issuedAt.getTime() < nonceRecord.createdAt.getTime() - CLOCK_SKEW_MS ||
      issuedAt.getTime() > now.getTime() + CLOCK_SKEW_MS
    ) {
      throw new AuthError('INVALID_ISSUED_AT', 'The SIWE issue time is not accepted.', 401);
    }

    const expirationTime = message.expirationTime ? new Date(message.expirationTime) : null;
    if (
      !expirationTime ||
      Number.isNaN(expirationTime.getTime()) ||
      expirationTime.getTime() <= now.getTime() ||
      expirationTime.getTime() <= issuedAt.getTime() ||
      expirationTime.getTime() > nonceRecord.expiresAt.getTime()
    ) {
      throw new AuthError('INVALID_EXPIRATION', 'The SIWE expiration time is not accepted.', 401);
    }

    const verification = await message.verify(
      {
        domain: this.configuration.domain,
        nonce: message.nonce,
        signature,
        time: now.toISOString(),
      },
      { suppressExceptions: true },
    );

    if (!verification.success) {
      throw new AuthError('INVALID_SIGNATURE', 'The wallet signature is invalid.', 401);
    }

    const consumedNonce = await this.nonceRepository.consume(message.nonce, now);
    if (!consumedNonce) throw this.invalidNonceError();

    const recoveredAddress = getAddress(verification.data.address);
    const session: SessionRecord = {
      address: recoveredAddress,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.configuration.sessionTtlMs),
      id: randomBytes(32).toString('base64url'),
    };

    const authorizedSession = await this.refreshAuthorization(session);
    await this.sessionRepository.save(authorizedSession);

    return {
      response: this.toAuthenticatedSession(authorizedSession),
      sessionId: session.id,
    };
  }

  async getSession(sessionId?: string): Promise<SessionResponse> {
    if (!sessionId) return { authenticated: false };

    const session = await this.sessionRepository.find(sessionId, this.clock());
    if (!session) return { authenticated: false };
    const refreshed = await this.refreshAuthorization(session);
    await this.sessionRepository.save(refreshed);
    return this.toAuthenticatedSession(refreshed);
  }

  async requireSession(sessionId?: string): Promise<SessionRecord> {
    if (!sessionId) {
      throw new AuthError('AUTHENTICATION_REQUIRED', 'Wallet authentication is required.', 401);
    }

    const session = await this.sessionRepository.find(sessionId, this.clock());
    if (!session) {
      throw new AuthError('AUTHENTICATION_REQUIRED', 'Wallet authentication is required.', 401);
    }

    const refreshed = await this.refreshAuthorization(session);
    await this.sessionRepository.save(refreshed);
    return refreshed;
  }

  async setCredentialVerification(
    sessionId: string,
    summary: CredentialVerificationSummary,
  ): Promise<AuthenticatedSession> {
    const session = await this.requireSession(sessionId);
    const updatedSession: SessionRecord = { ...session, credentialVerification: summary };
    await this.sessionRepository.save(updatedSession);
    return this.toAuthenticatedSession(updatedSession);
  }

  async logout(sessionId?: string) {
    if (sessionId) await this.sessionRepository.delete(sessionId);
  }

  private invalidNonceError() {
    return new AuthError('INVALID_NONCE', 'The nonce is missing, expired, or already used.', 401);
  }

  private toAuthenticatedSession(session: SessionRecord): AuthenticatedSession {
    const verification = session.credentialVerification;
    const authorization = session.onChainAuthorization;
    const authorizationReady = authorization?.status === 'AUTHORIZED';
    const common = {
      address: session.address,
      applicationId: authorization?.applicationId,
      applicationSubmittedAt: authorization?.applicationSubmittedAt,
      applicationUpdatedAt: authorization?.applicationUpdatedAt,
      authenticated: true as const,
      authorizationReady,
      authorizationStatus: authorization?.status ?? 'UNAVAILABLE',
      credentialId: authorization?.credentialId,
      expiresAt: session.expiresAt.toISOString(),
      onChainStatusChecked: authorization?.status !== 'UNAVAILABLE',
      role: authorizationReady ? authorization.role : undefined,
    };
    if (verification?.locallyVerified) {
      return {
        ...common,
        credentialId: common.credentialId ?? verification.credentialId,
        credentialVerified: true,
        locallyVerified: true,
        message: authorizationReady
          ? AUTHORIZED_MESSAGE
          : authorizationMessage(authorization?.status),
        role: common.role ?? verification.role,
        verifiedAt: verification.verifiedAt.toISOString(),
      };
    }

    return {
      ...common,
      credentialVerified: false,
      locallyVerified: false,
      message: authorizationMessage(authorization?.status),
    };
  }

  private async refreshAuthorization(session: SessionRecord): Promise<SessionRecord> {
    const onChainAuthorization = this.authorizationResolver
      ? await this.authorizationResolver.resolve(session.address)
      : (session.onChainAuthorization ?? {
          checkedAt: this.clock(),
          status: 'UNAVAILABLE' as const,
        });
    return { ...session, onChainAuthorization };
  }

  private checkRateLimit(key: string, limit: number) {
    const now = this.clock().getTime();
    if (this.attempts.size >= 10_000) {
      for (const [candidate, times] of this.attempts) {
        if (!times.some((time) => now - time < 60_000)) this.attempts.delete(candidate);
      }
      if (!this.attempts.has(key) && this.attempts.size >= 10_000)
        throw new AuthError(
          'RATE_LIMITED',
          'Authentication is temporarily busy. Try again shortly.',
          429,
        );
    }
    const recent = (this.attempts.get(key) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= limit)
      throw new AuthError(
        'RATE_LIMITED',
        'Too many authentication attempts. Try again shortly.',
        429,
      );
    recent.push(now);
    this.attempts.set(key, recent);
  }
}

function authorizationMessage(status?: string) {
  return (
    {
      ACTIVATION_PENDING: 'Approval complete — credential activation pending.',
      ADDITIONAL_EVIDENCE_REQUIRED: 'Additional evidence is required for the company application.',
      APPLICATION_PENDING: 'The company application is awaiting administrator review.',
      APPLICATION_REJECTED:
        'The company application was rejected. Review its status before reapplying.',
      AUTHORIZED: 'Wallet verified and currently authorized by the configured registries.',
      EXPIRED: 'The company authorization or credential has expired.',
      REVOKED: 'The company authorization has been revoked.',
      SUSPENDED: 'The company authorization is suspended.',
      UNAVAILABLE: 'Wallet verified, but on-chain authorization is temporarily unavailable.',
      UNAUTHORIZED: 'The wallet does not satisfy the current registry authorization rules.',
      UNREGISTERED: 'No company registration was found for this wallet.',
    } as Record<string, string>
  )[status ?? 'UNAVAILABLE'];
}
