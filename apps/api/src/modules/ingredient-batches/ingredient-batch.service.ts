import { createHash, randomUUID } from 'node:crypto';

import {
  canonicalIngredientMetadata,
  createOrGetSupplierIssuerDid,
  ingredientCredentialSchema,
  issueIngredientCredential,
  issueIngredientSdJwt,
  verifyIngredientCredential,
  verifyIssuedIngredientSdJwt,
  type TraceChainAgent,
} from '@tracechain/ssi';
import { CompanyRole } from '@tracechain/shared';
import { decodeBytes32String, getAddress, id } from 'ethers';

import type { AuthService } from '../auth/auth.service.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { TraceChainAgentProvider } from '../ssi/ssi.service.js';
import type { IngredientBatchGateway } from './ingredient-batch.gateway.js';
import type {
  IngredientBatchWorkflowRecord,
  IngredientBatchWorkflowRepository,
} from './ingredient-batch.repository.js';
import type { IngredientBatchRequest } from './ingredient-batch.schema.js';

export class IngredientBatchApiError extends Error {
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
  gateway: IngredientBatchGateway;
  repository: IngredientBatchWorkflowRepository;
  messagingIdentityResolver?: {
    findIdentityByWallet(wallet: string): Promise<{ did: string } | undefined>;
  };
}

export class IngredientBatchService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: Dependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async prepare(sessionId: string | undefined, input: IngredientBatchRequest) {
    const session = await this.requireSupplier(sessionId);
    const supplierWallet = getAddress(session.address);
    await this.requireChainAuthorization(
      supplierWallet,
      session.onChainAuthorization!.credentialHash!,
    );

    const normalized = this.issueInput(input, supplierWallet);
    const batchId = id(input.batchReference);
    const canonicalMetadata = canonicalIngredientMetadata(normalized);
    const metadataHash = `0x${createHash('sha256').update(canonicalMetadata).digest('hex')}`;
    let record = await this.dependencies.repository.find(batchId);
    const agent = await this.dependencies.agentProvider();

    if (record) {
      this.requireMatchingWorkflow(record, normalized, metadataHash);
      await this.verifyStoredCredential(agent, record);
    } else {
      const existingBatch = await this.safeGateway(() =>
        this.dependencies.gateway.getBatch(batchId),
      );
      if (existingBatch) {
        throw new IngredientBatchApiError(
          'DUPLICATE_BATCH',
          'This ingredient batch ID is already registered.',
          409,
        );
      }
      record = await this.createWorkflow(
        agent,
        normalized,
        batchId,
        metadataHash,
        canonicalMetadata,
      );
    }

    return this.workflowResponse(record);
  }

  async list(sessionId: string | undefined) {
    const session = await this.requireSupplier(sessionId);
    const supplierWallet = getAddress(session.address);
    await this.requireChainAuthorization(
      supplierWallet,
      session.onChainAuthorization!.credentialHash!,
    );
    const batchIds = await this.safeGateway(() =>
      this.dependencies.gateway.listBatchIds(supplierWallet),
    );
    const batches = await Promise.all(
      batchIds.map(async (batchId) => {
        const batch = await this.safeGateway(() => this.dependencies.gateway.getBatch(batchId));
        if (!batch || getAddress(batch.supplier) !== supplierWallet) return null;
        const record = await this.dependencies.repository.find(batchId);
        let metadata: Record<string, unknown> = {};
        if (record) {
          try {
            const envelope = JSON.parse(
              await this.dependencies.contentStore.decrypt(record.encryptedPayload),
            ) as { metadata?: Record<string, unknown> };
            metadata = envelope.metadata ?? {};
          } catch {
            metadata = {};
          }
        }
        return {
          allergenInformation: stringValue(metadata.allergenInformation),
          availableQuantity: batch.availableQuantity,
          batchId,
          batchReference: stringValue(metadata.batchId, batchId),
          category: stringValue(metadata.category),
          certifications: Array.isArray(metadata.certifications)
            ? metadata.certifications.filter((value): value is string => typeof value === 'string')
            : [],
          credentialId: batch.credentialId,
          encryptedCid: batch.encryptedCid,
          expiresAt: batch.expiresAt,
          ingredientName: stringValue(metadata.ingredientName, 'Registered ingredient'),
          metadataHash: batch.metadataHash,
          origin: stringValue(metadata.origin),
          producedAt: batch.producedAt,
          quantity: batch.totalQuantity,
          status: batch.status,
          supplier: batch.supplier,
          unit: decodeUnit(batch.unit),
        };
      }),
    );
    return { batches: batches.filter((batch) => batch !== null) };
  }

  private async workflowResponse(record: IngredientBatchWorkflowRecord) {
    const batch = await this.safeGateway(() => this.dependencies.gateway.getBatch(record.batchId));
    if (batch) {
      this.verifyBatchRecord(batch, record);
      return {
        batchId: record.batchId,
        credentialId: record.credentialId,
        state: 'COMPLETE',
        supplierWallet: record.supplierWallet,
      };
    }

    const credential = await this.safeGateway(() =>
      this.dependencies.gateway.getCredential(record.credentialId),
    );
    if (!credential) {
      return {
        batchId: record.batchId,
        credentialId: record.credentialId,
        state: 'CREDENTIAL_REGISTRATION_REQUIRED',
        supplierWallet: record.supplierWallet,
        transaction: this.dependencies.gateway.prepareIngredientCredentialRegistration({
          credentialHash: record.credentialHash,
          credentialId: record.credentialId,
          encryptedCid: record.encryptedCid,
          expiresAt: record.expiresAt,
          supplierWallet: record.supplierWallet,
        }),
      };
    }
    this.verifyCredentialRecord(credential, record);
    return {
      batchId: record.batchId,
      credentialId: record.credentialId,
      state: 'BATCH_REGISTRATION_REQUIRED',
      supplierWallet: record.supplierWallet,
      transaction: this.dependencies.gateway.prepareBatchRegistration({
        batchId: record.batchId,
        credentialId: record.credentialId,
        encryptedCid: record.encryptedCid,
        expiresAt: record.expiresAt,
        metadataHash: record.metadataHash,
        producedAt: record.producedAt,
        quantity: record.quantity,
        unit: record.unit,
      }),
    };
  }

  private async createWorkflow(
    agent: TraceChainAgent,
    input: ReturnType<IngredientBatchService['issueInput']>,
    batchId: string,
    metadataHash: string,
    canonicalMetadata: string,
  ) {
    const issuer = await createOrGetSupplierIssuerDid(agent, input.supplierWallet);
    const messagingIdentity =
      await this.dependencies.messagingIdentityResolver?.findIdentityByWallet(input.supplierWallet);
    if (this.dependencies.messagingIdentityResolver && !messagingIdentity)
      throw new IngredientBatchApiError(
        'HOLDER_KEY_BINDING_REQUIRED',
        'Create and bind the Supplier messaging identity before issuing a selectively disclosable Ingredient Credential.',
        409,
      );
    if (messagingIdentity) {
      const credentialUrn = `urn:uuid:${randomUUID()}`;
      const sdJwt = await issueIngredientSdJwt(agent, {
        claims: {
          allergenDeclaration: input.allergenInformation || undefined,
          batchId,
          batchReference: input.batchId,
          certificationDetails: input.certifications.length ? input.certifications : undefined,
          countryOfOrigin: input.origin,
          credentialId: credentialUrn,
          expiryDate: input.expiryDate.toISOString(),
          ingredientName: input.ingredientName,
          productionDate: input.productionDate.toISOString(),
          supplierWallet: input.supplierWallet,
        },
        expiresAt: Math.floor(input.expiryDate.getTime() / 1_000),
        holderDid: messagingIdentity.did,
        issuerDid: issuer.identifier.did,
        issuedAt: Math.floor(this.clock().getTime() / 1_000),
      });
      await verifyIssuedIngredientSdJwt(agent, sdJwt, {
        now: Math.floor(this.clock().getTime() / 1_000),
        supplierWallet: input.supplierWallet,
      });
      const credentialId = id(credentialUrn);
      const credentialHash = `0x${createHash('sha256').update(sdJwt).digest('hex')}`;
      let stored;
      try {
        stored = await this.dependencies.contentStore.encryptAndStore(
          JSON.stringify({
            credentialFormat: 'SD_JWT_VC',
            metadata: JSON.parse(canonicalMetadata),
            sdJwt,
            version: 2,
          }),
          credentialId,
        );
      } catch {
        throw new IngredientBatchApiError(
          'ENCRYPTED_STORAGE_UNAVAILABLE',
          'The encrypted Ingredient Credential could not be stored. No blockchain transaction was prepared.',
          503,
        );
      }
      const record: IngredientBatchWorkflowRecord = {
        batchId,
        credentialFormat: 'SD_JWT_VC',
        credentialHash,
        credentialId,
        encryptedCid: stored.cid,
        encryptedPayload: stored.payload,
        expiresAt: Math.floor(input.expiryDate.getTime() / 1_000),
        holderDid: messagingIdentity.did,
        issuerDid: issuer.identifier.did,
        metadataHash,
        producedAt: Math.floor(input.productionDate.getTime() / 1_000),
        quantity: input.quantity,
        supplierWallet: input.supplierWallet,
        unit: input.unit,
      };
      await this.dependencies.repository.save(record);
      return record;
    }
    const issued = await issueIngredientCredential(agent, {
      ...input,
      issuanceDate: this.clock(),
      issuerDid: issuer.identifier.did,
      issuerOperatorChainId: 11_155_111,
    });
    const verification = await verifyIngredientCredential(
      agent,
      issued.credential,
      input.supplierWallet,
      issuer.identifier.did,
      this.clock(),
    );
    if (!verification.verified || verification.credentialHash !== issued.credentialHash) {
      throw new IngredientBatchApiError(
        'ISSUED_CREDENTIAL_INVALID',
        'The generated Ingredient Credential failed cryptographic verification.',
        500,
      );
    }
    const credentialId = id(issued.credential.id);
    let stored;
    try {
      stored = await this.dependencies.contentStore.encryptAndStore(
        JSON.stringify({
          credential: issued.credential,
          metadata: JSON.parse(canonicalMetadata),
          version: 1,
        }),
        credentialId,
      );
    } catch {
      throw new IngredientBatchApiError(
        'ENCRYPTED_STORAGE_UNAVAILABLE',
        'The encrypted Ingredient Credential could not be stored. No blockchain transaction was prepared.',
        503,
      );
    }
    const record: IngredientBatchWorkflowRecord = {
      batchId,
      credentialHash: `0x${issued.credentialHash}`,
      credentialId,
      encryptedCid: stored.cid,
      encryptedPayload: stored.payload,
      expiresAt: Math.floor(input.expiryDate.getTime() / 1_000),
      issuerDid: issuer.identifier.did,
      metadataHash,
      producedAt: Math.floor(input.productionDate.getTime() / 1_000),
      quantity: input.quantity,
      supplierWallet: input.supplierWallet,
      unit: input.unit,
      credentialFormat: 'JWT_VC',
    };
    await this.dependencies.repository.save(record);
    return record;
  }

  private async verifyStoredCredential(
    agent: TraceChainAgent,
    record: IngredientBatchWorkflowRecord,
  ) {
    const envelope = JSON.parse(
      await this.dependencies.contentStore.decrypt(record.encryptedPayload),
    ) as { credential?: unknown; sdJwt?: string };
    if (record.credentialFormat === 'SD_JWT_VC') {
      if (!envelope.sdJwt) throw new Error('The stored SD-JWT credential is missing.');
      await verifyIssuedIngredientSdJwt(agent, envelope.sdJwt, {
        now: Math.floor(this.clock().getTime() / 1_000),
        supplierWallet: record.supplierWallet,
      });
      const hash = `0x${createHash('sha256').update(envelope.sdJwt).digest('hex')}`;
      if (hash.toLowerCase() !== record.credentialHash.toLowerCase())
        throw new IngredientBatchApiError(
          'PERSISTED_CREDENTIAL_INVALID',
          'The persisted Ingredient Credential hash does not match.',
          500,
        );
      return;
    }
    const credential = ingredientCredentialSchema.parse(envelope.credential);
    const verification = await verifyIngredientCredential(
      agent,
      credential,
      record.supplierWallet,
      record.issuerDid,
      this.clock(),
    );
    if (
      !verification.verified ||
      `0x${verification.credentialHash}`.toLowerCase() !== record.credentialHash.toLowerCase()
    ) {
      throw new IngredientBatchApiError(
        'PERSISTED_CREDENTIAL_INVALID',
        'The persisted Ingredient Credential failed verification.',
        500,
      );
    }
  }

  private async requireSupplier(sessionId: string | undefined) {
    const session = await this.dependencies.authService.requireSession(sessionId);
    const authorization = session.onChainAuthorization;
    if (
      authorization?.status !== 'AUTHORIZED' ||
      authorization.role !== CompanyRole.SUPPLIER ||
      !authorization.credentialHash
    ) {
      throw new IngredientBatchApiError(
        'SUPPLIER_AUTHORIZATION_REQUIRED',
        'Current on-chain Supplier authorization is required.',
        403,
      );
    }
    return session;
  }

  private async requireChainAuthorization(wallet: string, companyRoleCredentialHash: string) {
    await this.safeGateway(() => this.dependencies.gateway.assertDeployment());
    const access = await this.safeGateway(() =>
      this.dependencies.gateway.getSupplierAccess(wallet, companyRoleCredentialHash),
    );
    if (access.role !== 2 || access.status !== 1 || !access.credentialAuthorized) {
      throw new IngredientBatchApiError(
        'SUPPLIER_AUTHORIZATION_REQUIRED',
        'The authenticated wallet is not an active on-chain Supplier.',
        403,
      );
    }
    if (!access.issuePermission || !access.registerPermission) {
      throw new IngredientBatchApiError(
        'SUPPLIER_PERMISSION_REQUIRED',
        'The Supplier role lacks an ingredient issuance or registration permission.',
        403,
      );
    }
  }

  private issueInput(input: IngredientBatchRequest, supplierWallet: string) {
    return {
      allergenInformation: input.allergenInformation,
      batchId: input.batchReference,
      category: input.category,
      certifications: [...input.certifications].sort(),
      expiryDate: input.expiryDate,
      ingredientName: input.ingredientName,
      origin: input.origin,
      productionDate: input.productionDate,
      quantity: input.quantity,
      supplierWallet,
      unit: input.unit,
    };
  }

  private requireMatchingWorkflow(
    record: IngredientBatchWorkflowRecord,
    input: ReturnType<IngredientBatchService['issueInput']>,
    metadataHash: string,
  ) {
    if (
      record.metadataHash.toLowerCase() !== metadataHash.toLowerCase() ||
      getAddress(record.supplierWallet) !== getAddress(input.supplierWallet)
    ) {
      throw new IngredientBatchApiError(
        'WORKFLOW_CONFLICT',
        'This batch ID already has a different registration workflow.',
        409,
      );
    }
  }

  private verifyCredentialRecord(
    credential: NonNullable<Awaited<ReturnType<IngredientBatchGateway['getCredential']>>>,
    record: IngredientBatchWorkflowRecord,
  ) {
    if (
      credential.status !== 1 ||
      credential.credentialType !== 2 ||
      credential.credentialHash.toLowerCase() !== record.credentialHash.toLowerCase() ||
      credential.encryptedCid !== record.encryptedCid ||
      getAddress(credential.subject) !== getAddress(record.supplierWallet) ||
      getAddress(credential.issuer) !== getAddress(record.supplierWallet) ||
      credential.expiresAt !== record.expiresAt
    ) {
      throw new IngredientBatchApiError(
        'CREDENTIAL_RECORD_MISMATCH',
        'The on-chain Ingredient Credential does not match this workflow.',
        409,
      );
    }
  }

  private verifyBatchRecord(
    batch: NonNullable<Awaited<ReturnType<IngredientBatchGateway['getBatch']>>>,
    record: IngredientBatchWorkflowRecord,
  ) {
    if (
      batch.status !== 1 ||
      getAddress(batch.supplier) !== getAddress(record.supplierWallet) ||
      batch.credentialId.toLowerCase() !== record.credentialId.toLowerCase() ||
      batch.metadataHash.toLowerCase() !== record.metadataHash.toLowerCase() ||
      batch.encryptedCid !== record.encryptedCid ||
      batch.totalQuantity !== record.quantity ||
      batch.producedAt !== record.producedAt ||
      batch.expiresAt !== record.expiresAt ||
      decodeUnit(batch.unit) !== record.unit
    ) {
      throw new IngredientBatchApiError(
        'BATCH_RECORD_MISMATCH',
        'The on-chain ingredient batch does not match this workflow.',
        409,
      );
    }
  }

  private async safeGateway<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof IngredientBatchApiError) throw error;
      throw new IngredientBatchApiError(
        'INGREDIENT_BLOCKCHAIN_UNAVAILABLE',
        'The ingredient blockchain service is unavailable.',
        503,
      );
    }
  }
}

function decodeUnit(value: string) {
  try {
    return decodeBytes32String(value);
  } catch {
    return value;
  }
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}
