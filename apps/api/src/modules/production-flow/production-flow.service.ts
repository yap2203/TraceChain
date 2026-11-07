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
  type IngredientCredential,
  type TraceChainAgent,
} from '@tracechain/ssi';
import { CompanyRole } from '@tracechain/shared';
import { Resolver } from 'did-resolver';
import { verifyJWT } from 'did-jwt';
import { getAddress, id } from 'ethers';
import { getResolver } from 'key-did-resolver';

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

export class ProductionFlowService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: Dependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async listIngredients(sessionId?: string) {
    const session = await this.requireRole(sessionId, CompanyRole.MANUFACTURER, 'REQUEST_EVIDENCE');
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
        return {
          accepted: await this.safeGateway(() =>
            this.dependencies.gateway.getAccepted(batch.batchId, session.address),
          ),
          availableQuantity: batch.availableQuantity,
          batchId: batch.batchId,
          expiresAt: batch.expiresAt,
          supplier: batch.supplier,
          unit: batch.unit,
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
        requestIds.map((requestId) => this.dependencies.repository.findEvidence(requestId)),
      )
    ).filter((record): record is EvidenceWorkflowRecord => Boolean(record));
    const requests = await Promise.all(
      relevant.map(async (record) => {
        const chain = await this.safeGateway(() =>
          this.dependencies.gateway.getEvidenceRequest(record.requestId),
        );
        let context: { productBatchId?: string; requesterRole?: CompanyRole } = {};
        try {
          context = JSON.parse(
            await this.dependencies.contentStore.decrypt(record.requestPayload),
          ) as typeof context;
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
    const nested = await Promise.all(
      productIds.map(async (productBatchId) => {
        const product = await this.safeGateway(() =>
          this.dependencies.gateway.getProduct(productBatchId),
        );
        if (!product || product.status !== 1 || product.expiresAt <= this.nowSeconds()) return [];
        const links = await this.safeGateway(() =>
          this.dependencies.gateway.getProductLinks(productBatchId),
        );
        return Promise.all(
          links.map(async (link) => {
            const ingredient = await this.safeGateway(() =>
              this.dependencies.gateway.getIngredient(link.batchId),
            );
            return ingredient
              ? {
                  ingredientBatchId: link.batchId,
                  productBatchId,
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
    const workflow = await this.requireWorkflow(requestId);
    if (
      !sameAddress(session.address, workflow.requester) &&
      !sameAddress(session.address, workflow.supplier)
    )
      throw new ProductionFlowApiError(
        'EVIDENCE_ACCESS_DENIED',
        'Only the request participants can access private evidence details.',
        403,
      );
    const chain = await this.requireChainRequest(requestId);
    const request = JSON.parse(
      await this.dependencies.contentStore.decrypt(workflow.requestPayload),
    ) as { claims?: string[]; requiredClaims?: string[]; reason?: string };
    let presentation: unknown;
    if (workflow.response) {
      const serializedPresentation = await this.dependencies.contentStore.decrypt(
        workflow.response.presentationPayload,
      );
      const ingredient = await this.dependencies.ingredientRepository.find(workflow.batchId);
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
      requiredClaims: request.requiredClaims ?? request.claims ?? [],
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
    const workflow = await this.requireWorkflow(requestId);
    const chain = await this.requireChainRequest(requestId);
    if (!sameAddress(session.address, workflow.requester))
      throw new ProductionFlowApiError(
        'EVIDENCE_ACCESS_DENIED',
        'Only the requesting Manufacturer can review this presentation.',
        403,
      );
    if (!workflow.response || chain.status < 2)
      throw new ProductionFlowApiError(
        'EVIDENCE_NOT_RECEIVED',
        'No presentation has been received for this request.',
        409,
      );
    const serializedPresentation = await this.dependencies.contentStore.decrypt(
      workflow.response.presentationPayload,
    );
    const ingredient = await this.dependencies.ingredientRepository.find(workflow.batchId);
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
      const sharedClaims = Object.fromEntries(
        Object.entries(claims).filter(
          ([key]) => !['iss', 'sub', 'vct', 'cnf', 'iat', 'exp'].includes(key),
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
        supplier: workflow.supplier,
        supplierName: names.get(workflow.supplier.toLowerCase()),
        status: chain.status,
        verification: workflow.response.verification ?? { state: 'NOT_VERIFIED' as const },
      };
    }
    const presentation = JSON.parse(serializedPresentation) as {
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
      presentationExpiry:
        presentation.expirationDate ?? new Date(chain.presentationExpiresAt * 1_000).toISOString(),
      requestId,
      sharedClaims: {
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
      },
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
      if (!received.some((id) => id.toLowerCase() === input.productBatchId!.toLowerCase()))
        throw new ProductionFlowApiError(
          'PRODUCT_ACCESS_DENIED',
          'This Retailer has not received the selected product batch.',
          403,
        );
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

  async requestCompanyIdentityProof(sessionId: string | undefined, requestId: string) {
    const session = await this.requireRole(
      sessionId,
      CompanyRole.SUPPLIER,
      'ISSUE_INGREDIENT_CREDENTIAL',
    );
    const workflow = await this.requireWorkflow(requestId);
    const chain = await this.requireChainRequest(requestId);
    if (!sameAddress(session.address, workflow.supplier) || chain.status !== 1)
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_NOT_REQUESTABLE',
        'Only the intended Supplier can request identity proof while evidence is awaiting response.',
        409,
      );
    if (workflow.identityProof?.status === 'VERIFIED') return this.identityProofSummary(workflow);
    const requesterSessionRole = await this.requesterRole(workflow);
    if (![CompanyRole.MANUFACTURER, CompanyRole.RETAILER].includes(requesterSessionRole))
      throw new ProductionFlowApiError(
        'IDENTITY_PRESENTER_ROLE_INVALID',
        'Only the requesting Manufacturer or Retailer can present company identity.',
        409,
      );
    workflow.identityProof = {
      audience: session.address.toLowerCase(),
      challenge: randomBytes(32).toString('base64url'),
      expiresAt: this.nowSeconds() + 15 * 60,
      presenterRole: requesterSessionRole,
      presenterWallet: workflow.requester,
      purpose: `Confirm requester company identity before ingredient evidence disclosure for ${requestId}`,
      status: 'REQUESTED',
    };
    await this.dependencies.repository.saveEvidence(workflow);
    return this.identityProofSummary(workflow);
  }

  async getCompanyIdentityProofMaterial(sessionId: string | undefined, requestId: string) {
    const session = await this.requireEvidenceRequester(sessionId);
    const workflow = await this.requireWorkflow(requestId);
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
    const session = await this.requireEvidenceRequester(sessionId);
    const workflow = await this.requireWorkflow(requestId);
    if (!sameAddress(session.address, workflow.requester))
      throw new ProductionFlowApiError('IDENTITY_PROOF_ACCESS_DENIED', 'Wrong presenter.', 403);
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
      presentationPayload: stored.payload,
      status: 'PRESENTED',
    };
    await this.dependencies.repository.saveEvidence(workflow);
    return this.identityProofSummary(workflow);
  }

  async verifyCompanyIdentityProof(sessionId: string | undefined, requestId: string) {
    const session = await this.requireRole(
      sessionId,
      CompanyRole.SUPPLIER,
      'ISSUE_INGREDIENT_CREDENTIAL',
    );
    const workflow = await this.requireWorkflow(requestId);
    if (
      !sameAddress(session.address, workflow.supplier) ||
      !workflow.identityProof?.presentationPayload
    )
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_ACCESS_DENIED',
        'Only the intended Supplier can verify the received identity proof.',
        403,
      );
    const presentation = await this.dependencies.contentStore.decrypt(
      workflow.identityProof.presentationPayload,
    );
    const result = await this.verifyCompanyIdentityPresentation(workflow, presentation);
    workflow.identityProof.status = 'VERIFIED';
    workflow.identityProof.verifiedAt = this.clock().toISOString();
    await this.dependencies.repository.saveEvidence(workflow);
    return {
      ...this.identityProofSummary(workflow),
      checks: result.checks,
      credential: this.identityCredentialSummary(
        result.credential,
        result.credentialHash,
      ),
    };
  }

  async declineCompanyIdentityProof(sessionId: string | undefined, requestId: string) {
    const session = await this.requireEvidenceRequester(sessionId);
    const workflow = await this.requireWorkflow(requestId);
    if (!sameAddress(session.address, workflow.requester))
      throw new ProductionFlowApiError('IDENTITY_PROOF_ACCESS_DENIED', 'Wrong presenter.', 403);
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

  async getCompanyIdentityProofStatus(sessionId: string | undefined, requestId: string) {
    const session = await this.requireEitherRole(sessionId);
    const workflow = await this.requireWorkflow(requestId);
    if (
      !sameAddress(session.address, workflow.requester) &&
      !sameAddress(session.address, workflow.supplier)
    )
      throw new ProductionFlowApiError('IDENTITY_PROOF_ACCESS_DENIED', 'Access denied.', 403);
    const summary = this.identityProofSummary(workflow);
    if (
      sameAddress(session.address, workflow.supplier) &&
      workflow.identityProof?.status === 'VERIFIED' &&
      workflow.identityProof.presentationPayload
    ) {
      const presentation = JSON.parse(
        await this.dependencies.contentStore.decrypt(workflow.identityProof.presentationPayload),
      ) as { credential?: unknown; credentialHash?: string };
      const credential = companyRoleCredentialSchema.safeParse(presentation.credential);
      if (credential.success)
        return {
          ...summary,
          credential: this.identityCredentialSummary(
            credential.data,
            String(presentation.credentialHash ?? ''),
          ),
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
    const workflow = await this.requireWorkflow(requestId);
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
    if (!sameAddress(batch.supplier, session.address)) {
      throw new ProductionFlowApiError(
        'BATCH_OWNERSHIP_MISMATCH',
        'The requested ingredient batch is not owned by this Supplier.',
        403,
      );
    }

    let response = workflow.response;
    if (!response) {
      const ingredient = await this.dependencies.ingredientRepository.find(workflow.batchId);
      if (ingredient?.credentialFormat === 'SD_JWT_VC' && !holderResponse) {
        const request = JSON.parse(
          await this.dependencies.contentStore.decrypt(workflow.requestPayload),
        ) as { challenge?: string; claims?: string[]; requiredClaims?: string[]; reason?: string };
        const envelope = JSON.parse(
          await this.dependencies.contentStore.decrypt(ingredient.encryptedPayload),
        ) as { sdJwt?: string };
        if (!request.challenge || !envelope.sdJwt || !ingredient.holderDid)
          throw this.recordMismatch('Selective presentation material is incomplete.');
        return {
          actorWallet: session.address,
          holderSigning: {
            audience: workflow.requester.toLowerCase(),
            claims: request.claims ?? [],
            requiredClaims: request.requiredClaims ?? request.claims ?? [],
            credential: envelope.sdJwt,
            holderDid: ingredient.holderDid,
            nonce: request.challenge,
            purpose: request.reason ?? 'Ingredient evidence verification',
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
    const workflow = await this.requireWorkflow(requestId);
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
      const accepted = await this.safeGateway(() =>
        this.dependencies.gateway.getAccepted(workflow.batchId, session.address),
      );
      if (!accepted) throw this.recordMismatch('The accepted evidence flag is missing.');
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

  async verifyEvidence(sessionId: string | undefined, requestId: string) {
    const session = await this.requireEvidenceRequester(sessionId);
    const workflow = await this.requireWorkflow(requestId);
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
    const workflow = await this.requireWorkflow(requestId);
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
    for (const link of input.ingredientLinks) {
      const batch = await this.requireActiveIngredient(link.batchId);
      if (
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
      if (BigInt(link.quantity) > BigInt(batch.availableQuantity)) {
        throw new ProductionFlowApiError(
          'INSUFFICIENT_INGREDIENT_QUANTITY',
          'An ingredient does not have enough available quantity.',
          409,
        );
      }
    }
    const batchId = id(input.batchReference);
    const metadata = canonical({
      batchReference: input.batchReference,
      category: input.category,
      privateMetadata: input.privateMetadata,
      productName: input.productName,
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
        state: 'COMPLETE' as const,
        status: existing.status,
      };
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
    if (!workflow) return undefined;
    try {
      const parsed = JSON.parse(
        await this.dependencies.contentStore.decrypt(workflow.payload),
      ) as Record<string, unknown>;
      return {
        batchReference:
          typeof parsed.batchReference === 'string' ? parsed.batchReference : undefined,
        productName: typeof parsed.productName === 'string' ? parsed.productName : undefined,
      };
    } catch {
      return undefined;
    }
  }

  private async createEvidenceWorkflow(
    session: SessionRecord,
    input: EvidenceRequestInput,
    supplier: string,
    dueAt: number,
  ) {
    const challenge = randomBytes(32).toString('base64url');
    const challengeHash = id(challenge);
    const claims = [...new Set(input.claims)].sort();
    const requiredClaims = [...new Set(input.requiredClaims)].sort();
    if (requiredClaims.some((claim) => !claims.includes(claim)))
      throw new ProductionFlowApiError(
        'INVALID_CLAIM_REQUIREMENTS',
        'Every required claim must also be included in the requested claims.',
        400,
      );
    const claimsHash = sha256(canonical({ claims, requiredClaims }));
    const requestId = id(`${input.operationId}:${session.address}`);
    const stored = await this.store(
      canonical({
        batchId: input.batchId,
        challenge,
        claims,
        requiredClaims,
        dueAt,
        productBatchId: input.productBatchId,
        reason: input.reason,
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
    const ingredient = await this.dependencies.ingredientRepository.find(workflow.batchId);
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
      await this.dependencies.contentStore.decrypt(workflow.requestPayload),
    ) as { challenge?: string; claims?: string[]; requiredClaims?: string[]; reason?: string };
    if (!request.challenge || id(request.challenge) !== workflow.challengeHash)
      throw this.recordMismatch('Evidence challenge mismatch.');
    if (ingredient.credentialFormat === 'SD_JWT_VC') {
      if (!holderPresentation || !envelope.sdJwt || !ingredient.holderDid)
        throw new ProductionFlowApiError(
          'HOLDER_SIGNATURE_REQUIRED',
          'The Supplier must approve and sign the selective presentation in the browser.',
          409,
        );
      const verified = await this.verifySelectivePresentation(agent, holderPresentation, {
        audience: workflow.requester.toLowerCase(),
        batchId: ingredient.batchId,
        nonce: request.challenge,
        requiredClaims: request.requiredClaims ?? request.claims ?? [],
        supplierWallet,
      });
      if (String(verified.payload.credentialId) === '')
        throw this.recordMismatch('The selective presentation credential identifier is missing.');
      const presentationExpiresAt = Math.min(
        ingredient.expiresAt,
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
      await this.dependencies.contentStore.decrypt(workflow.requestPayload),
    ) as { challenge?: string; reason?: string };
    const serializedPresentation = await this.dependencies.contentStore.decrypt(
      workflow.response.presentationPayload,
    );
    if (!request.challenge || id(request.challenge) !== chain!.challengeHash)
      throw this.recordMismatch('Presentation challenge mismatch.');
    const ingredient = await this.dependencies.ingredientRepository.find(workflow.batchId);
    if (!ingredient) throw this.recordMismatch('Ingredient workflow is missing.');
    const agent: TraceChainAgent = await this.dependencies.agentProvider();
    if (ingredient.credentialFormat === 'SD_JWT_VC') {
      const requestDetails = JSON.parse(
        await this.dependencies.contentStore.decrypt(workflow.requestPayload),
      ) as { claims?: string[]; requiredClaims?: string[] };
      const verified = await this.verifySelectivePresentation(agent, serializedPresentation, {
        audience: workflow.requester.toLowerCase(),
        batchId: ingredient.batchId,
        nonce: request.challenge,
        requiredClaims: requestDetails.requiredClaims ?? requestDetails.claims ?? [],
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
    const presentation = JSON.parse(serializedPresentation) as unknown;
    const verified = await verifyIngredientEvidencePresentation(agent, presentation, {
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
  private async requireWorkflow(requestId: string) {
    const record = await this.dependencies.repository.findEvidence(requestId);
    if (!record)
      throw new ProductionFlowApiError(
        'REQUEST_NOT_FOUND',
        'The evidence request was not found.',
        404,
      );
    return record;
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
  private recordMismatch(message: string) {
    return new ProductionFlowApiError('ON_CHAIN_RECORD_MISMATCH', message, 409);
  }
  private nowSeconds() {
    return Math.floor(this.clock().getTime() / 1_000);
  }
  private async store(content: string, key: string) {
    try {
      return await this.dependencies.contentStore.encryptAndStore(content, key);
    } catch {
      throw new ProductionFlowApiError(
        'ENCRYPTED_STORAGE_UNAVAILABLE',
        'Encrypted off-chain storage is unavailable. No transaction was prepared.',
        503,
      );
    }
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
    },
  ) {
    try {
      return await verifyIngredientSdJwtPresentation(agent, presentation, {
        ...input,
        now: this.nowSeconds(),
      });
    } catch (error) {
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
        message,
      });
      throw new ProductionFlowApiError(
        code,
        code === 'PRESENTATION_EXPIRED'
          ? 'The selective presentation has expired. Create and approve a new response.'
          : code === 'REQUIRED_CLAIM_MISSING'
            ? 'The presentation does not disclose every claim required by the Manufacturer.'
            : code === 'PRESENTATION_PROOF_INVALID'
              ? 'The holder signature, request challenge, or intended recipient did not verify.'
              : 'The selective presentation could not be verified. Restore the key bound to this credential and retry.',
        409,
      );
    }
  }

  private async requesterRole(workflow: EvidenceWorkflowRecord) {
    const payload = JSON.parse(
      await this.dependencies.contentStore.decrypt(workflow.requestPayload),
    ) as { requesterRole?: CompanyRole };
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

  private identityProofSummary(workflow: EvidenceWorkflowRecord) {
    const proof = workflow.identityProof;
    return {
      expiresAt: proof?.expiresAt,
      presenterRole: proof?.presenterRole,
      presenterWallet: proof?.presenterWallet,
      purpose: proof?.purpose,
      requestId: workflow.requestId,
      status:
        proof &&
        proof.status !== 'DECLINED' &&
        proof.status !== 'VERIFIED' &&
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

  private async verifyCompanyIdentityPresentation(
    workflow: EvidenceWorkflowRecord,
    presentation: string,
  ) {
    const proof = workflow.identityProof;
    if (!proof || proof.expiresAt <= this.nowSeconds())
      throw new ProductionFlowApiError(
        'IDENTITY_PROOF_EXPIRED',
        'The company identity-proof request has expired.',
        409,
      );
    let jwt;
    try {
      jwt = await verifyJWT(presentation, { audience: proof.audience, resolver: keyResolver });
    } catch {
      throw new ProductionFlowApiError(
        'IDENTITY_HOLDER_PROOF_INVALID',
        'The company identity holder signature did not verify.',
        409,
      );
    }
    const payload = jwt.payload as Record<string, unknown>;
    const identity = await this.dependencies.messagingIdentityRepository?.findIdentityByWallet(
      proof.presenterWallet,
    );
    if (
      !identity ||
      payload.iss !== identity.did ||
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
    const credential = companyRoleCredentialSchema.safeParse(payload.credential);
    if (!credential.success)
      throw new ProductionFlowApiError(
        'COMPANY_CREDENTIAL_INVALID',
        'The presentation does not contain a supported Company Role Credential.',
        409,
      );
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
    const expectedRole = proof.presenterRole as CompanyRole.MANUFACTURER | CompanyRole.RETAILER;
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
        'REQUEST_EVIDENCE',
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
