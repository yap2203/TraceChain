import { randomBytes } from 'node:crypto';

import { getAddress } from 'ethers';
import { SiweMessage } from 'siwe';

import type { NonceRepository, SessionRepository } from './auth.repository.js';
import { walletAddressSchema } from './auth.schema.js';
import type {
  AuthConfiguration,
  AuthenticatedSession,
  NonceRecord,
  SessionRecord,
  SessionResponse,
} from './auth.types.js';

const AUTHENTICATED_MESSAGE =
  'Wallet verified. Company Role Credential verification is required.' as const;
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

  constructor({
    clock = () => new Date(),
    configuration,
    nonceRepository,
    sessionRepository,
  }: AuthServiceDependencies) {
    this.clock = clock;
    this.configuration = configuration;
    this.nonceRepository = nonceRepository;
    this.sessionRepository = sessionRepository;
  }

  async createNonce(addressInput: string) {
    const address = getAddress(walletAddressSchema.parse(addressInput));
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

    await this.sessionRepository.save(session);

    return {
      response: this.toAuthenticatedSession(session),
      sessionId: session.id,
    };
  }

  async getSession(sessionId?: string): Promise<SessionResponse> {
    if (!sessionId) return { authenticated: false };

    const session = await this.sessionRepository.find(sessionId, this.clock());
    return session ? this.toAuthenticatedSession(session) : { authenticated: false };
  }

  async logout(sessionId?: string) {
    if (sessionId) await this.sessionRepository.delete(sessionId);
  }

  private invalidNonceError() {
    return new AuthError('INVALID_NONCE', 'The nonce is missing, expired, or already used.', 401);
  }

  private toAuthenticatedSession(session: SessionRecord): AuthenticatedSession {
    return {
      address: session.address,
      authenticated: true,
      credentialVerified: false,
      expiresAt: session.expiresAt.toISOString(),
      message: AUTHENTICATED_MESSAGE,
    };
  }
}
