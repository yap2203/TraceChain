import {
  certificationUploadSchema,
  decodeCertificationFile,
  validateCertificationStructure,
} from './certification-documents.js';
import {
  ingredientDetailClaims,
  visibleIngredientClaims,
  type CertificationDocument,
} from '@tracechain/shared';
import { createHash, randomUUID } from 'node:crypto';

import {
  canonicalIngredientMetadata,
  walletAddressToDid,
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
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(private readonly dependencies: Dependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async requireSupplierDocumentAccess(sessionId: string | undefined) {
    const session = await this.requireSupplier(sessionId);
    const supplierWallet = getAddress(session.address);
    await this.requireChainAuthorization(
      supplierWallet,
      session.onChainAuthorization!.credentialHash!,
    );
    return { supplierWallet };
  }

  async prepare(
    sessionId: string | undefined,
    input: IngredientBatchRequest,
  ): Promise<Awaited<ReturnType<IngredientBatchService['workflowResponse']>>> {
    const key = id(input.batchReference);
    const previous = this.pending.get(key);
    if (previous) {
      await previous;
      return this.prepare(sessionId, input);
    }
    const operation = this.prepareOnce(sessionId, input);
    this.pending.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    }
  }
  private async prepareOnce(sessionId: string | undefined, input: IngredientBatchRequest) {
    const { supplierWallet } = await this.requireSupplierDocumentAccess(sessionId);

    await this.verifyAttachments(input, supplierWallet);
    const normalized = this.issueInput(input, supplierWallet);
    const batchId = id(input.batchReference);
    const canonicalMetadata = canonicalIngredientMetadata(normalized);
    const metadataHash = `0x${createHash('sha256').update(canonicalMetadata).digest('hex')}`;
    let record = await this.dependencies.repository.find(batchId);
    const agent = await this.dependencies.agentProvider();

    if (record) {
      await this.requireMatchingWorkflow(record, normalized, metadataHash, canonicalMetadata);
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

  async uploadCertificationDocument(
    sessionId: string | undefined,
    raw: unknown,
  ): Promise<CertificationDocument> {
    const file = certificationUploadSchema.parse(raw),
      key = 'file:' + file.id;
    const previous = this.pending.get(key);
    if (previous) {
      await previous;
      return this.uploadCertificationDocument(sessionId, raw);
    }
    const operation = this.uploadDocumentOnce(sessionId, raw);
    this.pending.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    }
  }
  private async uploadDocumentOnce(sessionId: string | undefined, raw: unknown) {
    const { supplierWallet } = await this.requireSupplierDocumentAccess(sessionId);
    const file = certificationUploadSchema.parse(raw),
      repo = this.dependencies.repository;
    if (!repo.findAttachment || !repo.saveAttachment)
      throw new IngredientBatchApiError(
        'DOCUMENT_STORAGE_UNAVAILABLE',
        'Document storage is not available.',
        503,
      );
    const { bytes, sha256 } = decodeCertificationFile(file);
    const old = await repo.findAttachment(file.id);
    if (!old)
      try {
        await validateCertificationStructure(bytes, file.mimeType);
      } catch {
        throw new IngredientBatchApiError(
          'DOCUMENT_INVALID',
          'The document could not be parsed safely. Use a readable PDF within the project page limit, PNG or JPEG.',
          400,
        );
      }
    if (
      old &&
      (old.supplierWallet !== supplierWallet ||
        old.operationId !== file.operationId ||
        old.certificationId !== file.certificationId ||
        old.sha256 !== sha256)
    )
      throw new IngredientBatchApiError(
        'DOCUMENT_CONFLICT',
        'This document ID is already bound to different content.',
        409,
      );
    const stored =
      old ??
      (await (async () => {
        const encrypted = await this.dependencies.contentStore
          .encryptAndStore(JSON.stringify(file), file.id)
          .catch(() => {
            throw new IngredientBatchApiError(
              'DOCUMENT_STORAGE_UNAVAILABLE',
              'Encrypted document upload failed. Retry this file; no credential was issued.',
              503,
            );
          });
        const record = {
          id: file.id,
          operationId: file.operationId,
          certificationId: file.certificationId,
          supplierWallet,
          sha256,
          cid: encrypted.cid,
          payload: encrypted.payload,
        };
        await repo.saveAttachment!(record);
        return record;
      })());
    return {
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: bytes.length,
      sha256,
      cid: stored.cid,
    };
  }
  private async verifyAttachments(input: IngredientBatchRequest, wallet: string) {
    for (const entry of input.certificationEntries ?? [])
      for (const file of entry.documents) {
        const stored = await this.dependencies.repository.findAttachment?.(file.id);
        if (
          !stored ||
          stored.supplierWallet !== wallet ||
          stored.operationId !== input.operationId ||
          stored.certificationId !== entry.id ||
          stored.sha256 !== file.sha256 ||
          stored.cid !== file.cid
        )
          throw new IngredientBatchApiError(
            'DOCUMENT_BINDING_MISMATCH',
            'Upload each certification document for this exact entry and operation before issuing.',
            409,
          );
        const original = JSON.parse(await this.dependencies.contentStore.decrypt(stored.payload));
        if (
          decodeCertificationFile(original).sha256 !== file.sha256 ||
          original.fileName !== file.fileName ||
          original.mimeType !== file.mimeType ||
          Buffer.from(original.data, 'base64').length !== file.size
        )
          throw new IngredientBatchApiError(
            'DOCUMENT_HASH_MISMATCH',
            'The document reference does not match its stored content.',
            409,
          );
      }
  }
  async certificationDocument(sessionId: string | undefined, batchId: string, documentId: string) {
    const { supplierWallet } = await this.requireSupplierDocumentAccess(sessionId);
    const batch = await this.dependencies.repository.find(batchId);
    const file = await this.dependencies.repository.findAttachment?.(documentId);
    if (
      !batch ||
      batch.supplierWallet !== supplierWallet ||
      !batch.certificationDocumentIds?.includes(documentId) ||
      !file ||
      file.supplierWallet !== supplierWallet
    )
      throw new IngredientBatchApiError(
        'DOCUMENT_ACCESS_DENIED',
        'This certification document is not available to your company.',
        403,
      );
    let value;
    try {
      value = JSON.parse(await this.dependencies.contentStore.decrypt(file.payload));
    } catch {
      throw new IngredientBatchApiError(
        'DOCUMENT_RETRIEVAL_UNAVAILABLE',
        'The encrypted document is temporarily unavailable. Retry when the service is restored.',
        503,
      );
    }
    let actualHash;
    try {
      actualHash = decodeCertificationFile(value).sha256;
    } catch {
      actualHash = 'invalid';
    }
    if (actualHash !== file.sha256)
      throw new IngredientBatchApiError(
        'DOCUMENT_HASH_MISMATCH',
        'Document integrity check failed.',
        409,
      );
    return { fileName: value.fileName, mimeType: value.mimeType, data: value.data };
  }
  async drafts(sessionId: string | undefined) {
    const { supplierWallet } = await this.requireSupplierDocumentAccess(sessionId);
    const records = await this.dependencies.repository.listForSupplier(supplierWallet),
      workflows = [];
    for (const record of records) {
      if (
        record.supplierWallet.toLowerCase() !== supplierWallet.toLowerCase() ||
        (await this.safeGateway(() => this.dependencies.gateway.getBatch(record.batchId)))
      )
        continue;
      const envelope = JSON.parse(
        await this.dependencies.contentStore.decrypt(record.encryptedPayload),
      );
      if (
        !envelope.metadata ||
        `0x${createHash('sha256').update(JSON.stringify(envelope.metadata)).digest('hex')}` !==
          record.metadataHash
      )
        throw new IngredientBatchApiError(
          'WORKFLOW_INTEGRITY_FAILED',
          'A stored registration could not be verified.',
          409,
        );
      const {
        batchId,
        supplierWallet: _wallet,
        ...metadata
      } = visibleIngredientClaims(envelope.metadata);
      workflows.push({
        batchId: record.batchId,
        input: {
          ...metadata,
          batchReference: batchId,
          ...(record.operationId ? { operationId: record.operationId } : {}),
        },
      });
    }
    return { workflows };
  }
  async list(sessionId: string | undefined) {
    const { supplierWallet } = await this.requireSupplierDocumentAccess(sessionId);
    const batchIds = await this.safeGateway(() =>
      this.dependencies.gateway.listBatchIds(supplierWallet),
    );
    const batches = await Promise.all(
      batchIds.map(async (batchId) => {
        const batch = await this.safeGateway(() => this.dependencies.gateway.getBatch(batchId));
        if (!batch || getAddress(batch.supplier) !== supplierWallet) return null;
        const record = await this.dependencies.repository.find(batchId);
        let metadata: Record<string, unknown> = {};
        if (
          record &&
          getAddress(record.supplierWallet) === supplierWallet &&
          record.metadataHash.toLowerCase() === batch.metadataHash.toLowerCase() &&
          record.credentialId.toLowerCase() === batch.credentialId.toLowerCase() &&
          record.encryptedCid === batch.encryptedCid
        ) {
          try {
            const envelope = JSON.parse(
              await this.dependencies.contentStore.decrypt(record.encryptedPayload),
            ) as { metadata?: Record<string, unknown> };
            metadata = visibleIngredientClaims(envelope.metadata ?? {});
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
          originDetails:
            metadata.originDetails && typeof metadata.originDetails === 'object'
              ? metadata.originDetails
              : undefined,
          allergen: metadata.allergen,
          certificationEntries: metadata.certificationEntries,
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
      const credentialUrn = `urn:tracechain:ingredient:${batchId}`;
      const sdJwt = await issueIngredientSdJwt(agent, {
        claims: {
          policyVersion: 2,
          supplierDid: walletAddressToDid(input.supplierWallet),
          allergenDeclaration: input.allergenInformation || undefined,
          ...ingredientDetailClaims(
            input.originDetails,
            input.allergen,
            input.certificationEntries,
          ),
          batchId,
          batchReference: input.batchId,
          certificationDetails: input.certifications.length ? input.certifications : undefined,
          countryOfOrigin: input.originDetails?.countryName ?? input.origin,
          credentialId: credentialUrn,
          expiryDate: input.expiryDate.toISOString(),
          ingredientName: input.ingredientName,
          category: input.category,
          quantity: input.quantity,
          unit: input.unit,
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
        operationId: input.operationId,
        certificationDocumentIds: (input.certificationEntries ?? []).flatMap((entry) =>
          entry.documents.map((file) => file.id),
        ),
        ...(input.price !== undefined
          ? { price: input.price, currency: input.currency, priceBasis: input.priceBasis }
          : {}),
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
      operationId: input.operationId,
      certificationDocumentIds: (input.certificationEntries ?? []).flatMap((entry) =>
        entry.documents.map((file) => file.id),
      ),
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
      ...(input.price !== undefined ? { price: input.price, currency: input.currency } : {}),
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
      operationId: input.operationId,
      ...(input.originDetails ? { originDetails: input.originDetails } : {}),
      ...(input.allergen ? { allergen: input.allergen } : {}),
      ...(input.certificationEntries ? { certificationEntries: input.certificationEntries } : {}),
      ...(input.priceBasis ? { priceBasis: input.priceBasis } : {}),
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
      ...(input.price !== undefined ? { price: input.price, currency: input.currency } : {}),
    };
  }

  private async requireMatchingWorkflow(
    record: IngredientBatchWorkflowRecord,
    input: ReturnType<IngredientBatchService['issueInput']>,
    metadataHash: string,
    canonicalMetadata: string,
  ) {
    const sameSupplier = getAddress(record.supplierWallet) === getAddress(input.supplierWallet);
    if (sameSupplier && record.metadataHash.toLowerCase() === metadataHash.toLowerCase()) return;
    if (sameSupplier) {
      try {
        const envelope = JSON.parse(
          await this.dependencies.contentStore.decrypt(record.encryptedPayload),
        ) as { metadata?: Record<string, unknown> };
        const stored = envelope.metadata;
        if (
          stored &&
          `0x${createHash('sha256').update(JSON.stringify(stored)).digest('hex')}`.toLowerCase() ===
            record.metadataHash.toLowerCase() &&
          stableJson(visibleIngredientClaims(stored)) ===
            stableJson(visibleIngredientClaims(JSON.parse(canonicalMetadata)))
        )
          return;
      } catch {
        // Fail closed below. Legacy retry compatibility never bypasses integrity checks.
      }
    }
    throw new IngredientBatchApiError(
      'WORKFLOW_CONFLICT',
      'This batch ID already has a different registration workflow.',
      409,
    );
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(',')}}`;
}
