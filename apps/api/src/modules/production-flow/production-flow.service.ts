import { decodeCertificationFile } from '../ingredient-batches/certification-documents.js';
import { missingLegacyIngredientClaims } from './legacy-ingredient-claims.js';
import { createHash, randomBytes } from 'node:crypto';

import {
  createIngredientEvidencePresentation,
  companyRoleCredentialSchema,
  ingredientCredentialSchema,
  readIngredientSdJwtClaims,
  verifyIngredientSdJwtPresentation,
  verifyIngredientEvidencePresentation,
  verifyIngredientCredential,
  verifyCompanyRoleCredential,
  issueCompanyIdentitySdJwt,
  verifyCompanyIdentitySdJwt,
  verifyIssuedCompanyWalletAttestation,
  COMPANY_IDENTITY_BINDING_CLAIMS,
  type IngredientCredential,
  type TraceChainAgent,
} from '@tracechain/ssi';
import {
  CompanyRole,
  parseWalletPresentation,
  presentationSdJwt,
  verifyWalletPresentation,
  type WalletProofContext,
} from '@tracechain/shared';
import { ingredientClaimLabel, ingredientDetailClaims } from '@tracechain/shared';
import {
  COMPANY_ALWAYS_CLAIMS,
  companyDisclosureGroup,
  ingredientDisclosureErrors,
  ingredientPolicyRequirements,
  visibleIngredientClaims,
  type IngredientRequestPolicy,
} from '@tracechain/shared';
import { Resolver } from 'did-resolver';
import { verifyJWT } from 'did-jwt';
import { ZeroHash, decodeBytes32String, encodeBase58, getAddress, id } from 'ethers';
import { getResolver } from 'key-did-resolver';
import type { CompanyProofReferences } from './company-proof.gateway.js';

import type { AuthService } from '../auth/auth.service.js';
import type { SessionRecord } from '../auth/auth.types.js';
import type { IngredientBatchWorkflowRepository } from '../ingredient-batches/ingredient-batch.repository.js';
import type { DidCommRepository } from '../didcomm/didcomm.repository.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { CompanyRoleIssuanceRepository } from '../ssi/issuance.repository.js';
import type { TraceChainAgentProvider } from '../ssi/ssi.service.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import type { ProductionFlowGateway } from './production-flow.gateway.js';
import type {
  EvidenceWorkflowRecord,
  ProductionFlowRepository,
} from './production-flow.repository.js';
import type {
  DistributorTransferRequestInput,
  EvidenceCloseInput,
  EvidenceRequestInput,
  ProductRequestInput,
  TransferRequestInput,
} from './production-flow.schema.js';

const ROLE_NUMBERS = {
  [CompanyRole.SUPPLIER]: 2,
  [CompanyRole.MANUFACTURER]: 3,
  [CompanyRole.DISTRIBUTOR]: 4,
  [CompanyRole.RETAILER]: 5,
} as const;
const keyResolver = new Resolver(getResolver());

export class ProductionFlowApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Dependencies {
  walletCompanyExchange?: boolean;
  companyReferences?: () => CompanyProofReferences;
  validateDeliveryIdentity?: (workflow: EvidenceWorkflowRecord) => Promise<boolean>;
  agentProvider: TraceChainAgentProvider;
  authService: AuthService;
  clock?: () => Date;
  contentStore: CredentialContentStore;
  gateway: ProductionFlowGateway;
  ingredientRepository: IngredientBatchWorkflowRepository;
  companyRoleRepository?: CompanyRoleIssuanceRepository;
  messagingIdentityRepository?: Pick<DidCommRepository, 'findIdentityByWallet'>;
  presentationDomain?: string;
  repository: ProductionFlowRepository;
  stakeholderDirectory?: StakeholderDirectory;
}

interface EvidenceRequestPrivatePayload {
  policy?: IngredientRequestPolicy;
  batchId?: string;
  challenge?: string;
  claims?: string[];
  dueAt?: number;
  issuedAt?: number;
  reason?: string;
  requestId?: string;
  requester?: string;
  requiredClaims?: string[];
  supplier?: string;
}

export class ProductionFlowService {
  async resolveEvidenceMessagingParticipants(requestId: string) {
    const workflow = await this.dependencies.repository.findEvidence(requestId);
    if (!workflow || workflow.orderContext) return undefined;
    const chain = await this.dependencies.gateway.getEvidenceRequest(requestId);
    if (!chain || ![1, 2, 3].includes(chain.status) || chain.dueAt <= this.nowSeconds())
      return undefined;
    this.assertRequestMatches(chain, workflow);
    return {
      requester: chain.requester,
      supplier: chain.supplier,
      identityRequestAllowed:
        chain.status === 1 &&
        workflow.identityProof?.status === 'REQUESTED' &&
        workflow.identityProof.expiresAt > this.nowSeconds(),
    };
  }
  async validateOrderIdentityPresentation(
    sessionId: string | undefined,
    orderId: string,
    presentation: string,
  ) {
    const session = await this.requireIdentitySession(sessionId, orderId, true);
    const workflow = await this.requireWorkflow(orderId);
    if (
      !workflow.orderContext ||
      !sameAddress(session.address, workflow.requester) ||
      workflow.identityProof?.status !== 'REQUESTED'
    )
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_ACCESS_DENIED',
        'This order identity challenge is unavailable.',
        403,
      );
    await this.verifyCompanyIdentityPresentation(workflow, presentation);
  }
  async startOrderIdentity(
    sessionId: string | undefined,
    context: {
      orderId: string;
      deliveryOrderId?: string;
      buyer: string;
      seller: string;
      batchId: string;
      purpose: string;
      expiresAt: number;
      requiredClaims: string[];
      optionalClaims?: string[];
      selectiveDisclosure?: boolean;
    },
  ) {
    if (this.dependencies.walletCompanyExchange && !this.dependencies.companyReferences)
      throw new ProductionFlowApiError(
        'COMPANY_PROOF_REGISTRY_REQUIRED',
        'Deploy and configure CompanyProofRegistry before creating shared company requests.',
        503,
      );
    const session = context.deliveryOrderId
      ? await this.requireRole(sessionId, CompanyRole.DISTRIBUTOR, 'RECEIVE_TRANSFER')
      : await this.requireEitherRole(sessionId);
    if (context.selectiveDisclosure) {
      context.requiredClaims = [
        ...new Set([...COMPANY_ALWAYS_CLAIMS, ...companyDisclosureGroup(context.requiredClaims)]),
      ];
      context.optionalClaims = companyDisclosureGroup(context.optionalClaims ?? []).filter(
        (key) => !context.requiredClaims.includes(key),
      );
    }
    if (!sameAddress(session.address, context.seller))
      throw new ProductionFlowApiError(
        'ACCESS_DENIED',
        'Only the order seller may request buyer identity.',
        403,
      );
    const currentRole = context.deliveryOrderId
      ? (await this.dependencies.gateway.isRoleAuthorized(context.buyer, 2))
        ? CompanyRole.SUPPLIER
        : CompanyRole.MANUFACTURER
      : (await this.dependencies.gateway.isRoleAuthorized(context.buyer, 3))
        ? CompanyRole.MANUFACTURER
        : CompanyRole.RETAILER;
    const shared = await this.sharedCompanyReferences()?.get(context.orderId);
    const previous = shared
      ? await this.requireWorkflow(context.orderId, session.address)
      : await this.dependencies.repository.findEvidence(context.orderId);
    if (
      context.deliveryOrderId &&
      currentRole === CompanyRole.MANUFACTURER &&
      !(await this.dependencies.gateway.isRoleAuthorized(context.buyer, 3))
    )
      throw new ProductionFlowApiError(
        'ROLE_AUTHORIZATION_REQUIRED',
        'The delivery seller must be a currently authorized Supplier or Manufacturer.',
        403,
      );
    if (previous?.identityProof && previous.identityProof.expiresAt > this.nowSeconds()) {
      if (
        previous.identityProof.purpose === context.purpose &&
        previous.identityProof.expiresAt === context.expiresAt &&
        canonical(previous.identityProof.requiredClaims ?? []) ===
          canonical(context.requiredClaims) &&
        canonical(previous.identityProof.optionalClaims ?? []) ===
          canonical(context.optionalClaims ?? []) &&
        Boolean(previous.identityProof.selectiveDisclosure) === Boolean(context.selectiveDisclosure)
      )
        return {
          challenge: previous.identityProof.challenge,
          expiresAt: previous.identityProof.expiresAt,
          requestCid: previous.requestCid,
          referenceTransaction: this.dependencies.companyReferences
            ? await this.companyReferenceTransaction(previous)
            : undefined,
        };
      throw new ProductionFlowApiError(
        'IDENTITY_REQUEST_EXISTS',
        'Resolve or wait for the existing identity request to expire before creating another.',
        409,
      );
    }
    const proof = {
      audience: context.seller.toLowerCase(),
      challenge: randomBytes(32).toString('base64url'),
      expiresAt: context.expiresAt,
      presenterRole: currentRole,
      presenterWallet: context.buyer,
      purpose: context.purpose,
      requiredClaims: context.requiredClaims,
      optionalClaims: context.optionalClaims,
      selectiveDisclosure: context.selectiveDisclosure,
      status: 'REQUESTED' as const,
    };
    // Reuse the encrypted workflow repository and existing Company Role verification logic.
    const stored = await this.store(
      canonical({ purpose: context.purpose, requiredClaims: context.requiredClaims }),
      `${context.orderId}-identity-context`,
    );
    await this.dependencies.repository.saveEvidence({
      orderContext: true,
      deliveryOrderId: context.deliveryOrderId,
      batchId: context.batchId,
      requestId: context.orderId,
      requester: context.buyer,
      supplier: context.seller,
      operationId: context.orderId,
      challengeHash: id(proof.challenge),
      claimsHash: id(canonical(context.requiredClaims)),
      dueAt: context.expiresAt,
      requestCid: stored.cid,
      requestPayload: stored.payload,
      identityProof: proof,
    });
    const saved = (await this.dependencies.repository.findEvidence(context.orderId))!;
    return {
      challenge: proof.challenge,
      expiresAt: proof.expiresAt,
      requestCid: stored.cid,
      referenceTransaction: this.dependencies.companyReferences
        ? await this.companyReferenceTransaction(saved)
        : undefined,
    };
  }

  async orderIdentityAttestation(sessionId: string | undefined, orderId: string) {
    const result = await this.verifyCompanyIdentityProof(sessionId, orderId);
    const workflow = await this.requireWorkflow(orderId);
    const presentation = workflow.identityProof!.presentationPayload
      ? await this.dependencies.contentStore.decrypt(workflow.identityProof!.presentationPayload)
      : await this.retrieveEncrypted(
          workflow.identityProof!.presentationCid ?? '',
          'COMPANY_IDENTITY_PRESENTATION',
        );
    if (!workflow.identityProof!.presentationCid) {
      const migrated = await this.store(presentation, `${orderId}-company-identity-proof`);
      workflow.identityProof = {
        ...workflow.identityProof!,
        presentationCid: migrated.cid,
        presentationPayload: migrated.payload,
      };
      await this.dependencies.repository.saveEvidence(workflow);
    }
    const checked = await this.verifyCompanyIdentityPresentation(
      workflow,
      presentation,
      this.recordedVerificationTime(workflow),
    );
    return {
      challengeHash: id(workflow.identityProof!.challenge),
      presentationHash: id(presentation),
      presentationCid: workflow.identityProof!.presentationCid!,
      credentialHash: `0x${normalizeHash(checked.credentialHash)}`,
      expiresAt: Math.min(
        workflow.identityProof!.expiresAt,
        parseWalletPresentation(presentation)?.proof.context.expiresAt ?? Number.MAX_SAFE_INTEGER,
        Math.floor(Date.parse(checked.credential.expirationDate) / 1000),
      ),
      checks: result.checks,
      referenceTransaction: result.transaction,
    };
  }
  private readonly clock: () => Date;

  constructor(private readonly dependencies: Dependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  private async companySource(wallet: string, expectedHash: string) {
    const reference = await this.dependencies.gateway.companyCredential?.(wallet);
    if (reference) {
      if (normalizeHash(reference.credentialHash) !== normalizeHash(expectedHash))
        throw this.recordMismatch('The company credential has been replaced.');
      return companyRoleCredentialSchema.parse(
        JSON.parse(
          await this.retrieveEncrypted(reference.credentialCid, 'COMPANY_ROLE_CREDENTIAL'),
        ),
      );
    }
    const records = await this.dependencies.companyRoleRepository?.list().catch(() => {
      throw new ProductionFlowApiError(
        'IDENTITY_SOURCE_UNAVAILABLE',
        'The source credential storage is unavailable.',
        503,
      );
    });
    const record = records?.find(
      (r) =>
        sameAddress(r.applicantWallet, wallet) &&
        normalizeHash(r.credentialHash) === normalizeHash(expectedHash),
    );
    if (!record) throw this.recordMismatch('The original Company Role Credential is unavailable.');
    return companyRoleCredentialSchema.parse(
      JSON.parse(
        await this.dependencies.contentStore.decrypt(record.encryptedPayload).catch(() => {
          throw new ProductionFlowApiError(
            'IDENTITY_SOURCE_UNAVAILABLE',
            'The source credential could not be retrieved or decrypted.',
            503,
          );
        }),
      ),
    );
  }

  private async companyReferenceTransaction(workflow: EvidenceWorkflowRecord) {
    const refs = this.sharedCompanyReferences()!;
    const existing = await refs.get(workflow.requestId);
    if (existing && existing.challengeHash === id(workflow.identityProof!.challenge))
      return undefined;
    const serialized = canonical({
      version: 1,
      chainId: refs.domain.chainId,
      registry: refs.domain.verifyingContract,
      batchId: workflow.batchId,
      requestId: workflow.requestId,
      requester: workflow.requester,
      supplier: workflow.supplier,
      challengeHash: workflow.challengeHash,
      claimsHash: workflow.claimsHash,
      dueAt: workflow.dueAt,
      requestCid: workflow.requestCid,
      orderContext: workflow.orderContext,
      deliveryOrderId: workflow.deliveryOrderId,
      identityProof: workflow.identityProof,
    });
    const stored = await this.store(serialized, `${workflow.requestId}-company-request`);
    return refs.prepare('request', [
      workflow.requestId,
      workflow.requester,
      id(workflow.identityProof!.challenge),
      workflow.identityProof!.expiresAt,
      sha256(serialized),
      stored.cid,
    ]);
  }

  async listSharedCompanyRequests(sessionId?: string) {
    if (!this.dependencies.companyReferences) return [];
    const session = await this.dependencies.authService.requireSession(sessionId);
    const references = this.sharedCompanyReferences()!;
    const ids = await references.list(session.address);
    // shortcut: unbounded parallel IPFS reads; add a concurrency limit or cache if lists grow large.
    return Promise.all(ids.map((requestId) => this.requireWorkflow(requestId, session.address)));
  }

  private async walletCompanyMaterial(session: SessionRecord, workflow: EvidenceWorkflowRecord) {
    const refs = this.sharedCompanyReferences()!;
    const proof = workflow.identityProof!;
    const hash = session.onChainAuthorization!.credentialHash!;
    const credential = await this.companySource(session.address, hash);
    const issuerDid =
      typeof credential.issuer === 'string' ? credential.issuer : credential.issuer.id;
    const verified = await verifyCompanyRoleCredential(
      await this.dependencies.agentProvider(),
      credential,
      session.address,
      issuerDid,
      this.clock(),
    );
    if (!verified.verified || normalizeHash(verified.credentialHash!) !== normalizeHash(hash))
      throw this.recordMismatch('The current Company Role Credential could not be verified.');
    const binding = await refs.binding(session.address);
    let sdJwt: string;
    let bindingTransaction;
    if (binding.cid && normalizeHash(binding.sourceHash) === normalizeHash(hash)) {
      sdJwt = await this.retrieveEncrypted(binding.cid, 'COMPANY_WALLET_ATTESTATION');
      if (sha256(sdJwt).toLowerCase() !== binding.contentHash.toLowerCase())
        throw this.recordMismatch('Company wallet attestation hash mismatch.');
    } else {
      sdJwt = await issueCompanyIdentitySdJwt(await this.dependencies.agentProvider(), {
        issuerDid,
        holderWallet: session.address,
        credentialHash: hash,
        claims: credential.credentialSubject,
        sourceCredentialId: credential.id,
        sourceCredentialIssuedAt: credential.issuanceDate,
        sourceCredentialExpiresAt: credential.expirationDate,
        requestId: ZeroHash,
        purpose: 'Company wallet holder binding',
        audience: session.address.toLowerCase(),
        challenge: 'wallet-binding:v1',
        issuedAt: this.nowSeconds(),
        expiresAt: Math.floor(Date.parse(credential.expirationDate) / 1000),
      }).catch(() => {
        throw new ProductionFlowApiError(
          'COMPANY_WALLET_BINDING_REQUIRED',
          'The original issuer must authorize and publish a wallet attestation once before this credential can be shared from an API without issuer keys.',
          409,
        );
      });
      const stored = await this.store(sdJwt, `${credential.id}-wallet-attestation`);
      bindingTransaction = refs.prepare('registerBinding', [
        `0x${normalizeHash(hash)}`,
        sha256(sdJwt),
        stored.cid,
      ]);
    }
    const attestation = (
      await verifyIssuedCompanyWalletAttestation(
        await this.dependencies.agentProvider(),
        sdJwt,
        this.nowSeconds(),
      )
    ).payload;
    const cnf = attestation.cnf as { wallet?: string; proof?: string };
    if (
      attestation.iss !== issuerDid ||
      normalizeHash(String(attestation.sourceCredentialHash)) !== normalizeHash(hash) ||
      attestation.sourceCredentialId !== credential.id ||
      attestation.sourceCredentialIssuedAt !== credential.issuanceDate ||
      attestation.sourceCredentialExpiresAt !== credential.expirationDate ||
      !sameAddress(cnf.wallet ?? '', session.address) ||
      cnf.proof !== 'tracechain:eip712:holder:v1' ||
      Object.entries(credential.credentialSubject).some(
        ([key, value]) => key in attestation && canonical(value) !== canonical(attestation[key]),
      )
    )
      throw this.recordMismatch(
        'The issuer-authorized wallet attestation differs from the current Company Role Credential.',
      );
    return {
      format: 'COMPANY_IDENTITY_SD_JWT' as const,
      sdJwt,
      claims: Object.fromEntries(
        Object.entries(credential.credentialSubject).filter(
          ([key]) =>
            key in attestation &&
            [
              ...COMPANY_ALWAYS_CLAIMS,
              ...companyDisclosureGroup(proof.requiredClaims ?? []),
              ...companyDisclosureGroup(proof.optionalClaims ?? []),
            ].includes(key),
        ),
      ),
      requiredClaims: [
        ...new Set([
          ...COMPANY_ALWAYS_CLAIMS,
          ...companyDisclosureGroup(proof.requiredClaims ?? []),
        ]),
      ],
      optionalClaims: proof.optionalClaims,
      policyVersion: 2,
      audience: proof.audience,
      challenge: proof.challenge,
      requestId: workflow.requestId,
      purpose: proof.purpose,
      holderDid: credential.credentialSubject.id,
      expiresAt: proof.expiresAt,
      bindingTransaction,
      walletContext: {
        ...refs.domain,
        holder: session.address,
        verifier: proof.audience,
        requestId: workflow.requestId,
        purpose: proof.purpose,
        challenge: proof.challenge,
        batchId: workflow.batchId || ZeroHash,
        issuedAt: this.nowSeconds(),
        // The requester's deadline (and the credential's expiry) govern the proof lifetime.
        expiresAt: Math.min(
          proof.expiresAt,
          Math.floor(Date.parse(credential.expirationDate) / 1000),
        ),
      },
    };
  }

  async prepareCompanyWalletBinding(sessionId?: string) {
    if (!this.dependencies.companyReferences)
      throw new ProductionFlowApiError(
        'COMPANY_PROOF_REGISTRY_REQUIRED',
        'Deploy and configure CompanyProofRegistry to enable portable wallet presentations.',
        503,
      );
    const session = await this.dependencies.authService.requireSession(sessionId);
    const authorization = session.onChainAuthorization;
    if (authorization?.status !== 'AUTHORIZED' || !authorization.credentialHash)
      throw new ProductionFlowApiError(
        'AUTHORIZATION_REQUIRED',
        'A current authorized Company Role Credential is required.',
        403,
      );
    const material = await this.walletCompanyMaterial(session, {
      batchId: ZeroHash,
      requestId: ZeroHash,
      requester: session.address,
      supplier: session.address,
      challengeHash: id('binding'),
      claimsHash: ZeroHash,
      dueAt: this.nowSeconds() + 300,
      operationId: 'binding',
      requestCid: '',
      identityProof: {
        audience: session.address,
        challenge: 'binding',
        expiresAt: this.nowSeconds() + 300,
        presenterRole: authorization.role!,
        presenterWallet: session.address,
        purpose: 'Enable MetaMask presentations',
        status: 'REQUESTED',
      },
    });
    return {
      actorWallet: session.address,
      state: material.bindingTransaction
        ? ('TRANSACTION_REQUIRED' as const)
        : ('COMPLETE' as const),
      transaction: material.bindingTransaction,
    };
  }

  private async ingredientRecord(batchId: string) {
    if (!this.dependencies.contentStore.retrieveEnvelope)
      return this.dependencies.ingredientRepository.find(batchId);
    const batch = await this.dependencies.gateway.getIngredient(batchId);
    if (!batch) return undefined;
    const credential = await this.dependencies.gateway.getCredential(batch.credentialId);
    if (!credential?.encryptedCid) return this.dependencies.ingredientRepository.find(batchId);
    let payload, serialized;
    try {
      payload = await this.dependencies.contentStore.retrieveEnvelope(credential.encryptedCid);
      serialized = await this.dependencies.contentStore.decrypt(payload);
    } catch (error) {
      throw new ProductionFlowApiError(
        'ENCRYPTED_RECORD_UNAVAILABLE',
        'The Ingredient Credential could not be downloaded or decrypted. Try again when the encrypted storage service is available.',
        503,
      );
    }
    const envelope = JSON.parse(serialized);
    const credentialValue = envelope.sdJwt ?? canonical(envelope.credential);
    if (
      sha256(credentialValue).toLowerCase() !== credential.credentialHash.toLowerCase() ||
      !sameAddress(credential.subject, batch.supplier) ||
      !sameAddress(credential.issuer, batch.supplier) ||
      sha256(JSON.stringify(envelope.metadata)).toLowerCase() !== batch.metadataHash.toLowerCase()
    )
      throw this.recordMismatch(
        'The shared Ingredient Credential does not match its on-chain batch or hash.',
      );
    const claims = envelope.sdJwt
      ? await readIngredientSdJwtClaims(envelope.sdJwt)
      : envelope.credential.credentialSubject;
    const jwk = claims.cnf?.jwk;
    const legacyHolder =
      jwk?.kty === 'OKP' && jwk?.crv === 'Ed25519' && typeof jwk.x === 'string'
        ? `did:key:z${encodeBase58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(jwk.x, 'base64url')]))}`
        : undefined;
    return {
      batchId,
      credentialId: batch.credentialId,
      credentialHash: credential.credentialHash,
      encryptedCid: credential.encryptedCid,
      encryptedPayload: payload,
      expiresAt: batch.expiresAt,
      producedAt: batch.producedAt,
      metadataHash: batch.metadataHash,
      quantity: batch.totalQuantity,
      supplierWallet: batch.supplier,
      unit: decodeBytes32String(batch.unit),
      issuerDid: String(claims.iss ?? envelope.credential?.issuer?.id ?? ''),
      holderDid: String(legacyHolder ?? claims.holderDid ?? claims.supplierDid ?? ''),
      credentialFormat: envelope.sdJwt ? ('SD_JWT_VC' as const) : ('JWT_VC' as const),
    };
  }

  async listIngredients(sessionId?: string, location?: string, purpose?: 'production') {
    const session = await this.requireRole(
      sessionId,
      CompanyRole.MANUFACTURER,
      purpose === 'production' ? 'REGISTER_PRODUCT' : 'REQUEST_EVIDENCE',
    );
    const now = this.nowSeconds();
    const records = await this.safeGateway(() => this.dependencies.gateway.listIngredients());
    const batches = await Promise.all(
      records.map(async (batch) => {
        const credential = await this.safeGateway(() =>
          this.dependencies.gateway.getCredential(batch.credentialId),
        );
        if (
          batch.status !== 1 ||
          batch.expiresAt <= now ||
          !credential ||
          credential.status !== 1 ||
          credential.expiresAt <= now ||
          credential.credentialType !== 2 ||
          !sameAddress(credential.subject, batch.supplier) ||
          !sameAddress(credential.issuer, batch.supplier) ||
          !(await this.safeGateway(() =>
            this.dependencies.gateway.isRoleAuthorized(batch.supplier, 2),
          ))
        ) {
          return null;
        }
        const received = await this.dependencies.gateway.getReceivedAvailable?.(
          batch.batchId,
          session.address,
          location,
        );
        return {
          accepted:
            purpose === 'production'
              ? undefined
              : await this.safeGateway(() =>
                  this.dependencies.gateway.getAccepted(batch.batchId, session.address),
                ),
          availableQuantity: received ?? (purpose === 'production' ? '0' : batch.availableQuantity),
          batchId: batch.batchId,
          expiresAt: batch.expiresAt,
          supplier: batch.supplier,
          unit: /^0x[0-9a-f]{64}$/i.test(batch.unit) ? decodeBytes32String(batch.unit) : batch.unit,
        };
      }),
    );
    const activeBatches = batches.filter((batch) => batch !== null);
    const names = await this.identityNames(activeBatches.map((batch) => batch.supplier));
    return {
      batches: activeBatches.map((batch) => ({
        ...batch,
        supplierName: names.get(batch.supplier.toLowerCase()),
      })),
    };
  }

  async listEvidence(sessionId?: string) {
    const session = await this.requireEitherRole(sessionId);
    const role =
      session.onChainAuthorization!.role === CompanyRole.SUPPLIER
        ? 2
        : session.onChainAuthorization!.role === CompanyRole.RETAILER
          ? 5
          : 3;
    const requestIds = await this.safeGateway(() =>
      this.dependencies.gateway.listEvidenceRequestIds(session.address, role),
    );
    const relevant = (
      await Promise.all(
        requestIds.map(async (requestId) => {
          try {
            return await this.requireWorkflow(requestId, session.address);
          } catch (error) {
            if (
              error instanceof ProductionFlowApiError &&
              ['REQUEST_NOT_FOUND', 'ON_CHAIN_RECORD_MISMATCH'].includes(error.code)
            )
              return undefined;
            throw error;
          }
        }),
      )
    ).filter((record): record is EvidenceWorkflowRecord => Boolean(record));
    const requests = await Promise.all(
      relevant.map(async (record) => {
        const chain = await this.safeGateway(() =>
          this.dependencies.gateway.getEvidenceRequest(record.requestId),
        );
        if (
          !chain ||
          (!sameAddress(session.address, chain.requester) &&
            !sameAddress(session.address, chain.supplier))
        )
          return null;
        try {
          this.assertRequestMatches(chain, record);
        } catch {
          return null;
        }
        let context: { productBatchId?: string; requesterRole?: CompanyRole } = {};
        try {
          const stored = JSON.parse(await this.requestContent(record)) as typeof context;
          context = {
            ...(typeof stored.productBatchId === 'string'
              ? { productBatchId: stored.productBatchId }
              : {}),
            ...(stored.requesterRole ? { requesterRole: stored.requesterRole } : {}),
          };
        } catch {
          // Legacy requests do not carry requester/product context.
        }
        return chain
          ? {
              ...chain,
              ...context,
              requestId: record.requestId,
              verification: record.response?.verification ?? { state: 'NOT_VERIFIED' as const },
              accepted:
                chain.status === 3 &&
                (await this.safeGateway(() =>
                  this.dependencies.gateway.getAccepted(record.batchId, record.requester),
                )),
            }
          : null;
      }),
    );
    const visibleRequests = requests.filter((request) => request !== null);
    const names = await this.identityNames(
      visibleRequests.flatMap((request) => [request.requester, request.supplier]),
    );
    return {
      requests: visibleRequests.map((request) => ({
        ...request,
        manufacturerName: names.get(request.requester.toLowerCase()),
        requesterName: names.get(request.requester.toLowerCase()),
        supplierName: names.get(request.supplier.toLowerCase()),
      })),
    };
  }

  async listRetailerEvidenceOptions(sessionId?: string) {
    const session = await this.requireRole(sessionId, CompanyRole.RETAILER, 'REQUEST_EVIDENCE');
    const productIds = await this.safeGateway(() =>
      this.dependencies.gateway.listReceivedProductBatchIds(session.address),
    );
    const proposedIds =
      (await this.dependencies.gateway.listProposedProductBatchIds?.(session.address)) ?? [];
    const nested = await Promise.all(
      [...new Set([...productIds, ...proposedIds])].map(async (productBatchId) => {
        const product = await this.safeGateway(() =>
          this.dependencies.gateway.getProduct(productBatchId),
        );
        if (!product || product.status !== 1 || product.expiresAt <= this.nowSeconds()) return [];
        const links = await this.safeGateway(() =>
          this.dependencies.gateway.getProductLinks(productBatchId),
        );
        const productPresentation = await this.productPresentation(productBatchId);
        return Promise.all(
          links.map(async (link) => {
            const ingredient = await this.safeGateway(() =>
              this.dependencies.gateway.getIngredient(link.batchId),
            );
            const ingredientPresentation = await this.ingredientPresentation(link.batchId);
            return ingredient
              ? {
                  ingredientBatchId: link.batchId,
                  ingredientName: ingredientPresentation?.ingredientName,
                  ingredientBatchReference: ingredientPresentation?.batchReference,
                  productBatchId,
                  productName: productPresentation?.productName,
                  productBatchReference: productPresentation?.batchReference,
                  quantity: link.quantity,
                  supplier: ingredient.supplier,
                }
              : null;
          }),
        );
      }),
    );
    const options = nested
      .flat()
      .filter((option): option is NonNullable<typeof option> => Boolean(option));
    const names = await this.identityNames(options.map((option) => option.supplier));
    return {
      options: options.map((option) => ({
        ...option,
        supplierName: names.get(option.supplier.toLowerCase()),
      })),
    };
  }

  async getEvidenceDetails(sessionId: string | undefined, requestId: string) {
    const session = await this.requireEitherRole(sessionId);
    const workflow = await this.requireWorkflow(requestId, session.address);
    if (
      !sameAddress(session.address, workflow.requester) &&
      !sameAddress(session.address, workflow.supplier)
    )
      throw new ProductionFlowApiError(
        'REQUEST_NOT_FOUND',
        'The evidence request was not found.',
        404,
      );
    const chain = await this.requireChainRequest(requestId);
    this.assertRequestMatches(chain, workflow);
    const request = JSON.parse(await this.requestContent(workflow)) as {
      claims?: string[];
      requiredClaims?: string[];
      reason?: string;
    };
    let presentation: unknown;
    let supplierSource:
      { credentialFormat: string; legacyClaims?: Record<string, unknown> } | undefined;
    if (sameAddress(session.address, workflow.supplier)) {
      const source = await this.ingredientRecord(workflow.batchId);
      if (source && sameAddress(source.supplierWallet, session.address)) {
        if (source.credentialFormat === 'SD_JWT_VC')
          supplierSource = { credentialFormat: 'SD_JWT_VC' };
        else {
          const stored = JSON.parse(
            await this.dependencies.contentStore.decrypt(source.encryptedPayload),
          );
          supplierSource = {
            credentialFormat: 'JWT_VC',
            legacyClaims: stored.credential?.credentialSubject,
          };
        }
      }
    }
    if (workflow.response && chain.status >= 2) {
      const serializedPresentation = await this.responseContent(workflow);
      if (
        sha256(serializedPresentation).toLowerCase() !==
        workflow.response!.presentationHash.toLowerCase()
      )
        throw this.recordMismatch('Presentation integrity hash mismatch.');
      const ingredient = await this.ingredientRecord(workflow.batchId);
      if (ingredient?.credentialFormat === 'SD_JWT_VC') {
        presentation = serializedPresentation;
      } else {
        try {
          presentation = JSON.parse(serializedPresentation);
        } catch {
          throw new ProductionFlowApiError(
            'PRESENTATION_STRUCTURE_INVALID',
            'The stored evidence presentation has an unsupported format.',
            409,
          );
        }
      }
    }
    return {
      batchId: workflow.batchId,
      claims: request.claims ?? [],
      ...supplierSource,
      requiredClaims: request.requiredClaims ?? request.claims ?? [],
      policy: (request as EvidenceRequestPrivatePayload).policy,
      dueAt: workflow.dueAt,
      presentation,
      presentationExpiresAt: chain.presentationExpiresAt,
      reason: request.reason ?? 'Unavailable',
      requestId,
      requester: workflow.requester,
      status: chain.status,
      supplier: workflow.supplier,
    };
  }

  async reviewEvidence(sessionId: string | undefined, requestId: string) {
    const session = await this.requireEvidenceRequester(sessionId);
    const workflow = await this.requireWorkflow(requestId, session.address);
    if (!sameAddress(session.address, workflow.requester))
      throw new ProductionFlowApiError(
        'REQUEST_NOT_FOUND',
        'The evidence request was not found.',
        404,
      );
    const chain = await this.requireChainRequest(requestId);
    this.assertRequestMatches(chain, workflow);
    if (!workflow.response || chain.status < 2)
      throw new ProductionFlowApiError(
        'EVIDENCE_NOT_RECEIVED',
        'No presentation has been received for this request.',
        409,
      );
    const serializedPresentation = await this.responseContent(workflow);
    const ingredient = await this.ingredientRecord(workflow.batchId);
    if (ingredient?.credentialFormat === 'SD_JWT_VC') {
      let claims: Record<string, unknown>;
      try {
        claims = await readIngredientSdJwtClaims(serializedPresentation);
      } catch {
        throw new ProductionFlowApiError(
          'PRESENTATION_STRUCTURE_INVALID',
          'The received selective presentation could not be decoded.',
          409,
        );
      }
      const names = await this.identityNames([workflow.supplier]);
      const expiry = Number(claims.exp ?? 0);
      const request = JSON.parse(
        await this.requestContent(workflow),
      ) as EvidenceRequestPrivatePayload & {
        requiredClaims?: string[];
      };
      const required = request.requiredClaims ?? request.claims ?? [];
      // Computed from the disclosures so it holds for records recovered from chain references.
      const unmetRequirements = request.policy
        ? ingredientDisclosureErrors(
            claims,
            request.policy,
            required,
            String(claims.batchReference ?? ''),
          )
        : unmetIngredientClaims(claims, required);
      const sharedClaims = visibleIngredientClaims(
        Object.fromEntries(
          Object.entries(claims).filter(
            ([key]) => !['iss', 'sub', 'vct', 'cnf', 'iat', 'exp'].includes(key),
          ),
        ),
      );
      return {
        batchId: workflow.batchId,
        credentialExpiry: expiry ? new Date(expiry * 1_000).toISOString() : 'Unavailable',
        credentialId: String(claims.credentialId ?? 'Unavailable'),
        disclosure: 'SELECTIVE_SD_JWT' as const,
        presentationExpiry: new Date(chain.presentationExpiresAt * 1_000).toISOString(),
        requestId,
        sharedClaims,
        unmetRequirements,
        dueAt: workflow.dueAt,
        requestedClaims: request.claims ?? [],
        purpose: request.reason,
        requiredClaims: required,
        supplier: workflow.supplier,
        supplierName: names.get(workflow.supplier.toLowerCase()),
        status: chain.status,
        verification: workflow.response.verification ?? { state: 'NOT_VERIFIED' as const },
      };
    }
    const walletPresentation = parseWalletPresentation(serializedPresentation);
    const presentation = (
      walletPresentation
        ? {
            verifiableCredential: [JSON.parse(walletPresentation.presentation)],
            expirationDate: new Date(
              walletPresentation.proof.context.expiresAt * 1000,
            ).toISOString(),
          }
        : JSON.parse(serializedPresentation)
    ) as {
      expirationDate?: string;
      verifiableCredential?: unknown[];
    };
    const parsed = ingredientCredentialSchema.safeParse(presentation.verifiableCredential?.[0]);
    if (!parsed.success)
      throw new ProductionFlowApiError(
        'PRESENTATION_STRUCTURE_INVALID',
        'The received presentation does not contain a supported Ingredient Credential.',
        409,
      );
    const credential = parsed.data;
    const names = await this.identityNames([workflow.supplier]);
    return {
      batchId: workflow.batchId,
      credentialExpiry: credential.expirationDate,
      credentialId: credential.id,
      disclosure: 'FULL_INGREDIENT_CREDENTIAL' as const,
      dueAt: workflow.dueAt,
      presentationExpiry:
        presentation.expirationDate ?? new Date(chain.presentationExpiresAt * 1_000).toISOString(),
      requestId,
      sharedClaims: visibleIngredientClaims({
        ...(credential.credentialSubject.originDetails
          ? { originDetails: credential.credentialSubject.originDetails }
          : {}),
        ...(credential.credentialSubject.allergen
          ? { allergen: credential.credentialSubject.allergen }
          : {}),
        ...(credential.credentialSubject.certificationEntries
          ? { certificationEntries: credential.credentialSubject.certificationEntries }
          : {}),
        allergenInformation: credential.credentialSubject.allergenInformation,
        batchId: credential.credentialSubject.batchId,
        category: credential.credentialSubject.category,
        certifications: credential.credentialSubject.certifications,
        expiryDate: credential.credentialSubject.expiryDate,
        ingredientName: credential.credentialSubject.ingredientName,
        origin: credential.credentialSubject.origin,
        productionDate: credential.credentialSubject.productionDate,
        quantity: credential.credentialSubject.quantity,
        unit: credential.credentialSubject.unit,
      }),
      supplier: workflow.supplier,
      supplierName: names.get(workflow.supplier.toLowerCase()),
      status: chain.status,
      verification: workflow.response.verification ?? { state: 'NOT_VERIFIED' as const },
    };
  }

  async prepareEvidenceRequest(sessionId: string | undefined, input: EvidenceRequestInput) {
    const authenticated = await this.dependencies.authService.requireSession(sessionId);
    const requesterRole = authenticated.onChainAuthorization?.role;
    if (requesterRole !== CompanyRole.MANUFACTURER && requesterRole !== CompanyRole.RETAILER)
      throw new ProductionFlowApiError(
        'ROLE_AUTHORIZATION_REQUIRED',
        'A current Manufacturer or Retailer authorization is required.',
        403,
      );
    const session = await this.requireRole(sessionId, requesterRole, 'REQUEST_EVIDENCE');
    const dueAt = Math.floor(input.dueAt.getTime() / 1_000);
    if (dueAt <= this.nowSeconds()) {
      throw new ProductionFlowApiError(
        'INVALID_DEADLINE',
        'The evidence deadline must be in the future.',
        400,
      );
    }
    const batch = await this.requireActiveIngredient(input.batchId);
    if (requesterRole === CompanyRole.RETAILER) {
      if (!input.productBatchId)
        throw new ProductionFlowApiError(
          'PRODUCT_CONTEXT_REQUIRED',
          'Retailer evidence requests require an inspected product batch.',
          400,
        );
      const received = await this.safeGateway(() =>
        this.dependencies.gateway.listReceivedProductBatchIds(session.address),
      );
      const proposed =
        (await this.dependencies.gateway.listProposedProductBatchIds?.(session.address)) ?? [];
      if (
        ![...received, ...proposed].some(
          (id) => id.toLowerCase() === input.productBatchId!.toLowerCase(),
        )
      ) {
        // Browsing permits asking for evidence, never reading confidential claims without consent.
        const product = await this.safeGateway(() =>
          this.dependencies.gateway.getProduct(input.productBatchId!),
        );
        if (
          !product ||
          product.status !== 1 ||
          product.expiresAt <= this.nowSeconds() ||
          !(await this.safeGateway(() =>
            this.dependencies.gateway.isRoleAuthorized(product.manufacturer, 3),
          ))
        )
          throw new ProductionFlowApiError(
            'PRODUCT_ACCESS_DENIED',
            'Select an active registered product from an authorized Manufacturer before requesting details.',
            403,
          );
      }
      const links = await this.safeGateway(() =>
        this.dependencies.gateway.getProductLinks(input.productBatchId!),
      );
      if (!links.some((link) => link.batchId.toLowerCase() === input.batchId.toLowerCase()))
        throw new ProductionFlowApiError(
          'INGREDIENT_NOT_LINKED',
          'The selected ingredient is not linked to this product batch.',
          409,
        );
    }
    const existing = await this.dependencies.repository.findEvidenceByOperation(
      input.operationId,
      session.address,
    );
    let workflow = existing;
    if (workflow) {
      if (workflow.batchId.toLowerCase() !== input.batchId.toLowerCase()) {
        throw new ProductionFlowApiError(
          'DUPLICATE_OPERATION',
          'This operation ID is already bound to a different evidence request.',
          409,
        );
      }
    } else {
      workflow = await this.createEvidenceWorkflow(session, input, batch.supplier, dueAt);
    }

    const chain = await this.safeGateway(() =>
      this.dependencies.gateway.getEvidenceRequest(workflow!.requestId),
    );
    if (chain) {
      this.assertRequestMatches(chain, workflow);
      return {
        actorWallet: session.address,
        requestId: workflow.requestId,
        state: 'COMPLETE' as const,
        status: chain.status,
      };
    }
    return {
      actorWallet: session.address,
      requestId: workflow.requestId,
      state: 'TRANSACTION_REQUIRED' as const,
      transaction: this.dependencies.gateway.prepareEvidenceRequest({
        batchId: workflow.batchId,
        challengeHash: workflow.challengeHash,
        claimsHash: workflow.claimsHash,
        dueAt: workflow.dueAt,
        requestCid: workflow.requestCid,
        requestId: workflow.requestId,
        supplier: workflow.supplier,
      }),
    };
  }

  async requestCompanyIdentityProof(
    sessionId: string | undefined,
    requestId: string,
    input: {
      purpose?: string;
      expiresAt?: number;
      requiredClaims?: string[];
      optionalClaims?: string[];
    } = {},
  ) {
    if (this.dependencies.walletCompanyExchange && !this.dependencies.companyReferences)
      throw new ProductionFlowApiError(
        'COMPANY_PROOF_REGISTRY_REQUIRED',
        'Deploy and configure CompanyProofRegistry before creating shared company requests.',
        503,
      );
    const session = await this.requireRole(
      sessionId,
      CompanyRole.SUPPLIER,
      'ISSUE_INGREDIENT_CREDENTIAL',
    );
    const workflow = await this.requireWorkflow(requestId, session.address);
    const chain = await this.requireChainRequest(requestId);
    if (!sameAddress(session.address, workflow.supplier) || chain.status !== 1)
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_NOT_REQUESTABLE',
        'Only the intended Supplier can request identity proof while evidence is awaiting response.',
        409,
      );
    if (workflow.identityProof?.status === 'VERIFIED') return this.identityProofSummary(workflow);
    if (
      workflow.identityProof?.status === 'REQUESTED' &&
      workflow.identityProof.expiresAt > this.nowSeconds()
    )
      return {
        ...this.identityProofSummary(workflow),
        actorWallet: session.address,
        transaction: this.dependencies.companyReferences
          ? await this.companyReferenceTransaction(workflow)
          : undefined,
      };
    const requesterSessionRole = await this.requesterRole(workflow);
    if (![CompanyRole.MANUFACTURER, CompanyRole.RETAILER].includes(requesterSessionRole))
      throw new ProductionFlowApiError(
        'IDENTITY_PRESENTER_ROLE_INVALID',
        'Only the requesting Manufacturer or Retailer can present company identity.',
        409,
      );
    workflow.identityProof = {
      selectiveDisclosure: true,
      requiredClaims: [
        ...new Set([
          ...COMPANY_ALWAYS_CLAIMS,
          ...companyDisclosureGroup(input.requiredClaims ?? []),
        ]),
      ],
      optionalClaims: companyDisclosureGroup(input.optionalClaims ?? []),
      audience: session.address.toLowerCase(),
      challenge: randomBytes(32).toString('base64url'),
      expiresAt: Math.min(chain.dueAt, input.expiresAt ?? this.nowSeconds() + 15 * 60),
      presenterRole: requesterSessionRole,
      presenterWallet: workflow.requester,
      purpose:
        input.purpose ??
        `Confirm requester company identity before ingredient evidence disclosure for ${requestId}`,
      status: 'REQUESTED',
    };
    await this.dependencies.repository.saveEvidence(workflow);
    return {
      ...this.identityProofSummary(workflow),
      actorWallet: session.address,
      transaction: this.dependencies.companyReferences
        ? await this.companyReferenceTransaction(workflow)
        : undefined,
    };
  }

  async getCompanyIdentityProofMaterial(sessionId: string | undefined, requestId: string) {
    if (this.dependencies.walletCompanyExchange && !this.dependencies.companyReferences)
      throw new ProductionFlowApiError(
        'COMPANY_PROOF_REGISTRY_REQUIRED',
        'Configure the shared CompanyProofRegistry before creating new company presentations.',
        503,
      );
    const session = await this.requireIdentitySession(sessionId, requestId, true);
    const workflow = await this.requireWorkflow(requestId, session.address);
    if (!sameAddress(session.address, workflow.requester))
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_ACCESS_DENIED',
        'Only the requesting company can present its identity.',
        403,
      );
    const proof = workflow.identityProof;
    if (!proof || proof.status !== 'REQUESTED' || proof.expiresAt <= this.nowSeconds())
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_REQUEST_EXPIRED',
        'The Supplier identity-proof request is unavailable or expired.',
        409,
      );
    if (this.dependencies.companyReferences) {
      if (!workflow.sharedIdentity)
        throw new ProductionFlowApiError(
          'SHARED_REQUEST_PUBLICATION_REQUIRED',
          'The requesting company must complete the on-chain shared-reference transaction before a new presentation can be signed.',
          409,
        );
      return this.walletCompanyMaterial(session, workflow);
    }
    const identity = await this.dependencies.messagingIdentityRepository?.findIdentityByWallet(
      session.address,
    );
    if (!identity)
      throw new ProductionFlowApiError(
        'HOLDER_KEY_BINDING_REQUIRED',
        'Create or restore the wallet-bound messaging identity before presenting company identity.',
        409,
      );
    const authorization = session.onChainAuthorization!;
    const issuance = (await this.dependencies.companyRoleRepository?.list())?.find(
      (record) =>
        sameAddress(record.applicantWallet, session.address) &&
        normalizeHash(record.credentialHash) === normalizeHash(authorization.credentialHash ?? ''),
    );
    if (!issuance)
      throw new ProductionFlowApiError(
        'COMPANY_CREDENTIAL_UNAVAILABLE',
        'The current encrypted Company Role Credential is unavailable.',
        404,
      );
    const credential = companyRoleCredentialSchema.parse(
      JSON.parse(await this.dependencies.contentStore.decrypt(issuance.encryptedPayload)),
    );
    if (proof.selectiveDisclosure) {
      const agent = await this.dependencies.agentProvider();
      const issuerDid =
        typeof credential.issuer === 'string' ? credential.issuer : credential.issuer.id;
      const verified = await verifyCompanyRoleCredential(
        agent,
        credential,
        session.address,
        issuerDid,
        this.clock(),
      );
      if (
        !verified.verified ||
        normalizeHash(verified.credentialHash ?? '') !== normalizeHash(issuance.credentialHash)
      )
        throw new ProductionFlowApiError(
          'COMPANY_CREDENTIAL_INVALID',
          'The original Company Role Credential could not be verified before creating a selective proof.',
          409,
        );
      const expiresAt = Math.min(
        proof.expiresAt,
        Math.floor(new Date(credential.expirationDate).getTime() / 1000),
      );
      const sdJwt = await issueCompanyIdentitySdJwt(agent, {
        issuerDid,
        holderDid: identity.did,
        credentialHash: issuance.credentialHash,
        sourceCredentialId: credential.id,
        sourceCredentialIssuedAt: credential.issuanceDate,
        sourceCredentialExpiresAt: credential.expirationDate,
        claims: credential.credentialSubject,
        requestId,
        purpose: proof.purpose,
        audience: proof.audience,
        challenge: proof.challenge,
        issuedAt: this.nowSeconds(),
        expiresAt,
      });
      return {
        format: 'COMPANY_IDENTITY_SD_JWT' as const,
        sdJwt,
        claims: Object.fromEntries(
          Object.entries(credential.credentialSubject).filter(
            ([key]) =>
              [
                ...COMPANY_ALWAYS_CLAIMS,
                ...companyDisclosureGroup(proof.requiredClaims ?? []),
                ...companyDisclosureGroup(proof.optionalClaims ?? []),
              ].includes(key) &&
              (!['companyRegistrationNumber', 'registrationCountry'].includes(key) ||
                !!credential.credentialSubject.registrationCountry),
          ),
        ),
        policyVersion: 2,
        binding: {
          issuerDid,
          credentialId: credential.id,
          credentialHash: issuance.credentialHash,
          credentialIssuedAt: credential.issuanceDate,
          credentialExpiresAt: credential.expirationDate,
          holderDid: identity.did,
        },
        requiredClaims: [
          ...new Set([
            ...COMPANY_ALWAYS_CLAIMS,
            ...companyDisclosureGroup(proof.requiredClaims ?? []),
          ]),
        ],
        optionalClaims: companyDisclosureGroup(proof.optionalClaims ?? []),
        audience: proof.audience,
        challenge: proof.challenge,
        expiresAt,
        holderDid: identity.did,
        credentialHash: issuance.credentialHash,
        presenterRole: proof.presenterRole,
        presenterWallet: proof.presenterWallet,
        purpose: proof.purpose,
        requestId,
      };
    }
    return {
      audience: proof.audience,
      challenge: proof.challenge,
      credential,
      credentialHash: issuance.credentialHash,
      expiresAt: proof.expiresAt,
      holderDid: identity.did,
      presenterRole: proof.presenterRole,
      presenterWallet: proof.presenterWallet,
      purpose: proof.purpose,
      requestId,
    };
  }

  async presentCompanyIdentityProof(
    sessionId: string | undefined,
    requestId: string,
    presentation: string,
  ) {
    const session = await this.requireIdentitySession(sessionId, requestId, true);
    const workflow = await this.requireWorkflow(requestId, session.address);
    if (!sameAddress(session.address, workflow.requester))
      throw new ProductionFlowApiError('IDENTITY_PROOF_ACCESS_DENIED', 'Wrong presenter.', 403);
    if (workflow.sharedIdentity) {
      const refs = this.sharedCompanyReferences()!;
      const current = (await refs.get(requestId))!;
      if (
        current.status >= 2 &&
        current.status <= 3 &&
        current.responseHash.toLowerCase() === sha256(presentation).toLowerCase()
      )
        return {
          ...this.identityProofSummary(workflow),
          actorWallet: session.address,
          state: 'COMPLETE' as const,
          transaction: undefined,
        };
      if (current.status !== 1)
        throw new ProductionFlowApiError(
          'IDENTITY_PROOF_REPLAY',
          'This company request has already been answered.',
          409,
        );
      await this.verifyCompanyIdentityPresentation(workflow, presentation);
      const stored = await this.store(presentation, `${requestId}-company-identity-proof`);
      return {
        ...this.identityProofSummary(workflow),
        actorWallet: session.address,
        state: 'TRANSACTION_REQUIRED' as const,
        transaction: refs.prepare('respond', [
          requestId,
          current.challengeHash,
          sha256(presentation),
          stored.cid,
        ]),
      };
    }
    if (workflow.identityProof?.status !== 'REQUESTED')
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_REPLAY',
        'This identity-proof challenge has already been answered or is unavailable.',
        409,
      );
    await this.verifyCompanyIdentityPresentation(workflow, presentation);
    const stored = await this.store(presentation, `${requestId}-company-identity-proof`);
    workflow.identityProof = {
      ...workflow.identityProof!,
      presentationCid: stored.cid,
      presentationPayload: stored.payload,
      status: 'PRESENTED',
    };
    await this.dependencies.repository.saveEvidence(workflow);
    return this.identityProofSummary(workflow);
  }

  async verifyCompanyIdentityProof(sessionId: string | undefined, requestId: string) {
    const session = await this.requireIdentitySession(sessionId, requestId, false);
    const workflow = await this.requireWorkflow(requestId, session.address);
    if (
      !sameAddress(session.address, workflow.supplier) ||
      (!workflow.identityProof?.presentationPayload && !workflow.identityProof?.presentationCid)
    )
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_ACCESS_DENIED',
        'Only the intended Supplier can verify the received identity proof.',
        403,
      );
    const presentation = workflow.identityProof.presentationPayload
      ? await this.dependencies.contentStore.decrypt(workflow.identityProof.presentationPayload)
      : await this.retrieveEncrypted(
          workflow.identityProof.presentationCid ?? '',
          'COMPANY_IDENTITY_PRESENTATION',
        );
    // Re-verifying an already verified proof checks it as of its recorded verification time
    // (historical verification); the company's current on-chain authorization is still checked.
    const verifiedAt = this.recordedVerificationTime(workflow);
    const result = await this.verifyCompanyIdentityPresentation(workflow, presentation, verifiedAt);
    if (verifiedAt === undefined) {
      workflow.identityProof.status = 'VERIFIED';
      workflow.identityProof.verifiedAt = this.clock().toISOString();
      await this.dependencies.repository.saveEvidence(workflow);
    }
    return {
      ...this.identityProofSummary(workflow),
      actorWallet: session.address,
      transaction:
        workflow.sharedIdentity &&
        (await this.sharedCompanyReferences()!.get(requestId))?.status === 2
          ? this.sharedCompanyReferences()!.prepare('review', [requestId, false])
          : undefined,
      checks: result.checks,
      missingClaims: result.missingClaims,
      credential:
        result.selectedClaims ??
        this.identityCredentialSummary(result.credential, result.credentialHash),
    };
  }

  /**
   * Recorded company-proof outcome for later workflow gates. The short-lived presentation was
   * verified cryptographically when the status became VERIFIED; shared requests read the status
   * from the hash-checked registry reference, so the on-chain review must be confirmed.
   */
  async companyIdentityProofOutcome(requestId: string, participant: string) {
    const workflow = await this.requireWorkflow(requestId, participant);
    return {
      status: workflow.identityProof?.status,
      presenterWallet: workflow.identityProof?.presenterWallet,
    };
  }

  async declineCompanyIdentityProof(sessionId: string | undefined, requestId: string) {
    const session = await this.requireIdentitySession(sessionId, requestId, true);
    const workflow = await this.requireWorkflow(requestId, session.address);
    if (!sameAddress(session.address, workflow.requester))
      throw new ProductionFlowApiError('IDENTITY_PROOF_ACCESS_DENIED', 'Wrong presenter.', 403);
    if (workflow.sharedIdentity)
      return {
        ...this.identityProofSummary(workflow),
        actorWallet: session.address,
        transaction: this.sharedCompanyReferences()!.prepare('review', [requestId, true]),
      };
    if (workflow.identityProof?.status !== 'REQUESTED')
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_REPLAY',
        'This identity-proof challenge has already been answered or is unavailable.',
        409,
      );
    workflow.identityProof.status = 'DECLINED';
    await this.dependencies.repository.saveEvidence(workflow);
    return this.identityProofSummary(workflow);
  }

  /**
   * The verifier rejects shared company evidence after reviewing it, like rejecting ingredient
   * evidence: only a hash of the reason is recorded.
   */
  async rejectCompanyIdentityProof(
    sessionId: string | undefined,
    requestId: string,
    reason: string,
  ) {
    const session = await this.requireIdentitySession(sessionId, requestId, false);
    const workflow = await this.requireWorkflow(requestId, session.address);
    if (!sameAddress(session.address, workflow.supplier))
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_ACCESS_DENIED',
        'Only the requesting company can reject the received evidence.',
        403,
      );
    if (!reason.trim())
      throw new ProductionFlowApiError('REJECT_REASON_REQUIRED', 'Enter a rejection reason.', 400);
    if (workflow.sharedIdentity) {
      if ((await this.sharedCompanyReferences()!.get(requestId))?.status !== 2)
        throw new ProductionFlowApiError(
          'IDENTITY_PROOF_REPLAY',
          'Only shared evidence that is not yet decided can be rejected.',
          409,
        );
      return {
        ...this.identityProofSummary(workflow),
        actorWallet: session.address,
        transaction: this.sharedCompanyReferences()!.prepare('reject', [requestId, id(reason)]),
      };
    }
    if (workflow.identityProof?.status !== 'PRESENTED')
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_REPLAY',
        'Only shared evidence that is not yet decided can be rejected.',
        409,
      );
    workflow.identityProof.status = 'REJECTED';
    await this.dependencies.repository.saveEvidence(workflow);
    return this.identityProofSummary(workflow);
  }

  async getCompanyIdentityProofStatus(sessionId: string | undefined, requestId: string) {
    const session = await this.requireIdentitySession(sessionId, requestId, false);
    const workflow = await this.requireWorkflow(requestId, session.address);
    if (
      !sameAddress(session.address, workflow.requester) &&
      !sameAddress(session.address, workflow.supplier)
    )
      throw new ProductionFlowApiError('IDENTITY_PROOF_ACCESS_DENIED', 'Access denied.', 403);
    const summary = this.identityProofSummary(workflow);
    if (
      sameAddress(session.address, workflow.supplier) &&
      workflow.identityProof?.status === 'VERIFIED' &&
      (!workflow.deliveryOrderId || workflow.identityProof.expiresAt > this.nowSeconds()) &&
      (workflow.identityProof.presentationPayload || workflow.identityProof.presentationCid)
    ) {
      // Already verified: re-check as of the recorded verification time (historical verification).
      const verifiedAt = Date.parse(workflow.identityProof.verifiedAt ?? '');
      const checked = await this.verifyCompanyIdentityPresentation(
        workflow,
        workflow.identityProof.presentationPayload
          ? await this.dependencies.contentStore.decrypt(workflow.identityProof.presentationPayload)
          : await this.retrieveEncrypted(
              workflow.identityProof.presentationCid!,
              'COMPANY_IDENTITY_PRESENTATION',
            ),
        Number.isFinite(verifiedAt) ? Math.floor(verifiedAt / 1000) : undefined,
      );
      return {
        ...summary,
        missingClaims: checked.missingClaims,
        credential:
          checked.selectedClaims ??
          this.identityCredentialSummary(checked.credential, checked.credentialHash),
        checks: [
          'AUTHORITY_SIGNATURE',
          'HOLDER_SIGNATURE',
          'WALLET_BINDING',
          'ROLE_BINDING',
          'CHALLENGE_AND_RECIPIENT',
          'EXPIRY',
          'CURRENT_ON_CHAIN_STATUS',
        ],
      };
    }
    return summary;
  }

  async prepareEvidenceResponse(
    sessionId: string | undefined,
    requestId: string,
    holderResponse?: { presentation: string },
  ) {
    const session = await this.requireRole(
      sessionId,
      CompanyRole.SUPPLIER,
      'ISSUE_INGREDIENT_CREDENTIAL',
    );
    const workflow = await this.requireWorkflow(requestId, session.address);
    const chain = await this.requireChainRequest(requestId);
    if (
      !sameAddress(chain.supplier, session.address) ||
      !sameAddress(workflow.supplier, session.address)
    ) {
      throw new ProductionFlowApiError(
        'WRONG_SUPPLIER',
        'Only the intended Supplier wallet can respond to this request.',
        403,
      );
    }
    if (chain.status >= 2) {
      if (
        !workflow.response ||
        workflow.response.presentationCid !== chain.presentationCid ||
        workflow.response.presentationHash.toLowerCase() !== chain.presentationHash.toLowerCase()
      ) {
        throw this.recordMismatch(
          'The on-chain presentation does not match the prepared response.',
        );
      }
      return {
        actorWallet: session.address,
        requestId,
        state: 'COMPLETE' as const,
        status: chain.status,
      };
    }
    if (chain.status !== 1 || chain.dueAt <= this.nowSeconds()) {
      throw new ProductionFlowApiError(
        'REQUEST_NOT_RESPONDABLE',
        'This evidence request is expired or no longer awaits a response.',
        409,
      );
    }
    const batch = await this.requireActiveIngredient(workflow.batchId);
    const sourceStatus = await this.safeGateway(() =>
      this.dependencies.gateway.getCredential(batch.credentialId),
    );
    if (!sourceStatus || sourceStatus.status !== 1 || sourceStatus.expiresAt <= this.nowSeconds())
      throw new ProductionFlowApiError(
        'CREDENTIAL_INACTIVE',
        'This Ingredient Credential is suspended, revoked or expired. It cannot be shared as current evidence.',
        409,
      );
    if (!sameAddress(batch.supplier, session.address)) {
      throw new ProductionFlowApiError(
        'BATCH_OWNERSHIP_MISMATCH',
        'The requested ingredient batch is not owned by this Supplier.',
        403,
      );
    }

    let response = workflow.response;
    if (!response) {
      const ingredient = await this.ingredientRecord(workflow.batchId);
      if (
        ingredient?.credentialFormat === 'JWT_VC' &&
        !holderResponse &&
        this.dependencies.gateway.presentationDomain
      ) {
        const request = JSON.parse(await this.requestContent(workflow));
        const envelope = JSON.parse(
          await this.dependencies.contentStore.decrypt(ingredient.encryptedPayload),
        );
        return {
          actorWallet: session.address,
          requestId,
          state: 'HOLDER_SIGNATURE_REQUIRED' as const,
          holderSigning: {
            credential: canonical(envelope.credential),
            holderDid: '',
            claims: request.claims ?? [],
            requiredClaims: request.requiredClaims ?? [],
            audience: workflow.requester,
            nonce: request.challenge,
            purpose: request.reason,
            walletContext: {
              ...this.dependencies.gateway.presentationDomain(),
              holder: session.address,
              verifier: workflow.requester,
              requestId,
              purpose: request.reason,
              challenge: request.challenge,
              batchId: workflow.batchId,
              issuedAt: this.nowSeconds(),
              expiresAt: Math.min(workflow.dueAt, ingredient.expiresAt),
            },
          },
        };
      }
      if (ingredient?.credentialFormat === 'SD_JWT_VC' && !holderResponse) {
        const request = JSON.parse(await this.requestContent(workflow)) as {
          challenge?: string;
          claims?: string[];
          requiredClaims?: string[];
          reason?: string;
        };
        const envelope = JSON.parse(
          await this.dependencies.contentStore.decrypt(ingredient.encryptedPayload),
        ) as { sdJwt?: string };
        if (!request.challenge || !envelope.sdJwt || !ingredient.holderDid)
          throw this.recordMismatch('Selective presentation material is incomplete.');
        return {
          actorWallet: session.address,
          holderSigning: {
            walletContext: this.dependencies.gateway.presentationDomain
              ? {
                  ...this.dependencies.gateway.presentationDomain(),
                  holder: session.address,
                  verifier: workflow.requester,
                  requestId,
                  purpose: request.reason ?? 'Ingredient evidence verification',
                  challenge: request.challenge,
                  batchId: workflow.batchId,
                  issuedAt: this.nowSeconds(),
                  expiresAt: Math.min(workflow.dueAt, ingredient.expiresAt),
                }
              : undefined,
            audience: workflow.requester.toLowerCase(),
            claims: request.claims ?? [],
            requiredClaims: request.requiredClaims ?? request.claims ?? [],
            credential: envelope.sdJwt,
            holderDid: ingredient.holderDid,
            nonce: request.challenge,
            purpose: request.reason ?? 'Ingredient evidence verification',
            ...((request as EvidenceRequestPrivatePayload).policy
              ? {
                  context: {
                    requestId,
                    purpose: request.reason ?? 'Ingredient evidence verification',
                    batchId: workflow.batchId,
                    expiresAt: Math.min(workflow.dueAt, ingredient.expiresAt),
                  },
                }
              : {}),
          },
          requestId,
          state: 'HOLDER_SIGNATURE_REQUIRED' as const,
        };
      }
      response = await this.createEvidenceResponse(
        workflow,
        session.address,
        holderResponse?.presentation,
      );
      await this.dependencies.repository.saveEvidence({ ...workflow, response });
    }
    return {
      actorWallet: session.address,
      requestId,
      state: 'TRANSACTION_REQUIRED' as const,
      transaction: this.dependencies.gateway.prepareEvidenceResponse({
        expiresAt: response.presentationExpiresAt,
        presentationCid: response.presentationCid,
        presentationHash: response.presentationHash,
        requestId,
      }),
    };
  }

  async prepareEvidenceAcceptance(sessionId: string | undefined, requestId: string) {
    const session = await this.requireEvidenceRequester(sessionId);
    const workflow = await this.requireWorkflow(requestId, session.address);
    const chain = await this.requireChainRequest(requestId);
    if (
      !sameAddress(chain.requester, session.address) ||
      !sameAddress(workflow.requester, session.address)
    ) {
      throw new ProductionFlowApiError(
        'WRONG_MANUFACTURER',
        'Only the requesting Manufacturer wallet can accept this evidence.',
        403,
      );
    }
    if (chain.status === 3) {
      const requesterRole = await this.requesterRole(workflow);
      if (requesterRole === CompanyRole.MANUFACTURER) {
        const accepted = await this.safeGateway(() =>
          this.dependencies.gateway.getAccepted(workflow.batchId, session.address),
        );
        if (!accepted) throw this.recordMismatch('The accepted evidence flag is missing.');
      }
      return { actorWallet: session.address, requestId, state: 'COMPLETE' as const, status: 3 };
    }
    if (chain.status !== 2 || chain.presentationExpiresAt <= this.nowSeconds()) {
      throw new ProductionFlowApiError(
        'EVIDENCE_NOT_ACCEPTABLE',
        'This presentation is expired or not ready for acceptance.',
        409,
      );
    }
    if (workflow.response?.verification?.state !== 'PASSED')
      throw new ProductionFlowApiError(
        'EVIDENCE_VERIFICATION_REQUIRED',
        'Verify the received evidence before making an acceptance decision.',
        409,
      );
    const credentialId = await this.verifyPersistedPresentation(workflow, chain);
    return {
      actorWallet: session.address,
      requestId,
      state: 'TRANSACTION_REQUIRED' as const,
      transaction: this.dependencies.gateway.prepareAccept(requestId, credentialId),
    };
  }

  async certificationDocument(
    sessionId: string | undefined,
    requestId: string,
    documentId: string,
  ) {
    const reviewed = await this.reviewEvidence(sessionId, requestId);
    const workflow = await this.requireWorkflow(requestId),
      chain = await this.requireChainRequest(requestId);
    if (![2, 3].includes(chain.status) || chain.presentationExpiresAt <= this.nowSeconds())
      throw new ProductionFlowApiError(
        'EVIDENCE_EXPIRED',
        'The shared presentation has expired or the request was closed.',
        409,
      );
    await this.verifyPersistedPresentation(workflow, chain);
    if (!(await this.dependencies.gateway.isRoleAuthorized(workflow.supplier, 2)))
      throw new ProductionFlowApiError(
        'SUPPLIER_INACTIVE',
        'The Supplier is no longer authorized.',
        403,
      );
    const documents = Object.entries(reviewed.sharedClaims).flatMap(([key, value]) => {
      if (key.startsWith('certificationDocuments_') || key.startsWith('qualityDocuments_'))
        return ((value as { documents?: object[] })?.documents ?? []).map((file) => ({
          ...file,
          entryId:
            (value as { certificationId?: string; qualityTestId?: string }).certificationId ??
            (value as { qualityTestId?: string }).qualityTestId,
        }));
      if (key === 'certificationEntries' || key === 'qualityTests')
        return (value as { id: string; documents: object[] }[]).flatMap((entry) =>
          entry.documents.map((file) => ({ ...file, entryId: entry.id })),
        );
      return [];
    }) as { id: string; sha256: string; cid: string; entryId?: string }[];
    const allowed = documents.find((file) => file.id === documentId);
    const file = await this.dependencies.ingredientRepository.findAttachment?.(documentId);
    if (
      !allowed ||
      !allowed.entryId ||
      !allowed.cid ||
      (file &&
        (file.supplierWallet.toLowerCase() !== workflow.supplier.toLowerCase() ||
          file.sha256 !== allowed.sha256 ||
          file.cid !== allowed.cid ||
          file.certificationId !== allowed.entryId))
    )
      throw new ProductionFlowApiError(
        'DOCUMENT_ACCESS_DENIED',
        'This document was not shared in this exact presentation.',
        403,
      );
    let value;
    try {
      value = JSON.parse(
        file
          ? await this.dependencies.contentStore.decrypt(file.payload)
          : await this.retrieveEncrypted(allowed.cid, 'SHARED_CERTIFICATION_DOCUMENT'),
      );
    } catch (error) {
      throw new ProductionFlowApiError(
        'DOCUMENT_RETRIEVAL_UNAVAILABLE',
        'The encrypted document could not be retrieved. Retry when the service is available.',
        503,
      );
    }
    let actualHash;
    try {
      actualHash = decodeCertificationFile(value).sha256;
    } catch {
      actualHash = 'invalid';
    }
    if (actualHash !== allowed.sha256)
      throw new ProductionFlowApiError(
        'DOCUMENT_HASH_MISMATCH',
        'Document integrity verification failed.',
        409,
      );
    return { fileName: value.fileName, mimeType: value.mimeType, data: value.data };
  }
  async verifyEvidence(sessionId: string | undefined, requestId: string) {
    const session = await this.requireEvidenceRequester(sessionId);
    const workflow = await this.requireWorkflow(requestId, session.address);
    const chain = await this.requireChainRequest(requestId);
    if (
      !sameAddress(chain.requester, session.address) ||
      !sameAddress(workflow.requester, session.address)
    )
      throw new ProductionFlowApiError(
        'WRONG_MANUFACTURER',
        'Only the requesting Manufacturer can verify this evidence.',
        403,
      );
    if (chain.status !== 2 || chain.presentationExpiresAt <= this.nowSeconds())
      throw new ProductionFlowApiError(
        'EVIDENCE_NOT_VERIFIABLE',
        'This presentation is expired or is not ready for verification.',
        409,
      );
    const credentialId = await this.verifyPersistedPresentation(workflow, chain);
    const verifiedAt = this.clock().toISOString();
    await this.dependencies.repository.saveEvidence({
      ...workflow,
      response: {
        ...workflow.response!,
        verification: { state: 'PASSED', verifiedAt },
      },
    });
    return {
      credentialId,
      requestId,
      verifiedAt,
      checks: [
        { code: 'PRESENTATION_PROOF', passed: true },
        { code: 'CHALLENGE_DOMAIN_REQUEST_CONTEXT', passed: true },
        { code: 'HOLDER_AND_SUPPLIER_BINDING', passed: true },
        { code: 'INGREDIENT_CREDENTIAL_SIGNATURE', passed: true },
        { code: 'BATCH_AND_CREDENTIAL_RELATIONSHIP', passed: true },
        { code: 'ON_CHAIN_CREDENTIAL_AND_STAKEHOLDER_STATUS', passed: true },
        { code: 'PRESENTATION_HASH_AND_REFERENCE', passed: true },
      ],
    };
  }

  async prepareEvidenceClose(
    sessionId: string | undefined,
    requestId: string,
    input: EvidenceCloseInput,
  ) {
    const session = await this.requireEitherRole(sessionId);
    const workflow = await this.requireWorkflow(requestId, session.address);
    const chain = await this.requireChainRequest(requestId);
    const status = { DECLINED: 4, REJECTED: 5, CANCELLED: 6 }[input.status];
    const requester = sameAddress(session.address, workflow.requester);
    const supplier = sameAddress(session.address, workflow.supplier);
    const allowed =
      (input.status === 'DECLINED' && supplier && chain.status === 1) ||
      (input.status === 'CANCELLED' && requester && chain.status === 1) ||
      (input.status === 'REJECTED' && requester && chain.status === 2);
    if (!allowed)
      throw new ProductionFlowApiError(
        'INVALID_EVIDENCE_CLOSE',
        'This actor cannot apply that decision in the current request state.',
        409,
      );
    return {
      actorWallet: session.address,
      requestId,
      state: 'TRANSACTION_REQUIRED' as const,
      transaction: this.dependencies.gateway.prepareClose(requestId, status, id(input.reason)),
    };
  }

  async prepareProduct(sessionId: string | undefined, input: ProductRequestInput) {
    const session = await this.requireRole(sessionId, CompanyRole.MANUFACTURER, 'REGISTER_PRODUCT');
    const producedAt = Math.floor(input.producedAt.getTime() / 1_000);
    const expiresAt = Math.floor(input.expiresAt.getTime() / 1_000);
    if (
      producedAt > this.nowSeconds() ||
      expiresAt <= this.nowSeconds() ||
      expiresAt <= producedAt
    ) {
      throw new ProductionFlowApiError('INVALID_PRODUCT_DATES', 'Product dates are invalid.', 400);
    }
    const batchIds = input.ingredientLinks.map((link) => link.batchId.toLowerCase());
    if (new Set(batchIds).size !== batchIds.length)
      throw new ProductionFlowApiError(
        'DUPLICATE_INGREDIENT',
        'Select each ingredient batch only once.',
        400,
      );
    const batchId = id(input.batchReference);
    const metadata = canonical({
      batchReference: input.batchReference,
      ...(input.category ? { category: input.category } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.description ? { description: input.description } : {}),
      privateMetadata: input.privateMetadata,
      productName: input.productName,
      unit: input.unit,
      ...(input.productionLocation
        ? {
            productionLocation: input.productionLocation,
            ...(input.productionLocationName
              ? { productionLocationName: input.productionLocationName }
              : {}),
          }
        : {}),
      ...(input.price !== undefined ? { price: input.price, currency: input.currency } : {}),
    });
    const metadataHash = sha256(metadata);
    const operationHash = sha256(
      canonical({
        ...input,
        expiresAt,
        producedAt,
      }),
    );
    let workflow = await this.dependencies.repository.findPrivate('products', batchId);
    const existing = await this.safeGateway(() => this.dependencies.gateway.getProduct(batchId));
    if (existing) {
      if (
        !workflow ||
        workflow.operationHash !== operationHash ||
        !sameAddress(existing.manufacturer, session.address) ||
        existing.metadataHash.toLowerCase() !== metadataHash.toLowerCase() ||
        existing.publicCid !== workflow.cid ||
        existing.totalQuantity !== input.quantity ||
        existing.producedAt !== producedAt ||
        existing.expiresAt !== expiresAt
      ) {
        throw this.recordMismatch('Product record mismatch.');
      }
      const links = await this.safeGateway(() =>
        this.dependencies.gateway.getProductLinks(batchId),
      );
      if (canonical(links) !== canonical(input.ingredientLinks)) {
        throw this.recordMismatch('Product ingredient links do not match the prepared workflow.');
      }
      return {
        actorWallet: session.address,
        batchId,
        links,
        production: await this.dependencies.gateway.getProductionRecord?.(batchId),
        state: 'COMPLETE' as const,
        status: existing.status,
      };
    }

    // Availability is a pre-transaction rule. Once the product exists, the linked ingredients
    // are verified from the product record above because exact consumption legitimately leaves
    // the location balance at zero.
    for (const link of input.ingredientLinks) {
      const batch = await this.requireActiveIngredient(link.batchId);
      const received = await this.dependencies.gateway.getReceivedAvailable?.(
        link.batchId,
        session.address,
        input.productionLocation,
      );
      if (
        received != null &&
        this.dependencies.gateway.supportsOptionalProductionEvidence &&
        !(await this.safeGateway(() =>
          this.dependencies.gateway.supportsOptionalProductionEvidence!(),
        ))
      )
        throw new ProductionFlowApiError(
          'OPTIONAL_EVIDENCE_DEPLOYMENT_REQUIRED',
          'Deploy the updated registry suite to create products from received stock without mandatory ingredient evidence.',
          409,
        );
      if (
        received == null &&
        !(await this.safeGateway(() =>
          this.dependencies.gateway.getAccepted(link.batchId, session.address),
        ))
      ) {
        throw new ProductionFlowApiError(
          'EVIDENCE_NOT_ACCEPTED',
          'Every ingredient must have accepted evidence for this Manufacturer.',
          409,
        );
      }
      if (received !== null && received !== undefined && !input.productionLocation) {
        throw new ProductionFlowApiError(
          'PRODUCTION_LOCATION_REQUIRED',
          'Select your registered production location. Only accepted stock held at that location can be consumed.',
          400,
        );
      }
      if (BigInt(link.quantity) > BigInt(received ?? batch.availableQuantity)) {
        throw new ProductionFlowApiError(
          'INSUFFICIENT_INGREDIENT_QUANTITY',
          'An ingredient does not have enough accepted usable stock at this production location.',
          409,
        );
      }
    }
    if (!workflow) {
      const stored = await this.store(metadata, batchId);
      workflow = {
        cid: stored.cid,
        contentHash: metadataHash,
        id: batchId,
        operationHash,
        owner: session.address,
        payload: stored.payload,
      };
      await this.dependencies.repository.savePrivate('products', workflow);
    } else if (
      workflow.contentHash !== metadataHash ||
      workflow.operationHash !== operationHash ||
      !sameAddress(workflow.owner, session.address)
    ) {
      throw new ProductionFlowApiError(
        'PRODUCT_WORKFLOW_CONFLICT',
        'This product batch reference is already in use.',
        409,
      );
    }
    return {
      actorWallet: session.address,
      batchId,
      state: 'TRANSACTION_REQUIRED' as const,
      transaction: this.dependencies.gateway.prepareProduct({
        ...(input.productionLocation ? { productionLocation: input.productionLocation } : {}),
        batchId,
        expiresAt,
        ingredients: input.ingredientLinks,
        metadataHash,
        producedAt,
        publicCid: workflow.cid,
        quantity: input.quantity,
        unit: input.unit,
      }),
    };
  }

  async listDistributors(sessionId?: string) {
    await this.requireRole(sessionId, CompanyRole.MANUFACTURER, 'INITIATE_TRANSFER');
    const wallets = await this.safeGateway(() =>
      this.dependencies.gateway.listActiveDistributors(),
    );
    const identities = this.dependencies.stakeholderDirectory
      ? await this.dependencies.stakeholderDirectory.resolveMany(wallets)
      : wallets.map((walletAddress) => ({
          active: true as const,
          companyName: 'Verified Distributor',
          role: CompanyRole.DISTRIBUTOR,
          walletAddress: getAddress(walletAddress),
        }));
    const byWallet = new Map(
      identities.map((identity) => [identity.walletAddress.toLowerCase(), identity]),
    );
    return {
      distributors: wallets
        .map((walletAddress) => byWallet.get(walletAddress.toLowerCase()))
        .filter((identity) => identity?.role === CompanyRole.DISTRIBUTOR),
    };
  }

  async listDistributorInventory(sessionId?: string) {
    const session = await this.requireRole(sessionId, CompanyRole.DISTRIBUTOR, 'INITIATE_TRANSFER');
    const batchIds = await this.safeGateway(() =>
      this.dependencies.gateway.listReceivedProductBatchIds(session.address),
    );
    const products = (
      await Promise.all(
        batchIds.map(async (productBatchId) => {
          const [inventory, product] = await Promise.all([
            this.safeGateway(() =>
              this.dependencies.gateway.getInventory(productBatchId, session.address),
            ),
            this.safeGateway(() => this.dependencies.gateway.getProduct(productBatchId)),
          ]);
          if (!product || BigInt(inventory.available) <= 0n) return null;
          const presentation = await this.productPresentation(productBatchId);
          return {
            availableQuantity: inventory.available,
            productBatchId,
            productName: presentation?.productName,
            productReference: presentation?.batchReference,
            reservedQuantity: inventory.reserved,
            unit: product.unit,
          };
        }),
      )
    ).filter((product) => product !== null);
    return { products };
  }

  async listRetailers(sessionId?: string) {
    await this.requireRole(sessionId, CompanyRole.DISTRIBUTOR, 'INITIATE_TRANSFER');
    const wallets = await this.safeGateway(() => this.dependencies.gateway.listActiveRetailers());
    const identities = this.dependencies.stakeholderDirectory
      ? await this.dependencies.stakeholderDirectory.resolveMany(wallets)
      : [];
    const activeWallets = new Set(wallets.map((wallet) => wallet.toLowerCase()));
    return {
      retailers: identities.filter(
        (identity) =>
          identity.role === CompanyRole.RETAILER &&
          activeWallets.has(identity.walletAddress.toLowerCase()),
      ),
    };
  }

  private async identityNames(wallets: string[]) {
    if (!this.dependencies.stakeholderDirectory) return new Map<string, string>();
    const identities = await this.dependencies.stakeholderDirectory.resolveMany(wallets);
    return new Map(
      identities.map((identity) => [identity.walletAddress.toLowerCase(), identity.companyName]),
    );
  }

  async prepareTransfer(sessionId: string | undefined, input: TransferRequestInput) {
    const session = await this.requireRole(
      sessionId,
      CompanyRole.MANUFACTURER,
      'INITIATE_TRANSFER',
    );
    const recipient = getAddress(input.recipient);
    if (!(await this.safeGateway(() => this.dependencies.gateway.isRoleAuthorized(recipient, 4)))) {
      throw new ProductionFlowApiError(
        'INVALID_DISTRIBUTOR',
        'The recipient is not an active Distributor.',
        409,
      );
    }
    const product = await this.safeGateway(() =>
      this.dependencies.gateway.getProduct(input.productBatchId),
    );
    if (!product || product.status !== 1 || !sameAddress(product.manufacturer, session.address)) {
      throw new ProductionFlowApiError(
        'PRODUCT_NOT_TRANSFERABLE',
        'This wallet cannot transfer the selected product.',
        409,
      );
    }
    if (
      !(await this.safeGateway(() =>
        this.dependencies.gateway.isTransferable(input.productBatchId),
      ))
    ) {
      throw new ProductionFlowApiError(
        'PRODUCT_NOT_TRANSFERABLE',
        'The selected product is not transferable.',
        409,
      );
    }
    const inventory = await this.safeGateway(() =>
      this.dependencies.gateway.getInventory(input.productBatchId, session.address),
    );
    const available = inventory.initialized
      ? BigInt(inventory.available)
      : BigInt(product.totalQuantity);
    if (BigInt(input.quantity) > available) {
      throw new ProductionFlowApiError(
        'INSUFFICIENT_INVENTORY',
        'The Manufacturer inventory is insufficient.',
        409,
      );
    }
    const expectedAt = Math.floor(input.expectedAt.getTime() / 1_000);
    if (expectedAt < this.nowSeconds())
      throw new ProductionFlowApiError(
        'INVALID_EXPECTED_AT',
        'Expected arrival cannot be in the past.',
        400,
      );
    const transferId = id(`${input.shipmentReference}:${session.address}:${recipient}`);
    const shipment = canonical({
      expectedAt,
      productBatchId: input.productBatchId,
      quantity: input.quantity,
      recipient,
      shipmentReference: input.shipmentReference,
    });
    const shipmentHash = sha256(shipment);
    let workflow = await this.dependencies.repository.findPrivate('transfers', transferId);
    const existing = await this.safeGateway(() =>
      this.dependencies.gateway.getTransfer(transferId),
    );
    if (existing) {
      if (
        !workflow ||
        existing.status !== 1 ||
        !sameAddress(existing.sender, session.address) ||
        !sameAddress(existing.recipient, recipient) ||
        existing.productBatchId.toLowerCase() !== input.productBatchId.toLowerCase() ||
        existing.quantity !== input.quantity ||
        existing.expectedAt !== expectedAt ||
        existing.shipmentHash.toLowerCase() !== shipmentHash.toLowerCase() ||
        existing.shipmentCid !== workflow.cid
      )
        throw this.recordMismatch('Transfer record mismatch.');
      return {
        actorWallet: session.address,
        state: 'COMPLETE' as const,
        status: existing.status,
        transferId,
      };
    }
    if (!workflow) {
      const stored = await this.store(shipment, transferId);
      workflow = {
        cid: stored.cid,
        contentHash: shipmentHash,
        id: transferId,
        owner: session.address,
        payload: stored.payload,
      };
      await this.dependencies.repository.savePrivate('transfers', workflow);
    } else if (
      workflow.contentHash !== shipmentHash ||
      !sameAddress(workflow.owner, session.address)
    ) {
      throw new ProductionFlowApiError(
        'TRANSFER_WORKFLOW_CONFLICT',
        'This shipment reference is already in use.',
        409,
      );
    }
    return {
      actorWallet: session.address,
      state: 'TRANSACTION_REQUIRED' as const,
      transferId,
      transaction: this.dependencies.gateway.prepareTransfer({
        expectedAt,
        productBatchId: input.productBatchId,
        quantity: input.quantity,
        recipient,
        shipmentCid: workflow.cid,
        shipmentHash,
        transferId,
      }),
    };
  }

  async prepareDistributorTransfer(
    sessionId: string | undefined,
    input: DistributorTransferRequestInput,
  ) {
    const session = await this.requireRole(sessionId, CompanyRole.DISTRIBUTOR, 'INITIATE_TRANSFER');
    const recipient = getAddress(input.recipient);
    const retailerWallets = await this.safeGateway(() =>
      this.dependencies.gateway.listActiveRetailers(),
    );
    const identity = this.dependencies.stakeholderDirectory
      ? (await this.dependencies.stakeholderDirectory.resolveMany([recipient]))[0]
      : undefined;
    if (
      !retailerWallets.some((wallet) => sameAddress(wallet, recipient)) ||
      identity?.role !== CompanyRole.RETAILER ||
      !(await this.safeGateway(() => this.dependencies.gateway.isRoleAuthorized(recipient, 5))) ||
      !(await this.safeGateway(() =>
        this.dependencies.gateway.hasPermission(recipient, 'RECEIVE_TRANSFER'),
      ))
    ) {
      throw new ProductionFlowApiError(
        'INVALID_RETAILER',
        'The recipient is not an active Retailer authorized to receive transfers.',
        409,
      );
    }
    const product = await this.safeGateway(() =>
      this.dependencies.gateway.getProduct(input.productBatchId),
    );
    if (
      !product ||
      product.status !== 1 ||
      !(await this.safeGateway(() =>
        this.dependencies.gateway.isTransferable(input.productBatchId),
      ))
    ) {
      throw new ProductionFlowApiError(
        'PRODUCT_NOT_TRANSFERABLE',
        'The selected product is not transferable.',
        409,
      );
    }
    const expectedAt = Math.floor(input.expectedAt.getTime() / 1_000);
    if (expectedAt < this.nowSeconds()) {
      throw new ProductionFlowApiError(
        'INVALID_EXPECTED_AT',
        'Expected arrival cannot be in the past.',
        400,
      );
    }
    const transferId = id(`${input.operationId}:${session.address}`);
    const shipment = canonical({
      expectedAt,
      handlingNotes: input.handlingNotes,
      operationId: input.operationId,
      productBatchId: input.productBatchId,
      quantity: input.quantity,
      recipient,
      shipmentReference: input.shipmentReference,
    });
    const shipmentHash = sha256(shipment);
    let workflow = await this.dependencies.repository.findPrivate('transfers', transferId);
    const existing = await this.safeGateway(() =>
      this.dependencies.gateway.getTransfer(transferId),
    );
    if (existing) {
      if (
        !workflow ||
        existing.status !== 1 ||
        !sameAddress(existing.sender, session.address) ||
        !sameAddress(existing.recipient, recipient) ||
        existing.productBatchId.toLowerCase() !== input.productBatchId.toLowerCase() ||
        existing.quantity !== input.quantity ||
        existing.expectedAt !== expectedAt ||
        existing.shipmentHash.toLowerCase() !== shipmentHash.toLowerCase() ||
        existing.shipmentCid !== workflow.cid
      ) {
        throw this.recordMismatch('Distributor transfer record mismatch.');
      }
      return {
        actorWallet: session.address,
        state: 'COMPLETE' as const,
        status: existing.status,
        transferId,
      };
    }
    const inventory = await this.safeGateway(() =>
      this.dependencies.gateway.getInventory(input.productBatchId, session.address),
    );
    if (!inventory.initialized || BigInt(input.quantity) > BigInt(inventory.available)) {
      throw new ProductionFlowApiError(
        'INSUFFICIENT_INVENTORY',
        'The Distributor inventory is insufficient.',
        409,
      );
    }
    if (!workflow) {
      const stored = await this.store(shipment, transferId);
      workflow = {
        cid: stored.cid,
        contentHash: shipmentHash,
        id: transferId,
        owner: session.address,
        payload: stored.payload,
      };
      await this.dependencies.repository.savePrivate('transfers', workflow);
    } else if (
      workflow.contentHash !== shipmentHash ||
      !sameAddress(workflow.owner, session.address)
    ) {
      throw new ProductionFlowApiError(
        'TRANSFER_WORKFLOW_CONFLICT',
        'This transfer operation is already bound to different details.',
        409,
      );
    }
    return {
      actorWallet: session.address,
      state: 'TRANSACTION_REQUIRED' as const,
      transferId,
      transaction: this.dependencies.gateway.prepareTransfer({
        expectedAt,
        productBatchId: input.productBatchId,
        quantity: input.quantity,
        recipient,
        shipmentCid: workflow.cid,
        shipmentHash,
        transferId,
      }),
    };
  }

  private async productPresentation(productBatchId: string) {
    const workflow = await this.dependencies.repository.findPrivate('products', productBatchId);
    try {
      const chain = !workflow
        ? await this.safeGateway(() => this.dependencies.gateway.getProduct(productBatchId))
        : undefined;
      if (!workflow && !chain) return undefined;
      if (!workflow && !this.dependencies.contentStore.retrieveAndDecrypt) return undefined;
      const serialized = workflow
        ? await this.dependencies.contentStore.decrypt(workflow.payload)
        : await this.retrieveEncrypted(chain!.publicCid, 'PRODUCT_METADATA');
      const contentHash = workflow?.contentHash ?? chain!.metadataHash;
      if (sha256(serialized).toLowerCase() !== contentHash.toLowerCase())
        throw this.recordMismatch(
          'The encrypted product metadata does not match the blockchain hash.',
        );
      const parsed = JSON.parse(serialized) as Record<string, unknown>;
      if (
        typeof parsed.batchReference !== 'string' ||
        id(parsed.batchReference).toLowerCase() !== productBatchId.toLowerCase()
      )
        throw this.recordMismatch('The encrypted product metadata belongs to another batch.');
      return {
        batchReference:
          typeof parsed.batchReference === 'string' ? parsed.batchReference : undefined,
        productName: typeof parsed.productName === 'string' ? parsed.productName : undefined,
      };
    } catch (error) {
      if (error instanceof ProductionFlowApiError) throw error;
      throw new ProductionFlowApiError(
        'PRODUCT_METADATA_UNAVAILABLE',
        'The encrypted product metadata could not be downloaded or decrypted.',
        503,
      );
    }
  }

  private async ingredientPresentation(batchId: string) {
    const workflow = await this.dependencies.ingredientRepository.find(batchId);
    try {
      const chain = !workflow
        ? await this.safeGateway(() => this.dependencies.gateway.getIngredient(batchId))
        : undefined;
      if (!workflow && !chain) return undefined;
      if (!workflow && !this.dependencies.contentStore.retrieveAndDecrypt) return undefined;
      const serialized = workflow
        ? await this.dependencies.contentStore.decrypt(workflow.encryptedPayload)
        : await this.retrieveEncrypted(chain!.encryptedCid, 'INGREDIENT_METADATA');
      const parsed = JSON.parse(serialized) as { metadata?: Record<string, unknown> };
      const metadata = parsed.metadata ?? {};
      const contentHash = workflow?.metadataHash ?? chain!.metadataHash;
      if (sha256(JSON.stringify(metadata)).toLowerCase() !== contentHash.toLowerCase())
        throw this.recordMismatch(
          'The encrypted ingredient metadata does not match the blockchain hash.',
        );
      if (
        typeof metadata.batchId !== 'string' ||
        id(metadata.batchId).toLowerCase() !== batchId.toLowerCase()
      )
        throw this.recordMismatch('The encrypted ingredient metadata belongs to another batch.');
      return {
        batchReference:
          typeof parsed.metadata?.batchId === 'string' ? parsed.metadata.batchId : undefined,
        ingredientName:
          typeof parsed.metadata?.ingredientName === 'string'
            ? parsed.metadata.ingredientName
            : undefined,
      };
    } catch (error) {
      if (error instanceof ProductionFlowApiError) throw error;
      throw new ProductionFlowApiError(
        'INGREDIENT_METADATA_UNAVAILABLE',
        'The encrypted ingredient metadata could not be downloaded or decrypted.',
        503,
      );
    }
  }

  private async createEvidenceWorkflow(
    session: SessionRecord,
    input: EvidenceRequestInput,
    supplier: string,
    dueAt: number,
  ) {
    const requestId = id(`${input.operationId}:${session.address}`);
    const issuedAt = this.nowSeconds();
    const challenge = `${randomBytes(32).toString('base64url')}.${evidenceRequestBindingHash({
      batchId: input.batchId,
      dueAt,
      issuedAt,
      purpose: input.reason,
      requestId,
      requesterWallet: session.address,
      supplierWallet: supplier,
      verifierWallet: session.address,
    })}`;
    const challengeHash = id(challenge);
    const claims = [...new Set(input.claims)].sort();
    const requiredClaims = ingredientPolicyRequirements(
      input.policy ?? {},
      input.requiredClaims,
    ).sort();
    if (input.policy) for (const key of requiredClaims) if (!claims.includes(key)) claims.push(key);
    if (requiredClaims.some((claim) => !claims.includes(claim)))
      throw new ProductionFlowApiError(
        'INVALID_CLAIM_REQUIREMENTS',
        'Every required claim must also be included in the requested claims.',
        400,
      );
    const claimsHash = sha256(
      canonical({ claims, requiredClaims, ...(input.policy ? { policy: input.policy } : {}) }),
    );
    const stored = await this.store(
      canonical({
        batchId: input.batchId,
        challenge,
        claims,
        requiredClaims,
        ...(input.policy ? { policy: input.policy } : {}),
        dueAt,
        issuedAt,
        productBatchId: input.productBatchId,
        reason: input.reason,
        requestId,
        requester: session.address,
        requesterRole: session.onChainAuthorization?.role,
        supplier,
      }),
      requestId,
    );
    const record: EvidenceWorkflowRecord = {
      batchId: input.batchId,
      challengeHash,
      claimsHash,
      dueAt,
      operationId: input.operationId,
      requestCid: stored.cid,
      requestId,
      requestPayload: stored.payload,
      requester: session.address,
      supplier,
    };
    await this.dependencies.repository.saveEvidence(record);
    return record;
  }

  private async createEvidenceResponse(
    workflow: EvidenceWorkflowRecord,
    supplierWallet: string,
    holderPresentation?: string,
  ) {
    const ingredient = await this.ingredientRecord(workflow.batchId);
    if (!ingredient || !sameAddress(ingredient.supplierWallet, supplierWallet)) {
      throw new ProductionFlowApiError(
        'CREDENTIAL_NOT_AVAILABLE',
        'The issued Ingredient Credential is not available for this batch.',
        404,
      );
    }
    const agent = await this.dependencies.agentProvider();
    const envelope = JSON.parse(
      await this.dependencies.contentStore.decrypt(ingredient.encryptedPayload),
    ) as { credential?: unknown; sdJwt?: string };
    const request = JSON.parse(
      await this.requestContent(workflow),
    ) as EvidenceRequestPrivatePayload;
    if (!request.challenge || id(request.challenge) !== workflow.challengeHash)
      throw this.recordMismatch('Evidence challenge mismatch.');
    this.assertEvidenceRequestBinding(workflow, request);
    if (ingredient.credentialFormat === 'SD_JWT_VC') {
      if (!holderPresentation || !envelope.sdJwt || !ingredient.holderDid)
        throw new ProductionFlowApiError(
          'HOLDER_SIGNATURE_REQUIRED',
          'The Supplier must approve and sign the selective presentation in the browser.',
          409,
        );
      if (presentationSdJwt(holderPresentation).split('~')[0] !== envelope.sdJwt.split('~')[0])
        throw new ProductionFlowApiError(
          'PRESENTATION_INVALID',
          'The presentation is not derived from this issued Ingredient Credential.',
          409,
        );
      const verified = await this.verifySelectivePresentation(agent, holderPresentation, {
        audience: workflow.requester.toLowerCase(),
        batchId: ingredient.batchId,
        nonce: request.challenge,
        requiredClaims: request.requiredClaims ?? request.claims ?? [],
        policy: request.policy,
        requestedClaims: request.claims,
        ...(request.policy || parseWalletPresentation(holderPresentation!)
          ? {
              context: {
                requestId: workflow.requestId,
                purpose: request.reason!,
                expiresAt: workflow.dueAt,
              },
            }
          : {}),
        supplierWallet,
      });
      if (String(verified.payload.credentialId) === '')
        throw this.recordMismatch('The selective presentation credential identifier is missing.');
      const walletProof = parseWalletPresentation(holderPresentation);
      const presentationExpiresAt = Math.min(
        ingredient.expiresAt,
        ...(walletProof ? [walletProof.proof.context.expiresAt, workflow.dueAt] : []),
        ...(request.policy
          ? [
              Number(
                walletProof?.proof.context.expiresAt ??
                  JSON.parse(
                    Buffer.from(
                      holderPresentation.split('~').at(-1)!.split('.')[1]!,
                      'base64url',
                    ).toString(),
                  ).exp,
              ),
              workflow.dueAt,
            ]
          : []),
        this.nowSeconds() + 48 * 60 * 60,
      );
      const presentationHash = sha256(holderPresentation);
      const stored = await this.store(holderPresentation, `${workflow.requestId}-presentation`);
      return {
        credentialId: ingredient.credentialId,
        presentationCid: stored.cid,
        presentationExpiresAt,
        presentationHash,
        presentationPayload: stored.payload,
      };
    }
    const credential = ingredientCredentialSchema.parse(
      envelope.credential,
    ) as IngredientCredential;
    this.assertLegacyRequiredClaims(credential, request.requiredClaims ?? request.claims ?? []);
    this.assertLegacyPolicy(credential, request);
    const credentialVerification = await verifyIngredientCredential(
      agent,
      credential,
      supplierWallet,
      ingredient.issuerDid,
      this.clock(),
    );
    if (
      !credentialVerification.verified ||
      `0x${credentialVerification.credentialHash}`.toLowerCase() !==
        ingredient.credentialHash.toLowerCase()
    ) {
      throw new ProductionFlowApiError(
        'INGREDIENT_CREDENTIAL_INVALID',
        'The stored Ingredient Credential failed verification.',
        409,
      );
    }
    if (this.dependencies.gateway.presentationDomain) {
      if (!holderPresentation)
        throw new ProductionFlowApiError(
          'HOLDER_SIGNATURE_REQUIRED',
          'Approve the complete legacy credential with MetaMask before sharing.',
          409,
        );
      const wallet = parseWalletPresentation(holderPresentation);
      if (!wallet || wallet.presentation !== canonical(credential))
        throw this.recordMismatch(
          'The full credential holder proof differs from the issued credential.',
        );
      verifyWalletPresentation(wallet, {
        ...this.dependencies.gateway.presentationDomain(),
        requestId: workflow.requestId,
        verifier: workflow.requester,
        holder: supplierWallet,
        batchId: workflow.batchId,
        purpose: request.reason!,
        challenge: request.challenge,
        now: this.nowSeconds(),
        expiresAt: Math.min(workflow.dueAt, ingredient.expiresAt),
      });
      const stored = await this.store(holderPresentation, `${workflow.requestId}-presentation`);
      return {
        credentialId: ingredient.credentialId,
        presentationCid: stored.cid,
        presentationHash: sha256(holderPresentation),
        presentationExpiresAt: wallet.proof.context.expiresAt,
        presentationPayload: stored.payload,
      };
    }
    const presentationExpiresAt = Math.min(ingredient.expiresAt, this.nowSeconds() + 48 * 60 * 60);
    const presentation = await createIngredientEvidencePresentation(agent, {
      batchId: workflow.batchId,
      challenge: request.challenge,
      credential,
      domain: this.dependencies.presentationDomain ?? 'tracechain.local',
      expirationDate: new Date(presentationExpiresAt * 1_000),
      holderDid: ingredient.issuerDid,
      purpose: request.reason ?? 'Ingredient evidence verification',
      requestId: workflow.requestId,
      supplierWallet,
      verifier: workflow.requester,
    });
    const checked = await verifyIngredientEvidencePresentation(agent, presentation, {
      batchId: workflow.batchId,
      challenge: request.challenge,
      domain: this.dependencies.presentationDomain ?? 'tracechain.local',
      expectedIssuerDid: ingredient.issuerDid,
      now: this.clock(),
      purpose: request.reason ?? 'Ingredient evidence verification',
      requestId: workflow.requestId,
      supplierWallet,
      verifier: workflow.requester,
    });
    if (!checked.verified)
      throw new ProductionFlowApiError(
        'PRESENTATION_INVALID',
        'The generated presentation failed verification.',
        500,
      );
    const serialized = canonical(presentation);
    const presentationHash = sha256(serialized);
    const stored = await this.store(serialized, `${workflow.requestId}-presentation`);
    return {
      credentialId: ingredient.credentialId,
      presentationCid: stored.cid,
      presentationExpiresAt,
      presentationHash,
      presentationPayload: stored.payload,
    };
  }

  private assertLegacyRequiredClaims(credential: IngredientCredential, required: string[]) {
    if (missingLegacyIngredientClaims(credential.credentialSubject, required).length) {
      throw new ProductionFlowApiError(
        'REQUIRED_CLAIMS_UNAVAILABLE',
        'This older credential does not contain all required claims. Request available legacy fields or issue a new credential with the required structured information.',
        409,
      );
    }
  }
  private assertLegacyPolicy(
    credential: IngredientCredential,
    request: EvidenceRequestPrivatePayload,
  ) {
    if (!request.policy) return;
    const subject = credential.credentialSubject;
    const payload = {
      ...subject,
      countryOfOrigin: subject.origin,
      ...ingredientDetailClaims(
        subject.originDetails,
        subject.allergen,
        subject.certificationEntries,
        subject.qualityTests,
      ),
      batchReference: subject.batchId,
      allergenDeclaration: subject.allergen ?? subject.allergenInformation,
    };
    const errors = ingredientDisclosureErrors(
      payload,
      request.policy,
      request.requiredClaims ?? [],
      subject.batchId,
    );
    if (errors.length)
      throw new ProductionFlowApiError('EVIDENCE_POLICY_NOT_SATISFIED', errors[0], 409);
  }

  private async verifyPersistedPresentation(
    workflow: EvidenceWorkflowRecord,
    chain: Awaited<ReturnType<ProductionFlowGateway['getEvidenceRequest']>> & {},
  ) {
    if (!workflow.response)
      throw this.recordMismatch('The encrypted presentation is not available.');
    if (
      workflow.response.presentationCid !== chain!.presentationCid ||
      workflow.response.presentationHash.toLowerCase() !== chain!.presentationHash.toLowerCase()
    )
      throw this.recordMismatch('Presentation reference mismatch.');
    const request = JSON.parse(
      await this.requestContent(workflow),
    ) as EvidenceRequestPrivatePayload;
    const serializedPresentation = await this.responseContent(workflow);
    if (!request.challenge || id(request.challenge) !== chain!.challengeHash)
      throw this.recordMismatch('Presentation challenge mismatch.');
    this.assertEvidenceRequestBinding(workflow, request);
    const ingredient = await this.ingredientRecord(workflow.batchId);
    if (!ingredient) throw this.recordMismatch('Ingredient workflow is missing.');
    const agent: TraceChainAgent = await this.dependencies.agentProvider();
    if (ingredient.credentialFormat === 'SD_JWT_VC') {
      const requestDetails = JSON.parse(await this.requestContent(workflow)) as {
        claims?: string[];
        requiredClaims?: string[];
      };
      const source = JSON.parse(
        await this.dependencies.contentStore.decrypt(ingredient.encryptedPayload),
      );
      if (
        !source.sdJwt ||
        presentationSdJwt(serializedPresentation).split('~')[0] !== source.sdJwt.split('~')[0] ||
        sha256(source.sdJwt).toLowerCase() !== ingredient.credentialHash.toLowerCase()
      )
        throw new ProductionFlowApiError(
          'PRESENTATION_INVALID',
          'The presentation does not match the registered source credential.',
          409,
        );
      const verified = await this.verifySelectivePresentation(agent, serializedPresentation, {
        audience: workflow.requester.toLowerCase(),
        batchId: ingredient.batchId,
        nonce: request.challenge,
        requiredClaims: requestDetails.requiredClaims ?? requestDetails.claims ?? [],
        policy: request.policy,
        requestedClaims: request.claims,
        ...(request.policy || parseWalletPresentation(serializedPresentation)
          ? {
              context: {
                requestId: workflow.requestId,
                purpose: request.reason!,
                expiresAt: workflow.dueAt,
              },
            }
          : {}),
        supplierWallet: workflow.supplier,
      });
      if (
        id(String(verified.payload.credentialId)).toLowerCase() !==
        ingredient.credentialId.toLowerCase()
      )
        throw this.recordMismatch(
          'The selective presentation credential does not match the batch.',
        );
      const credentialEnvelope = JSON.parse(
        await this.dependencies.contentStore.decrypt(ingredient.encryptedPayload),
      ) as { sdJwt?: string };
      if (!credentialEnvelope.sdJwt) throw this.recordMismatch('The SD-JWT credential is missing.');
      const credentialHash = `0x${createHash('sha256').update(credentialEnvelope.sdJwt).digest('hex')}`;
      const onChain = await this.safeGateway(() =>
        this.dependencies.gateway.getCredential(ingredient.credentialId),
      );
      if (
        !onChain ||
        onChain.status !== 1 ||
        onChain.expiresAt <= this.nowSeconds() ||
        onChain.credentialType !== 2 ||
        onChain.credentialHash.toLowerCase() !== credentialHash.toLowerCase() ||
        !sameAddress(onChain.subject, workflow.supplier) ||
        !sameAddress(onChain.issuer, workflow.supplier)
      )
        throw new ProductionFlowApiError(
          'INGREDIENT_CREDENTIAL_INACTIVE',
          'The Ingredient Credential is not active on chain.',
          409,
        );
      return ingredient.credentialId;
    }
    const wallet = parseWalletPresentation(serializedPresentation);
    if (wallet)
      verifyWalletPresentation(wallet, {
        ...this.dependencies.gateway.presentationDomain!(),
        requestId: workflow.requestId,
        verifier: workflow.requester,
        holder: workflow.supplier,
        batchId: workflow.batchId,
        purpose: request.reason!,
        challenge: request.challenge,
        now: this.nowSeconds(),
        expiresAt: Math.min(workflow.dueAt, ingredient.expiresAt),
      });
    const presentation = JSON.parse(serializedPresentation) as unknown;
    const verified = wallet
      ? {
          ...(await verifyIngredientCredential(
            agent,
            JSON.parse(wallet.presentation),
            workflow.supplier,
            ingredient.issuerDid,
            this.clock(),
          )),
          credential: ingredientCredentialSchema.parse(JSON.parse(wallet.presentation)),
        }
      : await verifyIngredientEvidencePresentation(agent, presentation, {
          batchId: workflow.batchId,
          challenge: request.challenge,
          domain: this.dependencies.presentationDomain ?? 'tracechain.local',
          expectedIssuerDid: ingredient.issuerDid,
          now: this.clock(),
          purpose: request.reason ?? 'Ingredient evidence verification',
          requestId: workflow.requestId,
          supplierWallet: workflow.supplier,
          verifier: workflow.requester,
        });
    if (!verified.verified || !verified.credential)
      throw new ProductionFlowApiError(
        'PRESENTATION_INVALID',
        'The Supplier presentation failed cryptographic verification.',
        409,
      );
    const credential = verified.credential;
    this.assertLegacyRequiredClaims(credential, request.requiredClaims ?? request.claims ?? []);
    this.assertLegacyPolicy(credential, request);
    if (
      id(credential.credentialSubject.batchId).toLowerCase() !== workflow.batchId.toLowerCase() ||
      id(credential.id).toLowerCase() !== ingredient.credentialId.toLowerCase() ||
      `0x${verified.credentialHash}`.toLowerCase() !== ingredient.credentialHash.toLowerCase()
    )
      throw this.recordMismatch('The credential does not match the requested ingredient batch.');
    const onChain = await this.safeGateway(() =>
      this.dependencies.gateway.getCredential(ingredient.credentialId),
    );
    if (
      !onChain ||
      onChain.status !== 1 ||
      onChain.expiresAt <= this.nowSeconds() ||
      onChain.credentialType !== 2 ||
      onChain.credentialHash.toLowerCase() !== ingredient.credentialHash.toLowerCase() ||
      !sameAddress(onChain.subject, workflow.supplier) ||
      !sameAddress(onChain.issuer, workflow.supplier)
    ) {
      throw new ProductionFlowApiError(
        'INGREDIENT_CREDENTIAL_INACTIVE',
        'The Ingredient Credential is not active on chain.',
        409,
      );
    }
    return ingredient.credentialId;
  }

  private async requireRole(
    sessionId: string | undefined,
    role:
      | CompanyRole.SUPPLIER
      | CompanyRole.MANUFACTURER
      | CompanyRole.DISTRIBUTOR
      | CompanyRole.RETAILER,
    permission: string,
  ) {
    const session = await this.dependencies.authService.requireSession(sessionId);
    const authorization = session.onChainAuthorization;
    if (
      authorization?.status !== 'AUTHORIZED' ||
      authorization.role !== role ||
      !authorization.credentialHash
    ) {
      throw new ProductionFlowApiError(
        'ROLE_AUTHORIZATION_REQUIRED',
        `Current on-chain ${roleLabel(role)} authorization is required.`,
        403,
      );
    }
    const companyRoleCredentialHash = authorization.credentialHash;
    await this.safeGateway(() => this.dependencies.gateway.assertDeployment());
    const allowed = await this.safeGateway(() =>
      this.dependencies.gateway.getAccess(
        session.address,
        companyRoleCredentialHash,
        ROLE_NUMBERS[role],
        permission,
      ),
    );
    if (!allowed)
      throw new ProductionFlowApiError(
        'ROLE_AUTHORIZATION_REQUIRED',
        'The authenticated wallet is not currently authorized on chain.',
        403,
      );
    return session;
  }

  private async requireIdentitySession(
    sessionId: string | undefined,
    requestId: string,
    presenter: boolean,
  ) {
    const session = await this.dependencies.authService.requireSession(sessionId);
    const workflow = await this.requireWorkflow(requestId, session.address);
    if (!workflow.deliveryOrderId)
      return presenter
        ? this.requireEvidenceRequester(sessionId)
        : this.requireEitherRole(sessionId);
    if (sameAddress(session.address, workflow.requester))
      return workflow.identityProof?.presenterRole === CompanyRole.MANUFACTURER
        ? this.requireRole(sessionId, CompanyRole.MANUFACTURER, 'INITIATE_TRANSFER')
        : this.requireRole(sessionId, CompanyRole.SUPPLIER, 'ISSUE_INGREDIENT_CREDENTIAL');
    if (!presenter && sameAddress(session.address, workflow.supplier))
      return this.requireRole(sessionId, CompanyRole.DISTRIBUTOR, 'RECEIVE_TRANSFER');
    throw new ProductionFlowApiError(
      'IDENTITY_PROOF_ACCESS_DENIED',
      'This delivery proof belongs to other participants.',
      404,
    );
  }
  private async requireEitherRole(sessionId?: string) {
    const session = await this.dependencies.authService.requireSession(sessionId);
    const role = session.onChainAuthorization?.role;
    if (role === CompanyRole.SUPPLIER)
      return this.requireRole(sessionId, role, 'ISSUE_INGREDIENT_CREDENTIAL');
    if (role === CompanyRole.MANUFACTURER)
      return this.requireRole(sessionId, role, 'REQUEST_EVIDENCE');
    if (role === CompanyRole.RETAILER) return this.requireRole(sessionId, role, 'REQUEST_EVIDENCE');
    throw new ProductionFlowApiError(
      'ROLE_AUTHORIZATION_REQUIRED',
      'A Supplier, Manufacturer, or Retailer role is required.',
      403,
    );
  }

  private async requireEvidenceRequester(sessionId?: string) {
    const session = await this.dependencies.authService.requireSession(sessionId);
    const role = session.onChainAuthorization?.role;
    if (role === CompanyRole.MANUFACTURER || role === CompanyRole.RETAILER)
      return this.requireRole(sessionId, role, 'REQUEST_EVIDENCE');
    throw new ProductionFlowApiError(
      'ROLE_AUTHORIZATION_REQUIRED',
      'A Manufacturer or Retailer role is required.',
      403,
    );
  }

  private async requireActiveIngredient(batchId: string) {
    const batch = await this.safeGateway(() => this.dependencies.gateway.getIngredient(batchId));
    if (!batch || batch.status !== 1 || batch.expiresAt <= this.nowSeconds())
      throw new ProductionFlowApiError(
        'INGREDIENT_UNAVAILABLE',
        'The ingredient batch is not active.',
        409,
      );
    return batch;
  }
  private async requireWorkflow(requestId: string, viewer?: string) {
    const reference = await this.sharedCompanyReferences()?.get(requestId);
    if (reference) {
      if (
        viewer &&
        !sameAddress(viewer, reference.presenter) &&
        !sameAddress(viewer, reference.verifier)
      )
        throw new ProductionFlowApiError(
          'REQUEST_NOT_FOUND',
          'This company request belongs to other participants.',
          404,
        );
      const serialized = await this.retrieveEncrypted(
        reference.requestCid,
        'COMPANY_IDENTITY_REQUEST',
      );
      if (sha256(serialized).toLowerCase() !== reference.requestHash.toLowerCase())
        throw this.recordMismatch('Company request hash mismatch.');
      const value = JSON.parse(serialized);
      const refs = this.sharedCompanyReferences()!;
      if (
        value.version !== 1 ||
        value.chainId !== refs.domain.chainId ||
        !sameAddress(value.registry, refs.domain.verifyingContract) ||
        value.requestId !== requestId ||
        !sameAddress(value.requester, reference.presenter) ||
        !sameAddress(value.supplier, reference.verifier) ||
        id(value.identityProof?.challenge ?? '') !== reference.challengeHash ||
        value.identityProof?.expiresAt !== reference.expiresAt ||
        !sameAddress(value.identityProof?.presenterWallet ?? '', reference.presenter) ||
        !sameAddress(value.identityProof?.audience ?? '', reference.verifier)
      )
        throw this.recordMismatch(
          'The shared company request context differs from its chain reference.',
        );
      const evidence = !value.orderContext
        ? await this.dependencies.gateway.getEvidenceRequest(requestId)
        : undefined;
      return {
        ...value,
        ...(evidence?.presentationCid
          ? {
              response: {
                credentialId: ZeroHash,
                presentationCid: evidence.presentationCid,
                presentationHash: evidence.presentationHash,
                presentationExpiresAt: evidence.presentationExpiresAt,
              },
            }
          : {}),
        sharedIdentity: true,
        operationId: `shared:${requestId}`,
        identityProof: {
          ...value.identityProof,
          presentationCid: reference.responseCid || undefined,
          status:
            reference.status === 5
              ? ('REJECTED' as const)
              : reference.status === 4
                ? ('DECLINED' as const)
                : reference.status === 3
                  ? ('VERIFIED' as const)
                  : reference.status === 2
                    ? ('PRESENTED' as const)
                    : ('REQUESTED' as const),
        },
      } as EvidenceWorkflowRecord;
    }
    let record = await this.dependencies.repository.findEvidence(requestId).catch((error) => {
      if (!this.dependencies.contentStore.retrieveAndDecrypt) throw error;
      return undefined; // An unavailable compatibility cache cannot hide confirmed records.
    });
    if (!record) {
      const chain = await this.safeGateway(() =>
        this.dependencies.gateway.getEvidenceRequest(requestId),
      );
      if (!chain)
        throw new ProductionFlowApiError(
          'REQUEST_NOT_FOUND',
          'The evidence request was not found.',
          404,
        );
      if (viewer && !sameAddress(viewer, chain.requester) && !sameAddress(viewer, chain.supplier))
        throw new ProductionFlowApiError(
          'REQUEST_NOT_FOUND',
          'This evidence request belongs to other participants.',
          404,
        );
      const serialized = await this.retrieveEncrypted(chain.requestCid, 'EVIDENCE_REQUEST');
      let request: EvidenceRequestPrivatePayload & {
        challenge?: string;
        claims?: string[];
        requiredClaims?: string[];
        requestId?: string;
        requester?: string;
        supplier?: string;
      };
      try {
        request = JSON.parse(serialized);
      } catch {
        throw this.recordMismatch('The encrypted evidence request is malformed.');
      }
      const claims = [...new Set(request.claims ?? [])].sort();
      const requiredClaims = [...new Set(request.requiredClaims ?? request.claims ?? [])].sort();
      const claimsHash = sha256(
        canonical({
          claims,
          requiredClaims,
          ...(request.policy ? { policy: request.policy } : {}),
        }),
      );
      if (
        request.requestId?.toLowerCase() !== requestId.toLowerCase() ||
        !request.challenge ||
        id(request.challenge).toLowerCase() !== chain.challengeHash.toLowerCase() ||
        claimsHash.toLowerCase() !== chain.claimsHash.toLowerCase() ||
        !sameAddress(String(request.requester ?? ''), chain.requester) ||
        !sameAddress(String(request.supplier ?? ''), chain.supplier) ||
        request.batchId?.toLowerCase() !== chain.ingredientBatchId.toLowerCase() ||
        Number(request.dueAt) !== chain.dueAt
      )
        throw this.recordMismatch(
          'The encrypted evidence request does not match the blockchain record.',
        );
      const ingredient = await this.safeGateway(() =>
        this.dependencies.gateway.getIngredient(chain.ingredientBatchId),
      );
      record = {
        batchId: chain.ingredientBatchId,
        challengeHash: chain.challengeHash,
        claimsHash: chain.claimsHash,
        dueAt: chain.dueAt,
        operationId: `recovered:${requestId.toLowerCase()}`,
        requestCid: chain.requestCid,
        requestId,
        requester: chain.requester,
        supplier: chain.supplier,
        ...(chain.presentationCid
          ? {
              response: {
                credentialId: ingredient?.credentialId ?? ZeroHash,
                presentationCid: chain.presentationCid,
                presentationExpiresAt: chain.presentationExpiresAt,
                presentationHash: chain.presentationHash,
              },
            }
          : {}),
      };
      if (!this.dependencies.walletCompanyExchange)
        await this.dependencies.repository.saveEvidence(record);
    }
    if (!record.orderContext) {
      const chain = await this.dependencies.gateway.getEvidenceRequest(requestId);
      if (chain) {
        this.assertRequestMatches(chain, record);
        if (chain.presentationCid && chain.status >= 2)
          record = {
            ...record,
            response: {
              ...(record.response?.presentationHash === chain.presentationHash
                ? record.response
                : {}),
              credentialId:
                record.response?.credentialId ??
                (await this.dependencies.gateway.getIngredient(record.batchId))?.credentialId ??
                ZeroHash,
              presentationCid: chain.presentationCid,
              presentationHash: chain.presentationHash,
              presentationExpiresAt: chain.presentationExpiresAt,
              ...(record.response?.presentationHash === chain.presentationHash
                ? { verification: record.response.verification }
                : {}),
            },
          };
      }
    }
    if (record.deliveryOrderId && !(await this.dependencies.validateDeliveryIdentity?.(record)))
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_ACCESS_DENIED',
        'The delivery identity binding is no longer current.',
        404,
      );
    return record;
  }

  private async retrieveEncrypted(cid: string, label: string) {
    if (!cid || !this.dependencies.contentStore.retrieveAndDecrypt)
      throw new ProductionFlowApiError(
        'LEGACY_RECORD_NOT_MIGRATED',
        `${label} is not available from this API instance because its encrypted IPFS reference has not been migrated.`,
        409,
      );
    try {
      return await this.dependencies.contentStore.retrieveAndDecrypt(cid);
    } catch (error) {
      throw new ProductionFlowApiError(
        'ENCRYPTED_RECORD_UNAVAILABLE',
        `${label} could not be downloaded or decrypted.`,
        503,
      );
    }
  }

  private async requestContent(workflow: EvidenceWorkflowRecord) {
    const serialized = await (workflow.requestPayload
      ? this.dependencies.contentStore.decrypt(workflow.requestPayload)
      : this.retrieveEncrypted(workflow.requestCid, 'EVIDENCE_REQUEST'));
    if (!workflow.orderContext) {
      const request = JSON.parse(serialized) as EvidenceRequestPrivatePayload;
      if (request.policy) {
        if (
          !request.challenge ||
          id(request.challenge).toLowerCase() !== workflow.challengeHash.toLowerCase()
        )
          throw this.recordMismatch('Evidence request challenge mismatch.');
        this.assertEvidenceRequestBinding(workflow, request);
      }
    }
    return serialized;
  }

  private async responseContent(workflow: EvidenceWorkflowRecord) {
    if (!workflow.response)
      throw new ProductionFlowApiError(
        'EVIDENCE_NOT_RECEIVED',
        'No evidence response exists.',
        409,
      );
    const serialized = await (workflow.response.presentationPayload
      ? this.dependencies.contentStore.decrypt(workflow.response.presentationPayload)
      : this.retrieveEncrypted(workflow.response.presentationCid, 'EVIDENCE_RESPONSE'));
    if (sha256(serialized).toLowerCase() !== workflow.response.presentationHash.toLowerCase())
      throw this.recordMismatch('Presentation integrity hash mismatch.');
    return serialized;
  }
  private async requireChainRequest(requestId: string) {
    const chain = await this.safeGateway(() =>
      this.dependencies.gateway.getEvidenceRequest(requestId),
    );
    if (!chain)
      throw new ProductionFlowApiError(
        'REQUEST_NOT_FOUND',
        'The on-chain evidence request was not found.',
        404,
      );
    return chain;
  }
  private assertRequestMatches(
    chain: NonNullable<Awaited<ReturnType<ProductionFlowGateway['getEvidenceRequest']>>>,
    workflow: EvidenceWorkflowRecord,
  ) {
    if (
      !sameAddress(chain.requester, workflow.requester) ||
      !sameAddress(chain.supplier, workflow.supplier) ||
      chain.ingredientBatchId.toLowerCase() !== workflow.batchId.toLowerCase() ||
      chain.challengeHash.toLowerCase() !== workflow.challengeHash.toLowerCase() ||
      chain.claimsHash.toLowerCase() !== workflow.claimsHash.toLowerCase() ||
      chain.requestCid !== workflow.requestCid ||
      chain.dueAt !== workflow.dueAt
    )
      throw this.recordMismatch('Evidence request record mismatch.');
  }
  private assertEvidenceRequestBinding(
    workflow: EvidenceWorkflowRecord,
    request: EvidenceRequestPrivatePayload,
  ) {
    if (
      request.policy &&
      sha256(
        canonical({
          claims: request.claims,
          requiredClaims: request.requiredClaims,
          policy: request.policy,
        }),
      ).toLowerCase() !== workflow.claimsHash.toLowerCase()
    )
      throw this.recordMismatch('The request disclosure policy does not match its on-chain hash.');
    const challengeParts = request.challenge?.split('.') ?? [];
    const expectedBinding = evidenceRequestBindingHash({
      batchId: workflow.batchId,
      dueAt: workflow.dueAt,
      issuedAt: request.issuedAt ?? 0,
      purpose: request.reason ?? '',
      requestId: workflow.requestId,
      requesterWallet: workflow.requester,
      supplierWallet: workflow.supplier,
      verifierWallet: workflow.requester,
    });
    if (
      challengeParts.length !== 2 ||
      !challengeParts[0] ||
      challengeParts[1] !== expectedBinding ||
      request.batchId?.toLowerCase() !== workflow.batchId.toLowerCase() ||
      request.requestId?.toLowerCase() !== workflow.requestId.toLowerCase() ||
      !sameAddress(String(request.requester ?? ''), workflow.requester) ||
      !sameAddress(String(request.supplier ?? ''), workflow.supplier) ||
      request.dueAt !== workflow.dueAt
    )
      throw this.recordMismatch('Evidence request context binding mismatch.');
  }
  private recordMismatch(message: string) {
    return new ProductionFlowApiError('ON_CHAIN_RECORD_MISMATCH', message, 409);
  }
  private nowSeconds() {
    return Math.floor(this.clock().getTime() / 1_000);
  }
  private async store(content: string, key: string) {
    try {
      return await this.dependencies.contentStore.encryptAndStore(content, key);
    } catch (error) {
      throw new ProductionFlowApiError(
        'ENCRYPTED_STORAGE_UNAVAILABLE',
        'Encrypted off-chain storage is unavailable. No transaction was prepared.',
        503,
      );
    }
  }
  private sharedCompanyReferences(): CompanyProofReferences | undefined {
    const source = this.dependencies.companyReferences?.();
    if (!source) return undefined;
    return {
      domain: source.domain,
      get: (key) => this.safeGateway(() => source.get(key)),
      list: (wallet) => this.safeGateway(() => source.list(wallet)),
      binding: (wallet) => this.safeGateway(() => source.binding(wallet)),
      prepare: (method, args) => source.prepare(method, args),
    };
  }
  private async safeGateway<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ProductionFlowApiError) throw error;
      throw new ProductionFlowApiError(
        'BLOCKCHAIN_UNAVAILABLE',
        'The blockchain service is unavailable.',
        503,
      );
    }
  }

  private async verifySelectivePresentation(
    agent: TraceChainAgent,
    presentation: string,
    input: {
      audience: string;
      batchId: string;
      nonce: string;
      requiredClaims: string[];
      supplierWallet: string;
      policy?: IngredientRequestPolicy;
      requestedClaims?: string[];
      context?: { requestId: string; purpose: string; expiresAt: number };
    },
  ) {
    try {
      // The holder decides what to disclose: only binding and structure are enforced here.
      // Required fields left out make the response incomplete (reported), not invalid.
      const result = await verifyIngredientSdJwtPresentation(agent, presentation, {
        walletDomain: this.dependencies.gateway.presentationDomain?.(),
        ...input,
        requiredClaims: [],
        now: this.nowSeconds(),
      });
      if (input.policy) {
        const selectable = [
          'countryOfOrigin',
          'originCountryCode',
          'originRegion',
          'originCity',
          'exactSourceFacility',
          'privateOriginAddress',
          'processingCountry',
          'processingLocation',
          'productionDate',
          'expiryDate',
          'allergenDeclaration',
          'certificationDetails',
          'qualityTestSummary',
          'internalQualityRemarks',
        ];
        for (const key of Object.keys(result.payload)) {
          const requested = input.requestedClaims ?? [];
          if (selectable.includes(key) && !requested.includes(key))
            throw new Error('An unrequested selective claim was disclosed.');
          if (key === 'productionDateMeaning' && !requested.includes('productionDate'))
            throw new Error('An unrequested date context was disclosed.');
          if (
            key.startsWith('certificationDocuments_') &&
            !requested.includes('certificationDocuments')
          )
            throw new Error('Unrequested certification documents were disclosed.');
          if (key.startsWith('qualityDocuments_') && !requested.includes('qualityDocuments'))
            throw new Error('Unrequested laboratory documents were disclosed.');
        }
      }
      return result;
    } catch (error) {
      if (error instanceof ProductionFlowApiError) throw error;
      const message = error instanceof Error ? error.message : '';
      const code = /expir|time|iat|max.?age/i.test(message)
        ? 'PRESENTATION_EXPIRED'
        : /required|claim/i.test(message)
          ? 'REQUIRED_CLAIM_MISSING'
          : /audience|nonce|key.?binding|signature|verify/i.test(message)
            ? 'PRESENTATION_PROOF_INVALID'
            : 'PRESENTATION_INVALID';
      console.warn('Selective presentation verification rejected', {
        code,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new ProductionFlowApiError(
        code,
        code === 'PRESENTATION_EXPIRED'
          ? 'The selective presentation has expired. Create and approve a new response.'
          : code === 'REQUIRED_CLAIM_MISSING'
            ? 'The presentation does not disclose every claim required by the requesting company.'
            : code === 'PRESENTATION_PROOF_INVALID'
              ? 'The holder signature, request challenge, or intended recipient did not verify.'
              : 'The selective presentation could not be verified. Restore the key bound to this credential and retry.',
        409,
      );
    }
  }

  private async requesterRole(workflow: EvidenceWorkflowRecord) {
    const payload = JSON.parse(await this.requestContent(workflow)) as {
      requesterRole?: CompanyRole;
    };
    if (
      payload.requesterRole !== CompanyRole.MANUFACTURER &&
      payload.requesterRole !== CompanyRole.RETAILER
    )
      throw new ProductionFlowApiError(
        'IDENTITY_PRESENTER_ROLE_INVALID',
        'The evidence request does not contain a valid requesting company role.',
        409,
      );
    return payload.requesterRole;
  }

  /** Seconds of a recorded successful verification, while the request deadline has not passed. */
  private recordedVerificationTime(workflow: EvidenceWorkflowRecord) {
    const proof = workflow.identityProof;
    const at = Date.parse(proof?.verifiedAt ?? '');
    return proof?.status === 'VERIFIED' &&
      Number.isFinite(at) &&
      proof.expiresAt > this.nowSeconds()
      ? Math.floor(at / 1000)
      : undefined;
  }

  private identityProofSummary(workflow: EvidenceWorkflowRecord) {
    const proof = workflow.identityProof;
    return {
      expiresAt: proof?.expiresAt,
      presenterRole: proof?.presenterRole,
      presenterWallet: proof?.presenterWallet,
      purpose: proof?.purpose,
      requiredClaims: proof?.requiredClaims,
      optionalClaims: proof?.optionalClaims,
      requestId: workflow.requestId,
      status:
        proof &&
        proof.status !== 'DECLINED' &&
        (workflow.deliveryOrderId || proof.status !== 'VERIFIED') &&
        proof.expiresAt <= this.nowSeconds()
          ? 'EXPIRED'
          : (proof?.status ?? 'NOT_REQUESTED'),
      verifiedAt: proof?.verifiedAt,
    };
  }

  private identityCredentialSummary(
    credential: {
      credentialSubject: {
        companyId: string;
        companyName: string;
        companyRegistrationNumber: string;
        id: string;
        role: CompanyRole;
        walletAddress: string;
      };
      credentialStatus: { status: string };
      expirationDate: string;
      id: string;
      issuanceDate: string;
      issuer: string | { id: string; name: string };
    },
    credentialHash: string,
  ) {
    return {
      credentialHash,
      credentialId: credential.id,
      credentialStatus: credential.credentialStatus.status,
      expirationDate: credential.expirationDate,
      issuanceDate: credential.issuanceDate,
      issuer: typeof credential.issuer === 'string' ? credential.issuer : credential.issuer.id,
      issuerName: typeof credential.issuer === 'string' ? undefined : credential.issuer.name,
      subject: credential.credentialSubject,
    };
  }

  /**
   * `verifiedAt` (seconds): re-check an already-verified proof as of when it was verified, so a
   * presentation whose short lifetime has since passed stays readable. Signatures, bindings and
   * the source credential are still fully checked; only the clock is the recorded one.
   */
  private async verifyCompanyIdentityPresentation(
    workflow: EvidenceWorkflowRecord,
    presentation: string,
    verifiedAt?: number,
  ) {
    const now = verifiedAt ?? this.nowSeconds();
    if (workflow.sharedIdentity) {
      const reference = await this.sharedCompanyReferences()!.get(workflow.requestId);
      if (
        reference?.responseCid &&
        sha256(presentation).toLowerCase() !== reference.responseHash.toLowerCase()
      )
        throw this.recordMismatch(
          'The company presentation differs from its registered integrity hash.',
        );
    }
    const proof = workflow.identityProof;
    if (!proof || proof.expiresAt <= now)
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_EXPIRED',
        'The company identity-proof request has expired.',
        409,
      );
    const walletPresentation = parseWalletPresentation(presentation);
    let jwt;
    let selectedClaims: Record<string, unknown> | undefined;
    try {
      if (presentation.includes('~')) {
        if (!proof.selectiveDisclosure)
          throw new Error('This request expects a full Company Role VP.');
        const result = await verifyCompanyIdentitySdJwt(
          await this.dependencies.agentProvider(),
          presentation,
          {
            walletDomain: this.sharedCompanyReferences()?.domain,
            wallet: proof.presenterWallet,
            batchId: workflow.batchId || ZeroHash,
            expiresAt: proof.expiresAt,
            audience: proof.audience,
            challenge: proof.challenge,
            requestId: workflow.requestId,
            purpose: proof.purpose,
            now: now,
            // Only the identity-binding claims are mandatory; other required fields are the holder's choice.
            requiredClaims: [],
          },
        );
        const p = result.payload;
        const source = await this.companySource(
          proof.presenterWallet,
          String(p.sourceCredentialHash),
        );
        const sourceIssuer = typeof source.issuer === 'string' ? source.issuer : source.issuer.id;
        if (p.iss !== sourceIssuer)
          throw new Error('The derived proof was not issued by the original authority.');
        if (
          p.policyVersion === 2 &&
          (p.sourceCredentialId !== source.id ||
            p.sourceCredentialIssuedAt !== source.issuanceDate ||
            p.sourceCredentialExpiresAt !== source.expirationDate)
        )
          throw new Error(
            'The derived proof source credential reference or validity metadata differs from the signed VC.',
          );
        selectedClaims = Object.fromEntries(
          Object.entries(source.credentialSubject)
            .filter(([key]) => key in p)
            .map(([key, value]) => {
              if (
                ![
                  ...COMPANY_ALWAYS_CLAIMS,
                  ...companyDisclosureGroup(proof.requiredClaims ?? []),
                  ...companyDisclosureGroup(proof.optionalClaims ?? []),
                ].includes(key)
              )
                throw new Error('An unrequested company claim was disclosed.');
              if (canonical(value) !== canonical(p[key]))
                throw new Error('A disclosed company claim differs from the source credential.');
              return [key, p[key]];
            }),
        );
        jwt = {
          payload: {
            iss: walletPresentation ? proof.presenterWallet : p.holderDid,
            aud: walletPresentation ? proof.audience : p.audience,
            nonce: walletPresentation ? proof.challenge : p.challenge,
            requestId: walletPresentation ? workflow.requestId : p.requestId,
            purpose: walletPresentation ? proof.purpose : p.purpose,
            wallet: p.walletAddress,
            role: p.role,
            exp: walletPresentation ? walletPresentation.proof.context.expiresAt : p.exp,
            credential: source,
            credentialHash: p.sourceCredentialHash,
          },
        };
      } else {
        if (proof.selectiveDisclosure)
          throw new Error('This request requires the selective company identity proof.');
        jwt = await verifyJWT(presentation, {
          audience: proof.audience,
          resolver: keyResolver,
          policies: { now },
        });
      }
    } catch (error) {
      if (error instanceof ProductionFlowApiError) throw error;
      throw new ProductionFlowApiError(
        /expir|max.?age/i.test(error instanceof Error ? error.message : '')
          ? 'IDENTITY_PROOF_EXPIRED'
          : 'IDENTITY_HOLDER_PROOF_INVALID',
        /expir|max.?age/i.test(error instanceof Error ? error.message : '')
          ? 'The company presentation has expired. Obtain a fresh request and approve a new presentation.'
          : 'The company holder signature or required disclosure did not verify. If a signed field is missing, an authorized replacement credential is required.',
        409,
      );
    }
    const payload = jwt.payload as Record<string, unknown>;
    const identity = walletPresentation
      ? undefined
      : await this.dependencies.messagingIdentityRepository?.findIdentityByWallet(
          proof.presenterWallet,
        );
    if (
      (!walletPresentation && (!identity || payload.iss !== identity.did)) ||
      payload.nonce !== proof.challenge ||
      payload.aud !== proof.audience ||
      payload.requestId !== workflow.requestId ||
      payload.purpose !== proof.purpose ||
      !sameAddress(String(payload.wallet ?? ''), proof.presenterWallet) ||
      payload.role !== proof.presenterRole
    )
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_CONTEXT_MISMATCH',
        'The company identity proof is bound to a different holder, request, or recipient.',
        409,
      );
    if (typeof payload.exp !== 'number' || payload.exp > proof.expiresAt || payload.exp <= now)
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_EXPIRED',
        'The presentation has an invalid or expired lifetime.',
        409,
      );
    const credential = companyRoleCredentialSchema.safeParse(payload.credential);
    if (!credential.success)
      throw new ProductionFlowApiError(
        'COMPANY_CREDENTIAL_INVALID',
        'The presentation does not contain a supported Company Role Credential.',
        409,
      );
    for (const claim of proof.requiredClaims ?? []) {
      if (
        !(claim in credential.data.credentialSubject) ||
        !String((credential.data.credentialSubject as Record<string, unknown>)[claim] ?? '').trim()
      )
        throw new ProductionFlowApiError(
          'REQUIRED_IDENTITY_CLAIM_MISSING',
          `The required company identity claim is unavailable: ${claim}.`,
          409,
        );
    }
    const issuer =
      typeof credential.data.issuer === 'string'
        ? credential.data.issuer
        : credential.data.issuer.id;
    const agent = await this.dependencies.agentProvider();
    const checked = await verifyCompanyRoleCredential(
      agent,
      credential.data,
      proof.presenterWallet,
      issuer,
      this.clock(),
    );
    const presentedHash = String(payload.credentialHash ?? '');
    if (
      !checked.verified ||
      normalizeHash(checked.credentialHash ?? '') !== normalizeHash(presentedHash)
    )
      throw new ProductionFlowApiError(
        'COMPANY_CREDENTIAL_INVALID',
        'The Company Role Credential signature, wallet, role, or hash did not verify.',
        409,
      );
    const expectedRole = proof.presenterRole as
      CompanyRole.SUPPLIER | CompanyRole.MANUFACTURER | CompanyRole.RETAILER;
    if (checked.role !== expectedRole)
      throw new ProductionFlowApiError(
        'COMPANY_ROLE_MISMATCH',
        'The Company Role Credential does not contain the requesting role.',
        409,
      );
    const allowed = await this.safeGateway(() =>
      this.dependencies.gateway.getAccess(
        proof.presenterWallet,
        presentedHash,
        ROLE_NUMBERS[expectedRole],
        expectedRole === CompanyRole.SUPPLIER
          ? 'ISSUE_INGREDIENT_CREDENTIAL'
          : workflow.deliveryOrderId
            ? 'INITIATE_TRANSFER'
            : 'REQUEST_EVIDENCE',
      ),
    );
    if (!allowed)
      throw new ProductionFlowApiError(
        'COMPANY_CREDENTIAL_INACTIVE',
        'The requesting company or credential is no longer authorized on chain.',
        409,
      );
    return {
      credential: credential.data,
      credentialHash: presentedHash,
      selectedClaims,
      missingClaims: selectedClaims
        ? companyDisclosureGroup(proof.requiredClaims ?? []).filter(
            (key) => !(key in selectedClaims!),
          )
        : [],
      checks: [
        'AUTHORITY_SIGNATURE',
        'HOLDER_SIGNATURE',
        'WALLET_BINDING',
        'ROLE_BINDING',
        'CHALLENGE_AND_RECIPIENT',
        'EXPIRY',
        'CURRENT_ON_CHAIN_STATUS',
      ],
    };
  }
}

function canonical(value: unknown) {
  return JSON.stringify(sortJson(value));
}
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}
function sha256(value: string) {
  return `0x${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
function evidenceRequestBindingHash(value: {
  batchId: string;
  dueAt: number;
  issuedAt: number;
  purpose: string;
  requestId: string;
  requesterWallet: string;
  supplierWallet: string;
  verifierWallet: string;
}) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('base64url');
}
function sameAddress(left: string, right: string) {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function normalizeHash(value: string) {
  return value.replace(/^0x/i, '').toLowerCase();
}

function roleLabel(role: CompanyRole) {
  return role
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Requested-as-required ingredient claims the holder did not disclose (no-policy requests). */
function unmetIngredientClaims(payload: Record<string, unknown>, required: string[]) {
  const keys = Object.keys(payload);
  const prefix: Record<string, string> = {
    certifications: 'certification_',
    certificationDocuments: 'certificationDocuments_',
    qualityTests: 'qualityTest_',
    qualityDocuments: 'qualityDocuments_',
  };
  return required
    .filter((claim) =>
      prefix[claim]
        ? !keys.some((key) => key.startsWith(prefix[claim]!))
        : payload[claim] == null || payload[claim] === '',
    )
    .map((claim) => `${ingredientClaimLabel(claim)} is required.`);
}
