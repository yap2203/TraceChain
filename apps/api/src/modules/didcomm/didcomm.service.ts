import { randomBytes } from 'node:crypto';
import { CompanyRole } from '@tracechain/shared';
import { Resolver } from 'did-resolver';
import { getResolver } from 'key-did-resolver';
import { verifyJWT } from 'did-jwt';
import type { AuthService } from '../auth/auth.service.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import type { DidCommRepository, RelayEnvelope } from './didcomm.repository.js';

const resolver = new Resolver(getResolver());
const REQUEST = 'https://tracechain.local/didcomm/ingredient-evidence-request/1.0';
const ACK = 'https://tracechain.local/didcomm/ingredient-evidence-ack/1.0';
const PRESENTATION = 'https://tracechain.local/didcomm/ingredient-evidence-presentation/1.0';
const DECLINED = 'https://tracechain.local/didcomm/ingredient-evidence-declined/1.0';
const DECISION = 'https://tracechain.local/didcomm/ingredient-evidence-decision/1.0';
const FOLLOW_UP = 'https://tracechain.local/didcomm/ingredient-evidence-follow-up/1.0';
const IDENTITY_REQUEST = 'https://tracechain.local/didcomm/company-identity-request/1.0';
const IDENTITY_PRESENTATION = 'https://tracechain.local/didcomm/company-identity-presentation/1.0';
const IDENTITY_DECLINED = 'https://tracechain.local/didcomm/company-identity-declined/1.0';
interface Challenge {
  expiresAt: number;
  nonce: string;
  wallet: string;
}

export class DidCommError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export class DidCommService {
  private readonly challenges = new Map<string, Challenge>();
  constructor(
    private readonly auth: AuthService,
    private readonly repository: DidCommRepository,
    private readonly domain: string,
    private readonly chainId: number,
    private readonly participants?: Pick<StakeholderDirectory, 'resolve'>,
    private readonly clock = () => new Date(),
  ) {}
  async challenge(sessionId?: string) {
    const session = await this.session(sessionId);
    const nonce = randomBytes(24).toString('base64url');
    const expiresAt = this.clock().getTime() + 5 * 60_000;
    this.challenges.set(nonce, { expiresAt, nonce, wallet: session.address.toLowerCase() });
    return {
      chainId: this.chainId,
      domain: this.domain,
      expiresAt: new Date(expiresAt).toISOString(),
      nonce,
      purpose: 'tracechain-didcomm-messaging-key-binding',
      wallet: session.address,
    };
  }
  async bind(sessionId: string | undefined, proof: string) {
    const session = await this.session(sessionId);
    let verified;
    try {
      verified = await verifyJWT(proof, { audience: this.domain, resolver });
    } catch {
      throw new DidCommError('INVALID_KEY_PROOF', 'Messaging-key proof verification failed.', 401);
    }
    const payload = verified.payload as Record<string, unknown>;
    const nonce = String(payload.nonce ?? '');
    const challenge = this.challenges.get(nonce);
    const did = String(payload.iss ?? '');
    if (
      !challenge ||
      challenge.expiresAt <= this.clock().getTime() ||
      challenge.wallet !== session.address.toLowerCase()
    )
      throw new DidCommError(
        'INVALID_BINDING_CHALLENGE',
        'The messaging-key challenge is expired or does not belong to this wallet.',
        401,
      );
    if (
      payload.sub !== session.address.toLowerCase() ||
      payload.aud !== this.domain ||
      payload.purpose !== 'tracechain-didcomm-messaging-key-binding' ||
      Number(payload.chainId) !== this.chainId ||
      !did.startsWith('did:key:')
    )
      throw new DidCommError(
        'INVALID_KEY_BINDING',
        'The proof is not bound to this TraceChain wallet, domain, purpose, and chain.',
        401,
      );
    const existingDid = await this.repository.findIdentityByDid(did);
    if (existingDid && existingDid.wallet.toLowerCase() !== session.address.toLowerCase())
      throw new DidCommError(
        'MESSAGING_DID_ALREADY_BOUND',
        'This messaging DID is already bound to a different SIWE wallet.',
        409,
      );
    this.challenges.delete(nonce);
    const record = {
      companyName: session.companyName ?? 'Unavailable',
      did,
      registeredAt: this.clock().toISOString(),
      role: session.role!,
      wallet: session.address,
    };
    await this.repository.saveIdentity(record);
    return record;
  }
  async directory(sessionId?: string) {
    await this.session(sessionId);
    let identities = await this.repository.listIdentities();
    if (this.participants) {
      const current = await Promise.all(
        identities.map(async (identity) => {
          try {
            return (await this.participants!.resolve(identity.wallet)) ? identity : null;
          } catch {
            // Directory entries are optional discovery data. Fail closed without exposing a
            // participant when its current authorization cannot be resolved.
            return null;
          }
        }),
      );
      identities = current.filter(
        (identity): identity is NonNullable<typeof identity> => !!identity,
      );
    }
    return identities.map(({ did, companyName, role, wallet }) => ({
      did,
      companyName,
      role,
      wallet,
    }));
  }
  async mailbox(sessionId?: string) {
    const session = await this.session(sessionId);
    return {
      envelopes: await this.repository.listEnvelopes(session.address),
      identity: await this.repository.findIdentityByWallet(session.address),
    };
  }
  async relay(sessionId: string | undefined, input: RelayEnvelope) {
    const session = await this.session(sessionId);
    const sender = await this.repository.findIdentityByWallet(session.address);
    const recipient = await this.repository.findIdentityByDid(input.toDid);
    if (!sender || sender.did !== input.fromDid || sender.role !== session.role)
      throw new DidCommError(
        'SENDER_BINDING_REQUIRED',
        'The envelope sender is not the messaging identity bound to this SIWE wallet.',
        403,
      );
    if (!recipient)
      throw new DidCommError(
        'RECIPIENT_NOT_BOUND',
        'The recipient has no verified messaging identity.',
        404,
      );
    if (this.participants && !(await this.participants.resolve(recipient.wallet)))
      throw new DidCommError(
        'RECIPIENT_NOT_AUTHORIZED',
        'The recipient is not currently authorized on chain.',
        403,
      );
    const now = this.clock().getTime();
    if (
      Date.parse(input.createdAt) > now + 60_000 ||
      Date.parse(input.expiresAt) <= now ||
      Date.parse(input.expiresAt) > now + 24 * 60 * 60_000
    )
      throw new DidCommError(
        'INVALID_MESSAGE_TIME',
        'The encrypted message is expired or has an invalid lifetime.',
        400,
      );
    if (input.messageType === REQUEST) {
      if (
        (session.role !== CompanyRole.MANUFACTURER && session.role !== CompanyRole.RETAILER) ||
        recipient.role !== CompanyRole.SUPPLIER ||
        input.parentThreadId
      )
        throw new DidCommError(
          'UNAUTHORIZED_MESSAGE_FLOW',
          'Only a Manufacturer or Retailer can send an evidence request to a Supplier.',
          403,
        );
    } else if ([ACK, PRESENTATION, DECLINED].includes(input.messageType)) {
      if (
        session.role !== CompanyRole.SUPPLIER ||
        (recipient.role !== CompanyRole.MANUFACTURER && recipient.role !== CompanyRole.RETAILER) ||
        !input.parentThreadId
      )
        throw new DidCommError(
          'UNAUTHORIZED_MESSAGE_FLOW',
          'Only the recipient Supplier can respond to the requesting Manufacturer or Retailer.',
          403,
        );
      const thread = (await this.repository.listEnvelopes(session.address)).find(
        (item) =>
          item.id === input.parentThreadId &&
          item.toDid === sender.did &&
          item.fromDid === recipient.did &&
          item.threadId === input.threadId &&
          [REQUEST, FOLLOW_UP].includes(item.messageType),
      );
      if (!thread)
        throw new DidCommError(
          'THREAD_MISMATCH',
          'The Supplier response does not match an accessible evidence-request thread.',
          403,
        );
    } else if (input.messageType === IDENTITY_REQUEST) {
      if (
        session.role !== CompanyRole.SUPPLIER ||
        (recipient.role !== CompanyRole.MANUFACTURER && recipient.role !== CompanyRole.RETAILER) ||
        !input.parentThreadId
      )
        throw new DidCommError(
          'UNAUTHORIZED_MESSAGE_FLOW',
          'Invalid company identity request flow.',
          403,
        );
      const thread = (await this.repository.listEnvelopes(session.address)).find(
        (item) =>
          item.id === input.parentThreadId &&
          item.toDid === sender.did &&
          item.fromDid === recipient.did &&
          item.messageType === REQUEST,
      );
      if (!thread)
        throw new DidCommError(
          'THREAD_MISMATCH',
          'Identity request is not linked to the evidence request.',
          403,
        );
    } else if ([IDENTITY_PRESENTATION, IDENTITY_DECLINED].includes(input.messageType)) {
      if (
        (session.role !== CompanyRole.MANUFACTURER && session.role !== CompanyRole.RETAILER) ||
        recipient.role !== CompanyRole.SUPPLIER ||
        !input.parentThreadId
      )
        throw new DidCommError(
          'UNAUTHORIZED_MESSAGE_FLOW',
          'Invalid company identity presentation flow.',
          403,
        );
      const thread = (await this.repository.listEnvelopes(session.address)).find(
        (item) =>
          item.id === input.parentThreadId &&
          item.toDid === sender.did &&
          item.fromDid === recipient.did &&
          item.messageType === IDENTITY_REQUEST,
      );
      if (!thread)
        throw new DidCommError(
          'THREAD_MISMATCH',
          'Identity presentation is not linked to its request.',
          403,
        );
      if (
        (await this.repository.listEnvelopes(session.address)).some(
          (item) =>
            item.parentThreadId === input.parentThreadId &&
            item.fromDid === sender.did &&
            [IDENTITY_PRESENTATION, IDENTITY_DECLINED].includes(item.messageType),
        )
      )
        throw new DidCommError(
          'IDENTITY_RESPONSE_REPLAY',
          'This company identity request already has a response.',
          409,
        );
    } else if ([DECISION, FOLLOW_UP].includes(input.messageType)) {
      if (
        (session.role !== CompanyRole.MANUFACTURER && session.role !== CompanyRole.RETAILER) ||
        recipient.role !== CompanyRole.SUPPLIER ||
        !input.parentThreadId
      )
        throw new DidCommError(
          'UNAUTHORIZED_MESSAGE_FLOW',
          'Only the requesting Manufacturer or Retailer can send a decision or follow-up.',
          403,
        );
      const thread = (await this.repository.listEnvelopes(session.address)).find(
        (item) =>
          item.id === input.parentThreadId &&
          item.toDid === sender.did &&
          item.fromDid === recipient.did &&
          item.threadId === input.threadId &&
          [ACK, PRESENTATION, DECLINED].includes(item.messageType),
      );
      if (!thread)
        throw new DidCommError(
          'THREAD_MISMATCH',
          'The Manufacturer response does not match an accessible Supplier response.',
          403,
        );
    } else
      throw new DidCommError(
        'UNSUPPORTED_MESSAGE_TYPE',
        'This DIDComm message type is not supported.',
        400,
      );
    try {
      await this.repository.saveEnvelope(input);
    } catch (error) {
      if ((error as Error).message === 'DUPLICATE_MESSAGE')
        throw new DidCommError('DUPLICATE_MESSAGE', 'This message ID was already relayed.', 409);
      throw error;
    }
    return { accepted: true, id: input.id };
  }
  private async session(sessionId?: string) {
    const session = await this.auth.getSession(sessionId);
    if (!session.authenticated || !session.authorizationReady || !session.role)
      throw new DidCommError(
        'AUTHORIZATION_REQUIRED',
        'Current on-chain company authorization is required.',
        403,
      );
    return session;
  }
}
export const DIDCOMM_EVIDENCE_REQUEST_TYPE = REQUEST;
export const DIDCOMM_EVIDENCE_ACK_TYPE = ACK;
export const DIDCOMM_EVIDENCE_PRESENTATION_TYPE = PRESENTATION;
export const DIDCOMM_EVIDENCE_DECLINED_TYPE = DECLINED;
export const DIDCOMM_EVIDENCE_DECISION_TYPE = DECISION;
export const DIDCOMM_EVIDENCE_FOLLOW_UP_TYPE = FOLLOW_UP;
export const DIDCOMM_COMPANY_IDENTITY_REQUEST_TYPE = IDENTITY_REQUEST;
export const DIDCOMM_COMPANY_IDENTITY_PRESENTATION_TYPE = IDENTITY_PRESENTATION;
export const DIDCOMM_COMPANY_IDENTITY_DECLINED_TYPE = IDENTITY_DECLINED;
