import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CompanyRole } from '@tracechain/shared';
import { Interface, id, encodeBytes32String } from 'ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ssiMocks = vi.hoisted(() => ({
  createPresentation: vi.fn(),
  parseCredential: vi.fn(),
  safeParseCredential: vi.fn(),
  verifyCredential: vi.fn(),
  verifyPresentation: vi.fn(),
}));
vi.mock('@tracechain/ssi', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tracechain/ssi')>();
  return {
    ...original,
    createIngredientEvidencePresentation: ssiMocks.createPresentation,
    ingredientCredentialSchema: {
      parse: ssiMocks.parseCredential,
      safeParse: ssiMocks.safeParseCredential,
    },
    verifyIngredientCredential: ssiMocks.verifyCredential,
    verifyIngredientEvidencePresentation: ssiMocks.verifyPresentation,
  };
});

import type { AuthService } from '../auth/auth.service.js';
import type { SessionRecord } from '../auth/auth.types.js';
import type { IngredientBatchWorkflowRepository } from '../ingredient-batches/ingredient-batch.repository.js';
import type { EncryptedCredentialPayload } from '../ssi/encrypted-credential.store.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import {
  EthersProductionFlowGateway,
  type ProductionFlowGateway,
} from './production-flow.gateway.js';
import {
  JsonProductionFlowRepository,
  ProductionFlowPersistenceError,
  type EvidenceWorkflowRecord,
  type ProductionFlowRepository,
} from './production-flow.repository.js';
import { ProductionFlowService } from './production-flow.service.js';

const NOW = new Date('2026-11-06T08:00:00.000Z');
const MANUFACTURER = '0x3000000000000000000000000000000000000003';
const SUPPLIER = '0x2000000000000000000000000000000000000002';
const DISTRIBUTOR = '0x4000000000000000000000000000000000000004';
const RETAILER = '0x5000000000000000000000000000000000000005';
const BATCH_ID = `0x${'11'.repeat(32)}`;
const PRODUCT_ID = `0x${'22'.repeat(32)}`;
const CREDENTIAL_ID = `0x${'33'.repeat(32)}`;
const ADDRESSES = {
  stakeholder: '0x1000000000000000000000000000000000000001',
  credential: '0x5000000000000000000000000000000000000005',
  ingredient: '0x6000000000000000000000000000000000000006',
  evidence: '0x7000000000000000000000000000000000000007',
  product: '0x8000000000000000000000000000000000000008',
  custody: '0x9000000000000000000000000000000000000009',
};
const PAYLOAD: EncryptedCredentialPayload = {
  algorithm: 'aes-256-gcm',
  authTag: 'tag',
  ciphertext: 'ciphertext',
  iv: 'iv',
  version: 1,
};

describe('production flow service', () => {
  let evidence = new Map<string, EvidenceWorkflowRecord>();
  let gateway: ProductionFlowGateway;
  let repository: ProductionFlowRepository;
  let service: ProductionFlowService;
  let encryptedWrites: string[];

  beforeEach(() => {
    evidence = new Map();
    encryptedWrites = [];
    ssiMocks.createPresentation.mockResolvedValue({
      holder: 'did:example:supplier',
      proof: { jwt: 'presentation.jwt.value' },
      verifiableCredential: [],
    });
    ssiMocks.parseCredential.mockImplementation((value) => value);
    ssiMocks.safeParseCredential.mockImplementation((value) => ({ data: value, success: true }));
    ssiMocks.verifyCredential.mockResolvedValue({
      credentialHash: 'aa'.repeat(32),
      reasons: [],
      verified: true,
    });
    ssiMocks.verifyPresentation.mockResolvedValue({
      credential: { credentialSubject: { batchId: 'COCOA-001' }, id: 'urn:credential:1' },
      credentialHash: 'aa'.repeat(32),
      reasons: [],
      verified: true,
    });
    const prepared = {
      chainId: 31_337,
      data: '0x1234',
      to: ADDRESSES.evidence,
      value: '0x0' as const,
    };
    gateway = {
      assertDeployment: vi.fn().mockResolvedValue(undefined),
      getAccess: vi.fn().mockResolvedValue(true),
      getAccepted: vi.fn().mockResolvedValue(false),
      getCredential: vi.fn().mockResolvedValue({
        credentialHash: `0x${'44'.repeat(32)}`,
        credentialType: 2,
        expiresAt: 1_900_000_000,
        issuer: SUPPLIER,
        status: 1,
        subject: SUPPLIER,
      }),
      getEvidenceRequest: vi.fn().mockResolvedValue(null),
      getIngredient: vi.fn().mockResolvedValue({
        availableQuantity: '500',
        credentialId: CREDENTIAL_ID,
        encryptedCid: 'bafy',
        expiresAt: 1_900_000_000,
        metadataHash: `0x${'55'.repeat(32)}`,
        producedAt: 1_790_000_000,
        status: 1,
        supplier: SUPPLIER,
        totalQuantity: '500',
        unit: `0x${'00'.repeat(32)}`,
      }),
      getInventory: vi
        .fn()
        .mockResolvedValue({ available: '0', initialized: false, reserved: '0' }),
      getProduct: vi.fn().mockResolvedValue(null),
      getProductLinks: vi.fn().mockResolvedValue([]),
      getTransfer: vi.fn().mockResolvedValue(null),
      hasPermission: vi.fn().mockResolvedValue(true),
      isRoleAuthorized: vi.fn().mockResolvedValue(true),
      isTransferable: vi.fn().mockResolvedValue(true),
      listActiveDistributors: vi.fn().mockResolvedValue([DISTRIBUTOR]),
      listActiveRetailers: vi.fn().mockResolvedValue([RETAILER]),
      listReceivedProductBatchIds: vi.fn().mockResolvedValue([]),
      listEvidenceRequestIds: vi.fn().mockResolvedValue([]),
      listIngredients: vi.fn().mockResolvedValue([]),
      prepareAccept: vi.fn().mockReturnValue(prepared),
      prepareEvidenceRequest: vi.fn().mockReturnValue(prepared),
      prepareEvidenceResponse: vi.fn().mockReturnValue(prepared),
      prepareProduct: vi.fn().mockReturnValue({ ...prepared, to: ADDRESSES.product }),
      prepareTransfer: vi.fn().mockReturnValue({ ...prepared, to: ADDRESSES.custody }),
    };
    repository = {
      findEvidence: async (requestId) => evidence.get(requestId.toLowerCase()),
      findEvidenceByOperation: async (operationId, requester) =>
        [...evidence.values()].find(
          (record) => record.operationId === operationId && record.requester === requester,
        ),
      findPrivate: vi.fn().mockResolvedValue(undefined),
      saveEvidence: async (record) => {
        evidence.set(record.requestId.toLowerCase(), record);
      },
      savePrivate: vi.fn().mockResolvedValue(undefined),
    };
    service = createService(gateway, repository, manufacturerAuth(), encryptedWrites);
  });

  it('rejects a wrong Company Role and a wallet that is no longer authorized on chain', async () => {
    const wrongRole = createService(gateway, repository, supplierAuth(), encryptedWrites);
    await expect(wrongRole.prepareEvidenceRequest('session', requestInput())).rejects.toMatchObject(
      { code: 'ROLE_AUTHORIZATION_REQUIRED', status: 403 },
    );
    vi.mocked(gateway.getAccess).mockResolvedValue(false);
    await expect(service.prepareEvidenceRequest('session', requestInput())).rejects.toMatchObject({
      code: 'ROLE_AUTHORIZATION_REQUIRED',
      status: 403,
    });
  });

  it('creates one encrypted, challenge-bound evidence request and reuses it on retry', async () => {
    const first = await service.prepareEvidenceRequest('session', requestInput());
    const second = await service.prepareEvidenceRequest('session', requestInput());
    expect(first.requestId).toBe(second.requestId);
    expect(encryptedWrites).toHaveLength(1);
    expect(gateway.prepareEvidenceRequest).toHaveBeenCalledTimes(2);
    const prepared = vi.mocked(gateway.prepareEvidenceRequest).mock.calls[0]?.[0];
    expect(prepared?.challengeHash).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(prepared?.claimsHash).toMatch(/^0x[0-9a-f]{64}$/i);
  });
  it('reads only the authenticated Manufacturer stock at the selected location and decodes the registered unit', async () => {
    const batch = await gateway.getIngredient(BATCH_ID);
    vi.mocked(gateway.listIngredients).mockResolvedValue([
      { ...batch!, batchId: BATCH_ID, unit: encodeBytes32String('g') },
    ]);
    vi.mocked(gateway.getAccepted).mockResolvedValue(true);
    gateway.getReceivedAvailable = vi.fn().mockResolvedValue('875');
    const location = id('factory');
    const result = await service.listIngredients('session', location);
    expect(gateway.getReceivedAvailable).toHaveBeenCalledWith(BATCH_ID, MANUFACTURER, location);
    expect(result.batches[0]).toMatchObject({
      availableQuantity: '875',
      unit: 'g',
      accepted: true,
    });
  });
  it('rejects duplicate ingredient IDs and checks each received balance independently', async () => {
    const input = productInput();
    await expect(
      service.prepareProduct('session', {
        ...input,
        ingredientLinks: [...input.ingredientLinks, ...input.ingredientLinks],
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_INGREDIENT' });
    vi.mocked(gateway.getAccepted).mockResolvedValue(true);
    gateway.getReceivedAvailable = vi.fn().mockResolvedValue('499');
    await expect(
      service.prepareProduct('session', { ...input, productionLocation: id('factory') }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_INGREDIENT_QUANTITY' });
    expect(gateway.prepareProduct).not.toHaveBeenCalled();
  });
  it('resolves messaging participants only from a matching live chain request, not stale workflow storage', async () => {
    const prepared = await service.prepareEvidenceRequest('session', requestInput());
    const workflow = evidence.get(prepared.requestId!.toLowerCase())!;
    await expect(
      service.resolveEvidenceMessagingParticipants(prepared.requestId!),
    ).resolves.toBeUndefined();
    const chain = {
      challengeHash: workflow.challengeHash,
      claimsHash: workflow.claimsHash,
      dueAt: workflow.dueAt,
      ingredientBatchId: workflow.batchId,
      presentationCid: '',
      presentationExpiresAt: 0,
      presentationHash: id('none'),
      requestCid: workflow.requestCid,
      requester: workflow.requester,
      supplier: workflow.supplier,
      status: 1,
      updatedAt: 0,
    };
    vi.mocked(gateway.getEvidenceRequest).mockResolvedValue(chain);
    await expect(
      service.resolveEvidenceMessagingParticipants(prepared.requestId!),
    ).resolves.toEqual({
      requester: workflow.requester,
      supplier: workflow.supplier,
      identityRequestAllowed: false,
    });
    workflow.identityProof = {
      audience: workflow.supplier,
      challenge: 'fresh-challenge',
      expiresAt: Math.floor(NOW.getTime() / 1000) + 900,
      presenterRole: 'MANUFACTURER',
      presenterWallet: workflow.requester,
      purpose: 'Company evidence',
      status: 'REQUESTED',
    };
    await expect(
      service.resolveEvidenceMessagingParticipants(prepared.requestId!),
    ).resolves.toMatchObject({ identityRequestAllowed: true });
    const supplierService = createService(gateway, repository, supplierAuth(), encryptedWrites);
    await supplierService.requestCompanyIdentityProof('session', prepared.requestId!);
    await supplierService.requestCompanyIdentityProof('session', prepared.requestId!);
    expect(workflow.identityProof.challenge).toBe('fresh-challenge');
    expect(workflow.identityProof.expiresAt).toBe(Math.floor(NOW.getTime() / 1000) + 900);
    vi.mocked(gateway.getEvidenceRequest).mockResolvedValue({ ...chain, requester: RETAILER });
    await expect(service.resolveEvidenceMessagingParticipants(prepared.requestId!)).rejects.toThrow(
      'Evidence request record mismatch',
    );
    vi.mocked(gateway.getEvidenceRequest).mockResolvedValue({ ...chain, status: 6 });
    await expect(
      service.resolveEvidenceMessagingParticipants(prepared.requestId!),
    ).resolves.toBeUndefined();
    vi.mocked(gateway.getEvidenceRequest).mockResolvedValue({ ...chain, dueAt: 1 });
    await expect(
      service.resolveEvidenceMessagingParticipants(prepared.requestId!),
    ).resolves.toBeUndefined();
  });
  it('lets a Retailer request details of an active registered product before ordering without returning private claims', async () => {
    const retailer = createService(gateway, repository, retailerAuth(), encryptedWrites);
    vi.mocked(gateway.listReceivedProductBatchIds).mockResolvedValue([]);
    vi.mocked(gateway.getProduct).mockResolvedValue({
      manufacturer: MANUFACTURER,
      status: 1,
      expiresAt: Math.floor(NOW.getTime() / 1000) + 86400,
    } as any);
    vi.mocked(gateway.getProductLinks).mockResolvedValue([{ batchId: BATCH_ID, quantity: '1' }]);
    vi.mocked(gateway.isRoleAuthorized).mockResolvedValue(true);
    const input = { ...requestInput(), productBatchId: id('browse-product') };
    const result = await retailer.prepareEvidenceRequest('session', input);
    expect(result.requestId).toBeTruthy();
    expect(result).not.toHaveProperty('credential');
    expect(result).not.toHaveProperty('presentation');
    vi.mocked(gateway.getProductLinks).mockResolvedValue([]);
    await expect(
      retailer.prepareEvidenceRequest('session', {
        ...input,
        operationId: '88888888-8888-4888-8888-888888888888',
      }),
    ).rejects.toMatchObject({ code: 'INGREDIENT_NOT_LINKED' });
  });

  it('rejects an expired evidence request before preparing a Supplier response', async () => {
    const input = requestInput();
    const result = await service.prepareEvidenceRequest('session', input);
    vi.mocked(gateway.getEvidenceRequest).mockResolvedValue({
      challengeHash: `0x${'66'.repeat(32)}`,
      claimsHash: `0x${'77'.repeat(32)}`,
      dueAt: Math.floor(NOW.getTime() / 1000) - 1,
      ingredientBatchId: BATCH_ID,
      presentationCid: '',
      presentationExpiresAt: 0,
      presentationHash: `0x${'00'.repeat(32)}`,
      requestCid: 'bafy',
      requester: MANUFACTURER,
      status: 1,
      supplier: SUPPLIER,
      updatedAt: 0,
    });
    const supplierService = createService(gateway, repository, supplierAuth(), encryptedWrites);
    await expect(
      supplierService.prepareEvidenceResponse('session', result.requestId!),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_RESPONDABLE', status: 409 });
  });

  it('completes request, response, and acceptance only from the server-held credential and matching presentation', async () => {
    const operationId = '22222222-2222-4222-8222-222222222222';
    const requestId = id(`${operationId}:${MANUFACTURER}`);
    const ingredientBatchId = id('COCOA-001');
    const dueAt = Math.floor(new Date('2026-11-10').getTime() / 1000);
    const issuedAt = Math.floor(NOW.getTime() / 1000);
    const challenge = boundChallenge({
      batchId: ingredientBatchId,
      dueAt,
      issuedAt,
      purpose: 'Product traceability',
      requestId,
      requesterWallet: MANUFACTURER,
      supplierWallet: SUPPLIER,
      verifierWallet: MANUFACTURER,
    });
    const ingredientRecord = {
      batchId: ingredientBatchId,
      credentialHash: `0x${'aa'.repeat(32)}`,
      credentialId: id('urn:credential:1'),
      encryptedCid: 'bafy-ingredient',
      encryptedPayload: { ...PAYLOAD, ciphertext: 'ingredient' },
      expiresAt: 1_900_000_000,
      issuerDid: 'did:example:supplier',
      metadataHash: `0x${'bb'.repeat(32)}`,
      producedAt: 1_790_000_000,
      quantity: '500',
      supplierWallet: SUPPLIER,
      unit: 'kg',
    };
    const workflow: EvidenceWorkflowRecord = {
      batchId: ingredientBatchId,
      challengeHash: id(challenge),
      claimsHash: `0x${'cc'.repeat(32)}`,
      dueAt,
      operationId,
      requestCid: 'bafy-request',
      requestId,
      requestPayload: { ...PAYLOAD, ciphertext: 'request' },
      requester: MANUFACTURER,
      supplier: SUPPLIER,
    };
    evidence.set(requestId.toLowerCase(), workflow);
    vi.mocked(gateway.getIngredient).mockResolvedValue({
      availableQuantity: '500',
      credentialId: ingredientRecord.credentialId,
      encryptedCid: 'bafy-ingredient',
      expiresAt: 1_900_000_000,
      metadataHash: ingredientRecord.metadataHash,
      producedAt: 1_790_000_000,
      status: 1,
      supplier: SUPPLIER,
      totalQuantity: '500',
      unit: `0x${'00'.repeat(32)}`,
    });
    vi.mocked(gateway.getEvidenceRequest).mockResolvedValue({
      challengeHash: workflow.challengeHash,
      claimsHash: workflow.claimsHash,
      dueAt: workflow.dueAt,
      ingredientBatchId,
      presentationCid: '',
      presentationExpiresAt: 0,
      presentationHash: `0x${'00'.repeat(32)}`,
      requestCid: workflow.requestCid,
      requester: MANUFACTURER,
      status: 1,
      supplier: SUPPLIER,
      updatedAt: 0,
    });
    const serializedByPayload = new Map<string, string>([
      [
        'ingredient',
        JSON.stringify({
          credential: { credentialSubject: { batchId: 'COCOA-001' }, id: 'urn:credential:1' },
        }),
      ],
      [
        'request',
        JSON.stringify({
          batchId: ingredientBatchId,
          challenge,
          dueAt,
          issuedAt,
          reason: 'Product traceability',
          requestId,
          requester: MANUFACTURER,
          requesterRole: CompanyRole.MANUFACTURER,
          supplier: SUPPLIER,
        }),
      ],
    ]);
    const contentStore = {
      decrypt: async (payload: EncryptedCredentialPayload) =>
        serializedByPayload.get(payload.ciphertext) ?? JSON.stringify({ proof: { jwt: 'vp' } }),
      encryptAndStore: async (value: string) => {
        serializedByPayload.set('presentation', value);
        return { cid: 'bafy-presentation', payload: { ...PAYLOAD, ciphertext: 'presentation' } };
      },
    };
    const ingredientRepository: IngredientBatchWorkflowRepository = {
      find: vi.fn().mockResolvedValue(ingredientRecord),
      listForSupplier: vi.fn().mockResolvedValue([ingredientRecord]),
      save: vi.fn(),
    };
    const supplierService = new ProductionFlowService({
      agentProvider: vi.fn().mockResolvedValue({}),
      authService: supplierAuth(),
      clock: () => NOW,
      contentStore,
      gateway,
      ingredientRepository,
      repository,
    });
    ssiMocks.createPresentation.mockResolvedValueOnce({
      expirationDate: '2026-11-08T00:00:00.000Z',
      holder: ingredientRecord.issuerDid,
      proof: { jwt: 'presentation.jwt.value' },
      verifiableCredential: [
        {
          credentialSubject: {
            allergenInformation: 'May contain soy',
            batchId: 'COCOA-001',
            category: 'Cocoa',
            certifications: ['Organic'],
            expiryDate: '2027-01-01T00:00:00.000Z',
            ingredientName: 'Cocoa powder',
            origin: 'Malaysia',
            productionDate: '2026-10-01T00:00:00.000Z',
            quantity: '500',
            unit: 'kg',
          },
          expirationDate: '2027-01-01T00:00:00.000Z',
          id: 'urn:credential:1',
        },
      ],
    });
    const response = await supplierService.prepareEvidenceResponse('session', requestId);
    expect(response.state).toBe('TRANSACTION_REQUIRED');
    const saved = evidence.get(requestId.toLowerCase())!;
    expect(saved.response?.credentialId).toBe(ingredientRecord.credentialId);

    vi.mocked(gateway.getEvidenceRequest).mockResolvedValue({
      challengeHash: workflow.challengeHash,
      claimsHash: workflow.claimsHash,
      dueAt: workflow.dueAt,
      ingredientBatchId,
      presentationCid: saved.response!.presentationCid,
      presentationExpiresAt: saved.response!.presentationExpiresAt,
      presentationHash: saved.response!.presentationHash,
      requestCid: workflow.requestCid,
      requester: MANUFACTURER,
      status: 2,
      supplier: SUPPLIER,
      updatedAt: 0,
    });
    vi.mocked(gateway.getCredential).mockResolvedValue({
      credentialHash: ingredientRecord.credentialHash,
      credentialType: 2,
      expiresAt: ingredientRecord.expiresAt,
      issuer: SUPPLIER,
      status: 1,
      subject: SUPPLIER,
    });
    const manufacturerService = new ProductionFlowService({
      agentProvider: vi.fn().mockResolvedValue({}),
      authService: manufacturerAuth(),
      clock: () => NOW,
      contentStore,
      gateway,
      ingredientRepository,
      repository,
    });
    const review = await manufacturerService.reviewEvidence('session', requestId);
    expect(review).toMatchObject({
      disclosure: 'FULL_INGREDIENT_CREDENTIAL',
      sharedClaims: { ingredientName: 'Cocoa powder', origin: 'Malaysia' },
      verification: { state: 'NOT_VERIFIED' },
    });
    const verification = await manufacturerService.verifyEvidence('session', requestId);
    expect(verification.checks.every((check) => check.passed)).toBe(true);
    await expect(manufacturerService.reviewEvidence('session', requestId)).resolves.toMatchObject({
      verification: { state: 'PASSED', verifiedAt: NOW.toISOString() },
    });
    const acceptance = await manufacturerService.prepareEvidenceAcceptance('session', requestId);
    expect(acceptance.state).toBe('TRANSACTION_REQUIRED');
    expect(gateway.prepareAccept).toHaveBeenCalledWith(requestId, ingredientRecord.credentialId);

    ssiMocks.verifyPresentation.mockResolvedValueOnce({
      credential: { credentialSubject: { batchId: 'OTHER-BATCH' }, id: 'urn:credential:1' },
      credentialHash: 'aa'.repeat(32),
      reasons: [],
      verified: true,
    });
    await expect(
      manufacturerService.prepareEvidenceAcceptance('session', requestId),
    ).rejects.toMatchObject({ code: 'ON_CHAIN_RECORD_MISMATCH', status: 409 });
    vi.mocked(gateway.getCredential).mockResolvedValueOnce({
      credentialHash: ingredientRecord.credentialHash,
      credentialType: 2,
      expiresAt: ingredientRecord.expiresAt,
      issuer: SUPPLIER,
      status: 2,
      subject: SUPPLIER,
    });
    await expect(
      manufacturerService.prepareEvidenceAcceptance('session', requestId),
    ).rejects.toMatchObject({ code: 'INGREDIENT_CREDENTIAL_INACTIVE', status: 409 });

    for (const invalidCredential of [
      { status: 3 },
      { credentialType: 1 },
      { subject: RETAILER },
      { issuer: RETAILER },
      { credentialHash: `0x${'99'.repeat(32)}` },
      { expiresAt: Math.floor(NOW.getTime() / 1_000) },
    ]) {
      vi.mocked(gateway.getCredential).mockResolvedValueOnce({
        credentialHash: ingredientRecord.credentialHash,
        credentialType: 2,
        expiresAt: ingredientRecord.expiresAt,
        issuer: SUPPLIER,
        status: 1,
        subject: SUPPLIER,
        ...invalidCredential,
      });
      await expect(
        manufacturerService.prepareEvidenceAcceptance('session', requestId),
      ).rejects.toMatchObject({ code: 'INGREDIENT_CREDENTIAL_INACTIVE', status: 409 });
    }

    vi.mocked(gateway.getAccepted).mockResolvedValue(true);
    vi.mocked(gateway.getEvidenceRequest).mockResolvedValue({
      ...(await gateway.getEvidenceRequest(requestId))!,
      status: 3,
    });
    const complete = await manufacturerService.prepareEvidenceAcceptance('session', requestId);
    expect(complete.state).toBe('COMPLETE');
  });

  it('treats completed Retailer acceptance as idempotent across an API restart', async () => {
    const requestId = id('retailer-accepted-request');
    evidence.set(requestId.toLowerCase(), {
      batchId: BATCH_ID,
      challengeHash: id('retailer-challenge'),
      claimsHash: id('retailer-claims'),
      dueAt: 1_900_000_000,
      operationId: '77777777-7777-4777-8777-777777777777',
      requestCid: 'bafy-retailer-request',
      requestId,
      requestPayload: PAYLOAD,
      requester: RETAILER,
      supplier: SUPPLIER,
    });
    vi.mocked(gateway.getEvidenceRequest).mockResolvedValue({
      challengeHash: id('retailer-challenge'),
      claimsHash: id('retailer-claims'),
      dueAt: 1_900_000_000,
      ingredientBatchId: BATCH_ID,
      presentationCid: 'bafy-retailer-presentation',
      presentationExpiresAt: 1_900_000_000,
      presentationHash: id('retailer-presentation'),
      requestCid: 'bafy-retailer-request',
      requester: RETAILER,
      status: 3,
      supplier: SUPPLIER,
      updatedAt: 1,
    });
    const contentStore = {
      decrypt: vi.fn().mockResolvedValue(JSON.stringify({ requesterRole: CompanyRole.RETAILER })),
      encryptAndStore: vi.fn(),
    };
    const dependencies = {
      agentProvider: vi.fn(),
      authService: retailerAuth(),
      clock: () => NOW,
      contentStore,
      gateway,
      ingredientRepository: {
        find: vi.fn(),
        listForSupplier: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
      },
      repository,
    };

    await expect(
      new ProductionFlowService(dependencies).prepareEvidenceAcceptance('session', requestId),
    ).resolves.toMatchObject({ state: 'COMPLETE', status: 3 });
    await expect(
      new ProductionFlowService(dependencies).prepareEvidenceAcceptance('session', requestId),
    ).resolves.toMatchObject({ state: 'COMPLETE', status: 3 });
    expect(gateway.getAccepted).not.toHaveBeenCalled();
    expect(gateway.prepareAccept).not.toHaveBeenCalled();
  });

  it('conceals private evidence records from unrelated companies', async () => {
    const requestId = id('private-evidence-request');
    evidence.set(requestId.toLowerCase(), {
      batchId: BATCH_ID,
      challengeHash: id('private-challenge'),
      claimsHash: id('private-claims'),
      dueAt: 1_900_000_000,
      operationId: '88888888-8888-4888-8888-888888888888',
      requestCid: 'bafy-private-request',
      requestId,
      requestPayload: PAYLOAD,
      requester: MANUFACTURER,
      supplier: SUPPLIER,
    });
    const unrelated = createService(
      gateway,
      repository,
      {
        requireSession: vi
          .fn()
          .mockResolvedValue(
            session(CompanyRole.MANUFACTURER, '0x7000000000000000000000000000000000000007'),
          ),
      } as unknown as AuthService,
      encryptedWrites,
    );
    await expect(unrelated.getEvidenceDetails('session', requestId)).rejects.toMatchObject({
      code: 'REQUEST_NOT_FOUND',
      status: 404,
    });
    await expect(unrelated.reviewEvidence('session', requestId)).rejects.toMatchObject({
      code: 'REQUEST_NOT_FOUND',
      status: 404,
    });
  });

  it('keeps the legacy no-receipt-ledger evidence gate for older integrations', async () => {
    await expect(service.prepareProduct('session', productInput())).rejects.toMatchObject({
      code: 'EVIDENCE_NOT_ACCEPTED',
      status: 409,
    });
    vi.mocked(gateway.getAccepted).mockResolvedValue(true);
    const result = await service.prepareProduct('session', productInput());
    expect(result.state).toBe('TRANSACTION_REQUIRED');
    expect(gateway.prepareProduct).toHaveBeenCalledWith(
      expect.objectContaining({ ingredients: [{ batchId: BATCH_ID, quantity: '500' }] }),
    );
  });
  it('lists and produces from received stock without evidence queries or evidence permission', async () => {
    vi.mocked(gateway.getAccess).mockImplementation(
      async (_wallet, _hash, _role, permission) => permission === 'REGISTER_PRODUCT',
    );
    const batch = await gateway.getIngredient(BATCH_ID);
    vi.mocked(gateway.listIngredients).mockResolvedValue([
      { ...batch!, batchId: BATCH_ID, unit: encodeBytes32String('g') },
    ]);
    gateway.getReceivedAvailable = vi.fn().mockResolvedValue('500');
    gateway.supportsOptionalProductionEvidence = vi.fn().mockResolvedValue(true);
    vi.mocked(gateway.getAccepted).mockRejectedValue(
      new Error('Evidence is optional and not loaded'),
    );
    const location = id('factory');
    const result = await service.listIngredients('session', location, 'production');
    expect(result.batches[0].availableQuantity).toBe('500');
    expect(result.batches[0].accepted).toBeUndefined();
    await service.prepareProduct('session', { ...productInput(), productionLocation: location });
    expect(gateway.getAccepted).not.toHaveBeenCalled();
    expect(gateway.prepareProduct).toHaveBeenCalled();
    gateway.supportsOptionalProductionEvidence = vi.fn().mockResolvedValue(false);
    await expect(
      service.prepareProduct('session', { ...productInput(), productionLocation: location }),
    ).rejects.toMatchObject({ code: 'OPTIONAL_EVIDENCE_DEPLOYMENT_REQUIRED' });
  });

  it('validates Distributor role and effective Manufacturer inventory before transfer preparation', async () => {
    vi.mocked(gateway.getProduct).mockResolvedValue({
      expiresAt: 1_900_000_000,
      manufacturer: MANUFACTURER,
      metadataHash: `0x${'88'.repeat(32)}`,
      producedAt: 1_790_000_000,
      publicCid: 'bafy-product',
      status: 1,
      totalQuantity: '500',
      unit: `0x${'00'.repeat(32)}`,
    });
    const result = await service.prepareTransfer('session', transferInput());
    expect(result.state).toBe('TRANSACTION_REQUIRED');
    expect(result.transferId).toMatch(/^0x[0-9a-f]{64}$/i);
    vi.mocked(gateway.isRoleAuthorized).mockResolvedValue(false);
    await expect(service.prepareTransfer('session', transferInput())).rejects.toMatchObject({
      code: 'INVALID_DISTRIBUTOR',
      status: 409,
    });
  });

  it('returns only positive Distributor inventory and resolves active Retailer company names', async () => {
    vi.mocked(gateway.listReceivedProductBatchIds).mockResolvedValue([PRODUCT_ID, BATCH_ID]);
    vi.mocked(gateway.getProduct).mockResolvedValue({
      expiresAt: 1_900_000_000,
      manufacturer: MANUFACTURER,
      metadataHash: `0x${'88'.repeat(32)}`,
      producedAt: 1_790_000_000,
      publicCid: 'bafy-product',
      status: 1,
      totalQuantity: '500',
      unit: `0x${'00'.repeat(32)}`,
    });
    vi.mocked(gateway.getInventory).mockImplementation(async (batchId) => ({
      available: batchId === PRODUCT_ID ? '25' : '0',
      initialized: true,
      reserved: '5',
    }));
    const distributorService = createService(
      gateway,
      repository,
      distributorAuth(),
      encryptedWrites,
      retailerDirectory(),
    );
    await expect(distributorService.listDistributorInventory('session')).resolves.toMatchObject({
      products: [{ availableQuantity: '25', productBatchId: PRODUCT_ID }],
    });
    await expect(distributorService.listRetailers('session')).resolves.toEqual({
      retailers: [
        {
          active: true,
          companyName: 'FreshMart Retail Sdn. Bhd.',
          role: CompanyRole.RETAILER,
          walletAddress: RETAILER,
        },
      ],
    });
  });

  it('rejects the wrong role, inactive Retailers, and insufficient Distributor inventory', async () => {
    const wrongRole = createService(
      gateway,
      repository,
      manufacturerAuth(),
      encryptedWrites,
      retailerDirectory(),
    );
    await expect(
      wrongRole.prepareDistributorTransfer('session', distributorTransferInput()),
    ).rejects.toMatchObject({ code: 'ROLE_AUTHORIZATION_REQUIRED', status: 403 });

    const distributorService = createService(
      gateway,
      repository,
      distributorAuth(),
      encryptedWrites,
      retailerDirectory(),
    );
    vi.mocked(gateway.listActiveRetailers).mockResolvedValueOnce([]);
    await expect(
      distributorService.prepareDistributorTransfer('session', distributorTransferInput()),
    ).rejects.toMatchObject({ code: 'INVALID_RETAILER', status: 409 });

    vi.mocked(gateway.getProduct).mockResolvedValue({
      expiresAt: 1_900_000_000,
      manufacturer: MANUFACTURER,
      metadataHash: `0x${'88'.repeat(32)}`,
      producedAt: 1_790_000_000,
      publicCid: 'bafy-product',
      status: 1,
      totalQuantity: '500',
      unit: `0x${'00'.repeat(32)}`,
    });
    vi.mocked(gateway.getInventory).mockResolvedValue({
      available: '10',
      initialized: true,
      reserved: '0',
    });
    await expect(
      distributorService.prepareDistributorTransfer('session', distributorTransferInput()),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_INVENTORY', status: 409 });
  });

  it('prepares an idempotent Retailer transfer and verifies the mined record', async () => {
    const privateRecords = new Map<
      string,
      Awaited<ReturnType<ProductionFlowRepository['findPrivate']>>
    >();
    repository.findPrivate = vi.fn(async (_kind, key) => privateRecords.get(key.toLowerCase()));
    repository.savePrivate = vi.fn(async (_kind, record) => {
      privateRecords.set(record.id.toLowerCase(), record);
    });
    vi.mocked(gateway.getProduct).mockResolvedValue({
      expiresAt: 1_900_000_000,
      manufacturer: MANUFACTURER,
      metadataHash: `0x${'88'.repeat(32)}`,
      producedAt: 1_790_000_000,
      publicCid: 'bafy-product',
      status: 1,
      totalQuantity: '500',
      unit: `0x${'00'.repeat(32)}`,
    });
    vi.mocked(gateway.getInventory).mockResolvedValue({
      available: '100',
      initialized: true,
      reserved: '0',
    });
    const distributorService = createService(
      gateway,
      repository,
      distributorAuth(),
      encryptedWrites,
      retailerDirectory(),
    );
    const input = distributorTransferInput();
    const prepared = await distributorService.prepareDistributorTransfer('session', input);
    expect(prepared.state).toBe('TRANSACTION_REQUIRED');
    expect(gateway.prepareTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        productBatchId: PRODUCT_ID,
        quantity: '25',
        recipient: RETAILER,
        transferId: prepared.transferId,
      }),
    );
    expect(encryptedWrites[0]).toContain('Keep chilled');

    const tx = vi.mocked(gateway.prepareTransfer).mock.calls.at(-1)![0];
    vi.mocked(gateway.getTransfer).mockResolvedValue({
      expectedAt: tx.expectedAt,
      productBatchId: PRODUCT_ID,
      quantity: '25',
      recipient: RETAILER,
      sender: DISTRIBUTOR,
      shipmentCid: tx.shipmentCid,
      shipmentHash: tx.shipmentHash,
      status: 1,
      transferId: tx.transferId,
    });
    vi.mocked(gateway.getInventory).mockResolvedValue({
      available: '0',
      initialized: true,
      reserved: '25',
    });
    await expect(
      distributorService.prepareDistributorTransfer('session', input),
    ).resolves.toMatchObject({ state: 'COMPLETE', transferId: prepared.transferId });
  });
});

describe('production calldata', () => {
  const gateway = new EthersProductionFlowGateway(31_337, 'http://127.0.0.1:8545', ADDRESSES);
  it('encodes exact ProductRegistry.createProduct calldata', () => {
    const transaction = gateway.prepareProduct({
      batchId: PRODUCT_ID,
      metadataHash: `0x${'aa'.repeat(32)}`,
      publicCid: 'bafy-product',
      quantity: '100',
      unit: 'units',
      producedAt: 1_790_000_000,
      expiresAt: 1_900_000_000,
      ingredients: [{ batchId: BATCH_ID, quantity: '500' }],
    });
    const parsed = new Interface([
      'function createProduct(bytes32,bytes32,string,uint256,bytes32,uint64,uint64,bytes32[],uint256[])',
    ]).parseTransaction({ data: transaction.data });
    expect(parsed?.name).toBe('createProduct');
    expect(parsed?.args[0]).toBe(PRODUCT_ID);
    expect(parsed?.args[7]).toEqual([BATCH_ID]);
    expect(parsed?.args[8][0]).toBe(500n);
  });
  it('encodes exact CustodyTransfer.createTransfer calldata', () => {
    const transferId = id('shipment');
    const transaction = gateway.prepareTransfer({
      transferId,
      productBatchId: PRODUCT_ID,
      recipient: DISTRIBUTOR,
      quantity: '25',
      expectedAt: 1_800_000_000,
      shipmentHash: `0x${'bb'.repeat(32)}`,
      shipmentCid: 'bafy-shipment',
    });
    const parsed = new Interface([
      'function createTransfer(bytes32,bytes32,address,uint256,uint64,bytes32,string)',
    ]).parseTransaction({ data: transaction.data });
    expect(parsed?.name).toBe('createTransfer');
    expect(parsed?.args[0]).toBe(transferId);
    expect(parsed?.args[1]).toBe(PRODUCT_ID);
    expect(parsed?.args[2]).toBe(DISTRIBUTOR);
    expect(parsed?.args[3]).toBe(25n);
  });

  it('restores persisted workflows after restart and fails closed on corrupted JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tracechain-production-flow-'));
    const filePath = join(directory, 'workflow.json');
    const record: EvidenceWorkflowRecord = {
      batchId: BATCH_ID,
      challengeHash: id('persisted-challenge'),
      claimsHash: id('persisted-claims'),
      dueAt: 1_900_000_000,
      operationId: '99999999-9999-4999-8999-999999999999',
      requestCid: 'bafy-persisted-request',
      requestId: id('persisted-request'),
      requestPayload: PAYLOAD,
      requester: MANUFACTURER,
      supplier: SUPPLIER,
    };
    try {
      await new JsonProductionFlowRepository(filePath).saveEvidence(record);
      await expect(
        new JsonProductionFlowRepository(filePath).findEvidence(record.requestId),
      ).resolves.toEqual(record);

      await writeFile(filePath, '{corrupted-json', 'utf8');
      const restarted = new JsonProductionFlowRepository(filePath);
      await expect(restarted.findEvidence(record.requestId)).rejects.toBeInstanceOf(
        ProductionFlowPersistenceError,
      );
      expect(await readFile(filePath, 'utf8')).toBe('{corrupted-json');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function createService(
  gateway: ProductionFlowGateway,
  repository: ProductionFlowRepository,
  authService: AuthService,
  encryptedWrites: string[],
  stakeholderDirectory?: StakeholderDirectory,
) {
  const ingredientRepository: IngredientBatchWorkflowRepository = {
    find: vi.fn().mockResolvedValue(undefined),
    listForSupplier: vi.fn().mockResolvedValue([]),
    save: vi.fn(),
  };
  return new ProductionFlowService({
    agentProvider: vi.fn(),
    authService,
    clock: () => NOW,
    contentStore: {
      decrypt: vi.fn(),
      encryptAndStore: async (value) => {
        encryptedWrites.push(value);
        return { cid: `bafy-${encryptedWrites.length}`, payload: PAYLOAD };
      },
    },
    gateway,
    ingredientRepository,
    repository,
    stakeholderDirectory,
  });
}
function session(role: CompanyRole, address: string): SessionRecord {
  return {
    address,
    createdAt: NOW,
    expiresAt: new Date('2027-01-01'),
    id: 'session',
    onChainAuthorization: {
      checkedAt: NOW,
      credentialHash: 'cc'.repeat(32),
      credentialId: CREDENTIAL_ID,
      role,
      status: 'AUTHORIZED',
    },
    credentialVerification: {
      authorizationReady: true,
      credentialHash: 'cc'.repeat(32),
      credentialId: CREDENTIAL_ID,
      issuerDid: 'did:example:issuer',
      locallyVerified: true,
      onChainStatusChecked: true,
      role,
      subjectDid: 'did:example:subject',
      verifiedAt: NOW,
    },
  };
}
function manufacturerAuth() {
  return {
    requireSession: vi.fn().mockResolvedValue(session(CompanyRole.MANUFACTURER, MANUFACTURER)),
  } as unknown as AuthService;
}
function supplierAuth() {
  return {
    requireSession: vi.fn().mockResolvedValue(session(CompanyRole.SUPPLIER, SUPPLIER)),
  } as unknown as AuthService;
}
function distributorAuth() {
  return {
    requireSession: vi.fn().mockResolvedValue(session(CompanyRole.DISTRIBUTOR, DISTRIBUTOR)),
  } as unknown as AuthService;
}
function retailerAuth() {
  return {
    requireSession: vi.fn().mockResolvedValue(session(CompanyRole.RETAILER, RETAILER)),
  } as unknown as AuthService;
}
function retailerDirectory() {
  const identity = {
    active: true as const,
    companyName: 'FreshMart Retail Sdn. Bhd.',
    role: CompanyRole.RETAILER,
    walletAddress: RETAILER,
  };
  return {
    list: vi.fn().mockResolvedValue([identity]),
    resolve: vi.fn().mockResolvedValue(identity),
    resolveMany: vi.fn().mockResolvedValue([identity]),
  } satisfies StakeholderDirectory;
}
function requestInput() {
  return {
    batchId: BATCH_ID,
    claims: ['Full Ingredient Credential'],
    dueAt: new Date('2026-11-10'),
    operationId: '11111111-1111-4111-8111-111111111111',
    reason: 'Product traceability',
  };
}
function productInput() {
  return {
    batchReference: 'PRODUCT-001',
    category: 'food',
    expiresAt: new Date('2027-05-01'),
    ingredientLinks: [{ batchId: BATCH_ID, quantity: '500' }],
    privateMetadata: { name: 'Chocolate' },
    producedAt: new Date('2026-11-01'),
    productName: 'Chocolate',
    quantity: '100',
    unit: 'units',
  };
}
function transferInput() {
  return {
    expectedAt: new Date('2026-11-10'),
    productBatchId: PRODUCT_ID,
    quantity: '25',
    recipient: DISTRIBUTOR,
    shipmentReference: 'SHIP-001',
  };
}
function distributorTransferInput() {
  return {
    expectedAt: new Date('2026-11-10'),
    handlingNotes: 'Keep chilled',
    operationId: '33333333-3333-4333-8333-333333333333',
    productBatchId: PRODUCT_ID,
    quantity: '25',
    recipient: RETAILER,
    shipmentReference: 'DIST-RETAIL-001',
  };
}

function boundChallenge(context: Record<string, unknown>) {
  const canonical = JSON.stringify(sortForTest(context));
  const binding = createHash('sha256').update(canonical, 'utf8').digest('base64url');
  return `server-generated-challenge.${binding}`;
}

function sortForTest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForTest);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortForTest(nested)]),
  );
}
