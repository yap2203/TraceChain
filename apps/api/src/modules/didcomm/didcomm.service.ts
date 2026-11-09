import { randomBytes, randomUUID } from 'node:crypto';
import { CompanyRole } from '@tracechain/shared';
import { Resolver } from 'did-resolver';
import { getResolver } from 'key-did-resolver';
import { verifyJWT } from 'did-jwt';
import type { AuthService } from '../auth/auth.service.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import type { DidCommRepository, RelayEnvelope } from './didcomm.repository.js';
import type { BackendDidCommAgentService } from './backend-agent.service.js';

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
    private readonly backendAgents?: BackendDidCommAgentService,
    private readonly businessParticipants?: (
      reference: string,
    ) => Promise<{ requester: string; supplier: string } | undefined>,
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
    let identities = this.backendAgents
      ? await this.backendAgents.list()
      : await this.repository.listIdentities();
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
    const identity = this.backendAgents
      ? await this.backendAgents.findByWallet(session.address)
      : await this.repository.findIdentityByWallet(session.address);
    const envelopes = identity
      ? ((await this.repository.listEnvelopesByDid?.(identity.did)) ??
        (await this.repository.listEnvelopes(session.address)))
      : [];
    return {
      envelopes,
      identity,
    };
  }

  async send(
    sessionId: string | undefined,
    input: {
      body: Record<string, unknown>;
      businessReference: string;
      expiresAt: string;
      ingredientBatchReference?: string;
      messageType: string;
      parentThreadId?: string;
      recipientWallet: string;
      threadId: string;
    },
  ) {
    if (!this.backendAgents)
      throw new DidCommError(
        'BACKEND_MESSAGING_UNAVAILABLE',
        'Backend-managed secure delivery is not configured.',
        503,
      );
    const session = await this.session(sessionId);
    if (this.businessParticipants) {
      const participants = await this.businessParticipants(input.businessReference);
      if (!participants)
        throw new DidCommError(
          'BUSINESS_REQUEST_NOT_FOUND',
          'The evidence request was not found.',
          404,
        );
      const actor = session.address.toLowerCase();
      const supplier = participants.supplier.toLowerCase();
      const requester = participants.requester.toLowerCase();
      const expectedRecipient =
        actor === supplier ? requester : actor === requester ? supplier : '';
      if (!expectedRecipient || input.recipientWallet.toLowerCase() !== expectedRecipient)
        throw new DidCommError(
          'RECIPIENT_SUBSTITUTION_REJECTED',
          'The recipient does not match the authorized evidence-request participants.',
          403,
        );
    }
    const recipientParticipant = this.participants
      ? await this.participants.resolve(input.recipientWallet)
      : undefined;
    if (this.participants && !recipientParticipant)
      throw new DidCommError('RECIPIENT_NOT_AUTHORIZED', 'The recipient is not authorized.', 403);
    const sender = await this.backendAgents.ensureIdentity({
      companyName: session.companyName ?? 'Unavailable',
      role: session.role!,
      wallet: session.address,
    });
    const recipient = await this.backendAgents.ensureIdentity({
      companyName: recipientParticipant?.companyName ?? 'Unavailable',
      role: recipientParticipant?.role ?? '',
      wallet: input.recipientWallet,
    });
    const existingDelivery = (await this.envelopesFor(session.address, sender.did)).find(
      (item) =>
        item.businessReference.toLowerCase() === input.businessReference.toLowerCase() &&
        item.messageType === input.messageType &&
        item.fromDid === sender.did &&
        item.toDid === recipient.did &&
        item.deliveryState === 'RECEIVED_DECRYPTED',
    );
    if (existingDelivery) return { accepted: true as const, id: existingDelivery.id };
    let parentThreadId = input.parentThreadId;
    if (!parentThreadId && input.messageType !== REQUEST) {
      const expectedParentTypes = [ACK, PRESENTATION, DECLINED].includes(input.messageType)
        ? [REQUEST, FOLLOW_UP]
        : input.messageType === IDENTITY_REQUEST
          ? [REQUEST]
          : [IDENTITY_PRESENTATION, IDENTITY_DECLINED].includes(input.messageType)
            ? [IDENTITY_REQUEST]
            : [ACK, PRESENTATION, DECLINED];
      parentThreadId = (await this.envelopesFor(session.address, sender.did)).find(
        (item) =>
          item.businessReference.toLowerCase() === input.businessReference.toLowerCase() &&
          item.threadId === input.threadId &&
          item.fromDid === recipient.did &&
          item.toDid === sender.did &&
          expectedParentTypes.includes(item.messageType),
      )?.id;
      if (!parentThreadId)
        throw new DidCommError(
          'THREAD_MISMATCH',
          'The linked secure business-message thread is unavailable.',
          409,
        );
    }
    const id = randomUUID();
    const now = this.clock();
    const message = {
      id,
      type: input.messageType,
      from: sender.did,
      to: [recipient.did],
      thid: input.threadId,
      ...(parentThreadId ? { pthid: parentThreadId } : {}),
      created_time: Math.floor(now.getTime() / 1_000),
      expires_time: Math.floor(Date.parse(input.expiresAt) / 1_000),
      body: input.body,
    };
    const envelope = await this.backendAgents.pack(sender.did, message);
    let unpacked;
    try {
      unpacked = await this.backendAgents.unpack(recipient.did, envelope);
    } catch {
      throw new DidCommError(
        'DELIVERY_DECRYPTION_FAILED',
        'The intended recipient company agent could not decrypt the secure message.',
        503,
      );
    }
    if (
      unpacked.id !== id ||
      unpacked.type !== input.messageType ||
      unpacked.from !== sender.did ||
      !unpacked.to?.includes(recipient.did)
    )
      throw new DidCommError(
        'DELIVERY_VALIDATION_FAILED',
        'The decrypted secure message did not match its authenticated routing metadata.',
        400,
      );
    const record: RelayEnvelope = {
      businessReference: input.businessReference,
      createdAt: now.toISOString(),
      deliveryState: 'RECEIVED_DECRYPTED',
      envelope,
      expiresAt: input.expiresAt,
      fromDid: sender.did,
      id,
      ingredientBatchReference: input.ingredientBatchReference,
      messageType: input.messageType,
      parentThreadId,
      threadId: input.threadId,
      toDid: recipient.did,
      receivedAt: this.clock().toISOString(),
    };
    return this.relay(sessionId, record);
  }
  async relay(sessionId: string | undefined, input: RelayEnvelope) {
    const session = await this.session(sessionId);
    const sender = this.backendAgents
      ? await this.backendAgents.findByWallet(session.address)
      : await this.repository.findIdentityByWallet(session.address);
    const recipient = this.backendAgents
      ? await this.backendAgents.findByDid(input.toDid)
      : await this.repository.findIdentityByDid(input.toDid);
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
      const thread = (await this.envelopesFor(session.address, sender.did)).find(
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
      const thread = (await this.envelopesFor(session.address, sender.did)).find(
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
      const thread = (await this.envelopesFor(session.address, sender.did)).find(
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
        (await this.envelopesFor(session.address, sender.did)).some(
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
      const thread = (await this.envelopesFor(session.address, sender.did)).find(
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
  private async envelopesFor(wallet: string, did: string) {
    return this.backendAgents && this.repository.listEnvelopesByDid
      ? this.repository.listEnvelopesByDid(did)
      : this.repository.listEnvelopes(wallet);
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
