import { createHash, randomBytes } from 'node:crypto';

import {
  createIngredientEvidencePresentation,
  ingredientCredentialSchema,
  verifyIngredientEvidencePresentation,
  verifyIngredientCredential,
  type IngredientCredential,
  type TraceChainAgent,
} from '@tracechain/ssi';
import { CompanyRole } from '@tracechain/shared';
import { getAddress, id } from 'ethers';

import type { AuthService } from '../auth/auth.service.js';
import type { SessionRecord } from '../auth/auth.types.js';
import type { IngredientBatchWorkflowRepository } from '../ingredient-batches/ingredient-batch.repository.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { TraceChainAgentProvider } from '../ssi/ssi.service.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import type { ProductionFlowGateway } from './production-flow.gateway.js';
import type {
  EvidenceWorkflowRecord,
  ProductionFlowRepository,
} from './production-flow.repository.js';
import type {
  EvidenceRequestInput,
  ProductRequestInput,
  TransferRequestInput,
} from './production-flow.schema.js';

const ROLE_NUMBERS = {
  [CompanyRole.SUPPLIER]: 2,
  [CompanyRole.MANUFACTURER]: 3,
} as const;

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
    const role = session.onChainAuthorization!.role === CompanyRole.SUPPLIER ? 2 : 3;
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
        return chain
          ? {
              ...chain,
              requestId: record.requestId,
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
        supplierName: names.get(request.supplier.toLowerCase()),
      })),
    };
  }

  async prepareEvidenceRequest(sessionId: string | undefined, input: EvidenceRequestInput) {
    const session = await this.requireRole(sessionId, CompanyRole.MANUFACTURER, 'REQUEST_EVIDENCE');
    const dueAt = Math.floor(input.dueAt.getTime() / 1_000);
    if (dueAt <= this.nowSeconds()) {
      throw new ProductionFlowApiError(
        'INVALID_DEADLINE',
        'The evidence deadline must be in the future.',
        400,
      );
    }
    const batch = await this.requireActiveIngredient(input.batchId);
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

  async prepareEvidenceResponse(sessionId: string | undefined, requestId: string) {
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
      response = await this.createEvidenceResponse(workflow, session.address);
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
    const session = await this.requireRole(sessionId, CompanyRole.MANUFACTURER, 'REQUEST_EVIDENCE');
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
    const credentialId = await this.verifyPersistedPresentation(workflow, chain);
    return {
      actorWallet: session.address,
      requestId,
      state: 'TRANSACTION_REQUIRED' as const,
      transaction: this.dependencies.gateway.prepareAccept(requestId, credentialId),
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

  private async createEvidenceWorkflow(
    session: SessionRecord,
    input: EvidenceRequestInput,
    supplier: string,
    dueAt: number,
  ) {
    const challenge = randomBytes(32).toString('base64url');
    const challengeHash = id(challenge);
    const claims = [...new Set(input.claims)].sort();
    const claimsHash = sha256(canonical(claims));
    const requestId = id(`${input.operationId}:${session.address}`);
    const stored = await this.store(
      canonical({
        batchId: input.batchId,
        challenge,
        claims,
        dueAt,
        reason: input.reason,
        requester: session.address,
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

  private async createEvidenceResponse(workflow: EvidenceWorkflowRecord, supplierWallet: string) {
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
    ) as { credential?: unknown };
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
    const request = JSON.parse(
      await this.dependencies.contentStore.decrypt(workflow.requestPayload),
    ) as { challenge?: string };
    if (!request.challenge || id(request.challenge) !== workflow.challengeHash)
      throw this.recordMismatch('Evidence challenge mismatch.');
    const presentationExpiresAt = Math.min(ingredient.expiresAt, this.nowSeconds() + 48 * 60 * 60);
    const presentation = await createIngredientEvidencePresentation(agent, {
      challenge: request.challenge,
      credential,
      expirationDate: new Date(presentationExpiresAt * 1_000),
      holderDid: ingredient.issuerDid,
    });
    const checked = await verifyIngredientEvidencePresentation(agent, presentation, {
      challenge: request.challenge,
      expectedIssuerDid: ingredient.issuerDid,
      now: this.clock(),
      supplierWallet,
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
    ) as { challenge?: string };
    const presentation = JSON.parse(
      await this.dependencies.contentStore.decrypt(workflow.response.presentationPayload),
    ) as unknown;
    if (!request.challenge || id(request.challenge) !== chain!.challengeHash)
      throw this.recordMismatch('Presentation challenge mismatch.');
    const ingredient = await this.dependencies.ingredientRepository.find(workflow.batchId);
    if (!ingredient) throw this.recordMismatch('Ingredient workflow is missing.');
    const agent: TraceChainAgent = await this.dependencies.agentProvider();
    const verified = await verifyIngredientEvidencePresentation(agent, presentation, {
      challenge: request.challenge,
      expectedIssuerDid: ingredient.issuerDid,
      now: this.clock(),
      supplierWallet: workflow.supplier,
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
    role: CompanyRole.SUPPLIER | CompanyRole.MANUFACTURER,
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
        `Current on-chain ${role === CompanyRole.SUPPLIER ? 'Supplier' : 'Manufacturer'} authorization is required.`,
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
    throw new ProductionFlowApiError(
      'ROLE_AUTHORIZATION_REQUIRED',
      'A Supplier or Manufacturer role is required.',
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
