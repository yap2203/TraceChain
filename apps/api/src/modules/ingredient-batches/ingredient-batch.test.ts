import { createHash, randomUUID } from 'node:crypto';
import { ingredientBatchRequestSchema } from './ingredient-batch.schema.js';
import { certificationClaim, certificationDocumentsClaim } from '@tracechain/shared';
import { verifyIngredientSdJwtPresentation, readIngredientSdJwtClaims, issueIngredientSdJwt } from '@tracechain/ssi';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTraceChainAgent, type TraceChainAgent } from '@tracechain/ssi';
import { CompanyRole } from '@tracechain/shared';
import type { DIDResolver } from 'did-resolver';
import { Interface, computeAddress, encodeBytes32String, getAddress, id, isAddress } from 'ethers';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { AuthError, type AuthService } from '../auth/auth.service.js';
import type { EncryptedCredentialPayload } from '../ssi/encrypted-credential.store.js';
import { IpfsEncryptedCredentialStore } from '../ssi/encrypted-credential.store.js';
import type {
  ChainIngredientBatch,
  ChainIngredientCredential,
  IngredientBatchGateway,
} from './ingredient-batch.gateway.js';
import { EthersIngredientBatchGateway } from './ingredient-batch.gateway.js';
import type {
  IngredientBatchWorkflowRecord,
  IngredientBatchWorkflowRepository,
} from './ingredient-batch.repository.js';
import { JsonIngredientBatchWorkflowRepository } from './ingredient-batch.repository.js';
import { IngredientBatchService } from './ingredient-batch.service.js';

const CHAIN_ID = 31_337;
const SUPPLIER = '0x2000000000000000000000000000000000000002';
const NOW = new Date('2026-11-06T08:00:00.000Z');
const STAKEHOLDER_ADDRESS = '0x1000000000000000000000000000000000000001';
const CREDENTIAL_ADDRESS = '0x3000000000000000000000000000000000000003';
const INGREDIENT_ADDRESS = '0x4000000000000000000000000000000000000004';
const BODY = {
  allergenInformation: 'None',
  batchReference: 'COCOA-2026-001',
  category: 'cocoa',
  certifications: ['Organic'],
  expiryDate: '2030-01-01T00:00:00.000Z',
  ingredientName: 'Cocoa Powder',
  origin: 'Ghana',
  productionDate: '2026-10-01T00:00:00.000Z',
  quantity: '500',
  unit: 'kg',
};

const localEthrResolver: DIDResolver = async (did, parsed) => {
  const identifier = parsed.id.split(':').at(-1) ?? parsed.id;
  const address = isAddress(identifier) ? getAddress(identifier) : computeAddress(identifier);
  const methodId = `${did}#controller`;
  const controllerKeyId = `${did}#controllerKey`;
  return {
    didDocument: {
      '@context': ['https://www.w3.org/ns/did/v1'],
      assertionMethod: [methodId, controllerKeyId],
      authentication: [methodId, controllerKeyId],
      id: did,
      verificationMethod: [
        {
          blockchainAccountId: `eip155:11155111:${address}`,
          controller: did,
          id: methodId,
          type: 'EcdsaSecp256k1RecoveryMethod2020',
        },
        {
          controller: did,
          id: controllerKeyId,
          publicKeyHex: identifier.slice(2),
          type: 'EcdsaSecp256k1VerificationKey2019',
        },
      ],
    },
    didDocumentMetadata: {},
    didResolutionMetadata: { contentType: 'application/did+ld+json' },
  };
};

describe('Supplier ingredient-batch API', () => {
  let agent: TraceChainAgent;
  let directory: string;
  let credential: ChainIngredientCredential | null;
  let batch: ChainIngredientBatch | null;
  let records: Map<string, IngredientBatchWorkflowRecord>;
  let serialized: string;
  let gateway: IngredientBatchGateway;
  let service: IngredientBatchService;
  let dependencies: ConstructorParameters<typeof IngredientBatchService>[0];

  it('reports an unavailable authorization read as 503 before accessing batches', async () => {
    vi.spyOn(dependencies.authService, 'requireSession').mockResolvedValueOnce({
      address: getAddress(SUPPLIER),
      onChainAuthorization: { checkedAt: NOW, status: 'UNAVAILABLE' },
    } as any);
    await expect(service.list('session')).rejects.toMatchObject({
      status: 503,
      code: 'BLOCKCHAIN_AUTHORIZATION_UNAVAILABLE',
    });
    expect(gateway.listBatchIds).not.toHaveBeenCalled();
  });

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tracechain-ingredient-api-'));
    agent = await createTraceChainAgent({
      chainId: 11_155_111,
      kmsSecretKey: 'c'.repeat(64),
      networkName: 'sepolia',
      privateKeyStorePath: join(directory, 'private.json'),
      publicStorePath: join(directory, 'public.json'),
      resolverOverrides: { ethr: localEthrResolver },
      rpcUrl: 'https://example.invalid',
    });
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    credential = null;
    batch = null;
    records = new Map();
    serialized = '';
    const transactionGateway = new EthersIngredientBatchGateway(
      CHAIN_ID,
      'http://127.0.0.1:8545',
      STAKEHOLDER_ADDRESS,
      CREDENTIAL_ADDRESS,
      INGREDIENT_ADDRESS,
    );
    gateway = {
      assertDeployment: vi.fn().mockResolvedValue(undefined),
      getBatch: vi.fn(async () => batch),
      getCredential: vi.fn(async () => credential),
      getSupplierAccess: vi.fn().mockResolvedValue({
        credentialAuthorized: true,
        issuePermission: true,
        registerPermission: true,
        role: 2,
        status: 1,
      }),
      listBatchIds: vi.fn().mockResolvedValue([]),
      prepareBatchRegistration: (input) => transactionGateway.prepareBatchRegistration(input),
      prepareIngredientCredentialRegistration: (input) =>
        transactionGateway.prepareIngredientCredentialRegistration(input),
    };
    const repository: IngredientBatchWorkflowRepository = {
      find: async (batchId) => records.get(batchId.toLowerCase()),
      listForSupplier: async (wallet) =>
        [...records.values()].filter(
          (record) => record.supplierWallet.toLowerCase() === wallet.toLowerCase(),
        ),
      save: async (record) => {
        records.set(record.batchId.toLowerCase(), record);
      },
    };
    const payload: EncryptedCredentialPayload = {
      algorithm: 'aes-256-gcm',
      authTag: 'test-tag',
      ciphertext: 'test-ciphertext',
      iv: 'test-iv',
      version: 1,
    };
    dependencies = {
      agentProvider: async () => agent,
      authService: authorizedAuthService(),
      clock: () => NOW,
      contentStore: {
        decrypt: async () => serialized,
        encryptAndStore: async (value) => {
          serialized = value;
          return { cid: 'bafy-encrypted-ingredient-test', payload };
        },
      },
      gateway,
      repository,
    };
    service = new IngredientBatchService(dependencies);
  });

  it('recovers a confirmed ingredient on a second API with an empty data directory', async () => {
    const batchId = id(BODY.batchReference);
    const operationId = randomUUID();
    const certificationId = randomUUID();
    const documentId = randomUUID();
    const documentData =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDfsAAAAASUVORK5CYII=';
    const document = {
      cid: 'bafy-portable-certification',
      fileName: 'organic-certificate.png',
      id: documentId,
      mimeType: 'image/png',
      sha256: createHash('sha256').update(Buffer.from(documentData, 'base64')).digest('hex'),
      size: Buffer.from(documentData, 'base64').length,
    };
    const encryptedDocument = {
      id: documentId,
      operationId,
      certificationId,
      fileName: document.fileName,
      mimeType: document.mimeType,
      data: documentData,
    };
    const metadata = {
      batchId: BODY.batchReference,
      ingredientName: BODY.ingredientName,
      category: BODY.category,
      countryOfOrigin: BODY.origin,
      certificationEntries: [{ id: certificationId, documents: [document] }],
    };
    const envelope = JSON.stringify({ metadata, version: 2 });
    const metadataHash = `0x${createHash('sha256').update(JSON.stringify(metadata)).digest('hex')}`;
    const payload: EncryptedCredentialPayload = {
      algorithm: 'aes-256-gcm',
      authTag: 'portable-test-tag',
      ciphertext: Buffer.from(envelope).toString('base64'),
      iv: 'portable-test-iv',
      version: 1,
    };
    const deviceA = new JsonIngredientBatchWorkflowRepository(
      join(directory, 'device-a', 'issuance', 'ingredient-batches.json'),
    );
    const deviceB = new JsonIngredientBatchWorkflowRepository(
      join(directory, 'device-b', 'issuance', 'ingredient-batches.json'),
    );
    await deviceA.save({
      operationId,
      certificationDocumentIds: [documentId],
      batchId,
      credentialHash: `0x${'11'.repeat(32)}`,
      credentialId: `0x${'22'.repeat(32)}`,
      encryptedCid: 'bafy-portable-ingredient',
      encryptedPayload: payload,
      expiresAt: 1_900_000_000,
      issuerDid: 'did:example:issuer',
      metadataHash,
      producedAt: 1_790_000_000,
      quantity: '500',
      supplierWallet: getAddress(SUPPLIER),
      unit: 'kg',
    });
    await deviceA.saveAttachment({
      id: documentId,
      operationId,
      certificationId,
      supplierWallet: getAddress(SUPPLIER),
      sha256: document.sha256,
      cid: document.cid,
      payload: {
        algorithm: 'aes-256-gcm',
        authTag: 'portable-document-tag',
        ciphertext: Buffer.from(JSON.stringify(encryptedDocument)).toString('base64'),
        iv: 'portable-document-iv',
        version: 1,
      },
    });
    batch = {
      availableQuantity: '500',
      credentialId: `0x${'22'.repeat(32)}`,
      encryptedCid: 'bafy-portable-ingredient',
      expiresAt: 1_900_000_000,
      metadataHash,
      producedAt: 1_790_000_000,
      status: 1,
      supplier: getAddress(SUPPLIER),
      totalQuantity: '500',
      unit: encodeBytes32String('kg'),
    };
    vi.mocked(gateway.listBatchIds).mockResolvedValue([batchId]);
    const sharedContent = {
      decrypt: async () => envelope,
      encryptAndStore: dependencies.contentStore.encryptAndStore,
      retrieveAndDecrypt: vi.fn(async (cid: string) => {
        if (cid === 'bafy-portable-ingredient') return envelope;
        if (cid === document.cid) return JSON.stringify(encryptedDocument);
        throw new Error('IPFS object unavailable');
      }),
    };
    const fromDeviceA = new IngredientBatchService({
      ...dependencies,
      contentStore: sharedContent,
      repository: deviceA,
    });
    const fromDeviceB = new IngredientBatchService({
      ...dependencies,
      contentStore: sharedContent,
      repository: deviceB,
    });

    expect(await deviceA.find(batchId)).toBeDefined();
    expect(await deviceA.findAttachment(documentId)).toBeDefined();
    expect(await deviceB.find(batchId)).toBeUndefined();
    expect(await deviceB.findAttachment(documentId)).toBeUndefined();
    expect((await fromDeviceA.list('session')).batches[0]?.ingredientName).toBe('Cocoa Powder');
    expect((await fromDeviceB.list('session')).batches[0]?.ingredientName).toBe('Cocoa Powder');
    await expect(
      fromDeviceB.certificationDocument('session', batchId, document.id),
    ).resolves.toMatchObject({ fileName: document.fileName, data: documentData });
    expect(sharedContent.retrieveAndDecrypt).toHaveBeenCalledWith('bafy-portable-ingredient');
    expect(sharedContent.retrieveAndDecrypt).toHaveBeenCalledWith(document.cid);
    expect(await deviceB.find(batchId)).toBeUndefined();
    expect(await deviceB.findAttachment(documentId)).toBeUndefined();
  });

  it.each([0, 1, 3])(
    'issues %i structured certifications without inventing optional values',
    async (count) => {
      const repository = dependencies.repository;
      const attachments = new Map<string, any>();
      const content = new Map<string, string>();
      repository.findAttachment = async (id) => attachments.get(id);
      repository.saveAttachment = async (record) => {
        attachments.set(record.id, record);
      };
      dependencies.contentStore = {
        encryptAndStore: async (value, key) => {
          content.set(key, value);
          return {
            cid: 'bafy-' + key,
            payload: {
              algorithm: 'aes-256-gcm',
              version: 1,
              ciphertext: key,
              iv: 'test',
              authTag: 'test',
            },
          };
        },
        decrypt: async (payload) => content.get(payload.ciphertext)!,
      };
      const issuer = new IngredientBatchService(dependencies);
      const operationId = randomUUID();
      const entries = [];
      for (let index = 0; index < count; index++) {
        const entryId = randomUUID();
        const document = await issuer.uploadCertificationDocument('session', {
          id: randomUUID(),
          operationId,
          certificationId: entryId,
          fileName: 'cert.png',
          mimeType: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDfsAAAAASUVORK5CYII=',
        });
        entries.push({
          id: entryId,
          name: 'Organic',
          issuer: 'Stated organization',
          reference: 'CERT-' + index,
          noExpiry: true,
          scope: 'Company',
          documents: [document],
        });
      }
      const input = ingredientBatchRequestSchema.parse({
        ...BODY,
        operationId,
        originDetails: {
          countryCode: 'GH',
          countryName: 'Ghana',
        },
        allergen: { kind: 'declaresNone' },
        certificationEntries: entries,
      });
      const prepared = await issuer.prepare('session', input);
      const record = await repository.find(prepared.batchId);
      const envelope = JSON.parse(await dependencies.contentStore.decrypt(record!.encryptedPayload));
      const claims = await readIngredientSdJwtClaims(envelope.sdJwt);
      expect(claims.vct).toBe('urn:tracechain:credential:ingredient:sd-jwt:v3');
      expect(Object.keys(claims).filter((key) => /^certification_[a-f0-9]{32}$/.test(key))).toHaveLength(count);
      expect(claims).not.toHaveProperty('processingLocation');
      expect(claims).not.toHaveProperty('qualityTests');
      expect(claims).not.toHaveProperty('internalQualityRemarks');
    },
  );
  it('normalizes new decimals while leaving legacy whole litre records unchanged', () => {
    const originDetails = { countryCode: 'GH', countryName: 'Ghana' };
    const modern = ingredientBatchRequestSchema.parse({
      ...BODY,
      operationId: randomUUID(),
      originDetails,
      allergen: { kind: 'unknown' },
      quantity: '1.25',
      unit: 'litre',
    });
    expect(modern.quantity).toBe('1250');
    expect(modern.unit).toBe('mL');
    expect(ingredientBatchRequestSchema.parse({ ...BODY, unit: 'litre' }).unit).toBe('litre');
    for (const patch of [
      { quantity: '0.0001' },
      { quantity: '0' },
      { originDetails: { countryCode: 'EU', countryName: 'European Union' } },
      { allergen: { kind: 'contains' } },
    ])
      expect(
        ingredientBatchRequestSchema.safeParse({
          ...BODY,
          operationId: randomUUID(),
          originDetails,
          allergen: { kind: 'unknown' },
          ...patch,
        }).success,
      ).toBe(false);
  });
  it('rejects removed processing and quality fields from new registrations', () => {
    const modern = {
      ...BODY,
      operationId: randomUUID(),
      originDetails: { countryCode: 'GH', countryName: 'Ghana' },
      allergen: { kind: 'unknown' },
    };
    for (const removed of [
      { productionDateMeaning: 'processing' },
      { internalQualityRemarks: 'Legacy internal note' },
      { qualityTests: [] },
      {
        originDetails: {
          countryCode: 'GH',
          countryName: 'Ghana',
          processingLocation: 'Legacy processing site',
        },
      },
    ])
      expect(ingredientBatchRequestSchema.safeParse({ ...modern, ...removed }).success).toBe(false);
  });
  it('loads legacy metadata while omitting retired fields from the ingredient response', async () => {
    const batchId = `0x${'71'.repeat(32)}`;
    const credentialId = `0x${'72'.repeat(32)}`;
    const metadataHash = `0x${'73'.repeat(32)}`;
    const encryptedCid = 'bafy-legacy-ingredient';
    serialized = JSON.stringify({
      metadata: {
        allergenInformation: 'None declared',
        batchId: 'LEGACY-001',
        category: 'cocoa',
        certifications: ['Organic'],
        expiryDate: '2030-01-01T00:00:00.000Z',
        ingredientName: 'Legacy Cocoa',
        internalQualityRemarks: 'Do not expose this old note',
        origin: 'Ghana',
        originDetails: {
          countryCode: 'GH',
          countryName: 'Ghana',
          region: 'Ashanti',
          processingCountry: 'MY',
          processingLocation: 'Old processing site',
        },
        productionDate: '2026-10-01T00:00:00.000Z',
        productionDateMeaning: 'processing',
        qualityTests: [{ id: randomUUID(), results: 'Old laboratory result' }],
        quantity: '500',
        supplierWallet: SUPPLIER,
        unit: 'kg',
      },
    });
    await dependencies.repository.save({
      batchId,
      credentialHash: `0x${'74'.repeat(32)}`,
      credentialId,
      encryptedCid,
      encryptedPayload: {
        algorithm: 'aes-256-gcm',
        authTag: 'test-tag',
        ciphertext: 'test-ciphertext',
        iv: 'test-iv',
        version: 1,
      },
      expiresAt: 1_893_456_000,
      issuerDid: 'did:ethr:sepolia:0x02',
      metadataHash,
      producedAt: 1_759_276_800,
      quantity: '500',
      supplierWallet: SUPPLIER,
      unit: 'kg',
    });
    batch = {
      availableQuantity: '500',
      credentialId,
      encryptedCid,
      expiresAt: 1_893_456_000,
      metadataHash,
      producedAt: 1_759_276_800,
      status: 1,
      supplier: SUPPLIER,
      totalQuantity: '500',
      unit: 'kg',
    };
    vi.mocked(gateway.listBatchIds).mockResolvedValue([batchId]);

    const result = await service.list('session');
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]).toMatchObject({
      ingredientName: 'Legacy Cocoa',
      originDetails: { countryCode: 'GH', countryName: 'Ghana', region: 'Ashanti' },
    });
    expect(result.batches[0]).not.toHaveProperty('qualityTests');
    expect(result.batches[0]).not.toHaveProperty('internalQualityRemarks');
    expect(result.batches[0]).not.toHaveProperty('productionDateMeaning');
    expect(result.batches[0]?.originDetails).not.toHaveProperty('processingCountry');
    expect(result.batches[0]?.originDetails).not.toHaveProperty('processingLocation');
  });
  it('stores multiple certification files encrypted, binds references and discloses only one complete entry', async () => {
    const browser = await import(
      new URL('../../../../web/src/features/didcomm/didcomm-agent.ts', import.meta.url).href
    );
    const holder = await browser.createMessagingAgent();
    const documents = new Map<string, any>(),
      contents = new Map<string, string>();
    const repo = {
      ...dependencies.repository,
      findAttachment: async (key: string) => documents.get(key),
      saveAttachment: async (record: any) => {
        documents.set(record.id, record);
      },
    };
    const store = {
      encryptAndStore: vi.fn(async (value: string, key: string) => {
        contents.set(key, value);
        return {
          cid: 'bafy-' + key,
          payload: {
            algorithm: 'aes-256-gcm' as const,
            version: 1 as const,
            iv: 'test',
            authTag: 'test',
            ciphertext: key,
          },
        };
      }),
      decrypt: async (payload: any) => contents.get(payload.ciphertext)!,
    };
    const issuing = new IngredientBatchService({
      ...dependencies,
      repository: repo,
      contentStore: store,
      messagingIdentityResolver: { findIdentityByWallet: async () => ({ did: holder.did }) },
    });
    const operationId = randomUUID(),
      entryId = randomUUID(),
      otherId = randomUUID();
    const data =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDfsAAAAASUVORK5CYII=';
    const upload = (id: string, certificationId = entryId) =>
      issuing.uploadCertificationDocument('session', {
        id,
        operationId,
        certificationId,
        fileName: 'certification.png',
        mimeType: 'image/png',
        data,
      });
    const first = await upload(randomUUID()),
      second = await upload(randomUUID());
    const otherDocument = await upload(randomUUID(), otherId);
    const before = store.encryptAndStore.mock.calls.length;
    await upload(first.id);
    expect(store.encryptAndStore).toHaveBeenCalledTimes(before);
    const certification = {
      id: entryId,
      name: 'Organic',
      issuer: 'Supplier-stated certifier',
      reference: 'CERT-42',
      scope: 'This batch' as const,
      scopeReference: BODY.batchReference,
      noExpiry: true,
      documents: [first, second],
    };
    const input = ingredientBatchRequestSchema.parse({
      ...BODY,
      operationId,
      originDetails: {
        countryCode: 'GH',
        countryName: 'Ghana',
        region: 'Ashanti',
        privateAddress: 'Private source farm address',
      },
      allergen: { kind: 'unknown' },
      certificationEntries: [
        certification,
        { ...certification, id: otherId, reference: 'OTHER', documents: [otherDocument] },
      ],
    });
    const result = await issuing.prepare('session', input);
    const record = [...records.values()][0]!;
    const envelope = JSON.parse(await store.decrypt(record.encryptedPayload));
    expect(record.certificationDocumentIds).toEqual([first.id, second.id, otherDocument.id]);
    expect((await issuing.certificationDocument('session', result.batchId, first.id)).data).toBe(
      data,
    );
    await expect(
      issuing.prepare('session', {
        ...input,
        certificationEntries: [
          { ...certification, documents: [{ ...first, sha256: '0'.repeat(64) }] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_BINDING_MISMATCH' });
    // Preserve explicit coverage of the legacy Ed25519 disclosure format.
    const decoded = await readIngredientSdJwtClaims(envelope.sdJwt);
    envelope.sdJwt = await issueIngredientSdJwt(agent, {
      holderDid: holder.did, issuerDid: record.issuerDid, issuedAt: Math.floor(NOW.getTime() / 1000), expiresAt: record.expiresAt,
      claims: Object.fromEntries(Object.entries(decoded).filter(([key]) => !['iss','sub','vct','cnf','iat','exp'].includes(key))) as any,
    });
    const audience = 'manufacturer',
      nonce = 'fresh-request';
    const now = Math.floor(Date.now() / 1000);
    const context = {
      requestId: 'exact-request',
      purpose: 'Origin verification',
      batchId: record.batchId,
      expiresAt: now + 240,
    };
    const contextPresentation = await browser.createSelectiveIngredientPresentation(
      holder,
      envelope.sdJwt,
      {
        audience,
        nonce,
        context,
        claims: ['countryOfOrigin'],
      },
    );
    const expected = {
      audience,
      nonce,
      now,
      context,
      requiredClaims: ['countryOfOrigin'],
      supplierWallet: SUPPLIER,
      batchId: record.batchId,
    };
    const contextVerified = await verifyIngredientSdJwtPresentation(
      agent,
      contextPresentation,
      expected,
    );
    expect(contextVerified.payload).toHaveProperty('countryOfOrigin', 'Ghana');
    expect(contextVerified.payload).not.toHaveProperty(certificationClaim(entryId));
    expect(contextVerified.payload).not.toHaveProperty('privateOriginAddress');
    for (const change of [
      { requestId: 'wrong-request' },
      { purpose: 'wrong-purpose' },
      { expiresAt: now - 1 },
    ])
      await expect(
        verifyIngredientSdJwtPresentation(agent, contextPresentation, {
          ...expected,
          context: { ...context, ...change },
        }),
      ).rejects.toThrow(/binding/);
    const selected = await browser.createSelectiveIngredientPresentation(holder, envelope.sdJwt, {
      audience,
      nonce,
      claims: ['countryOfOrigin', certificationClaim(entryId)],
    });
    const verified = await verifyIngredientSdJwtPresentation(agent, selected, {
      audience,
      nonce,
      now: Math.floor(Date.now() / 1000),
      requiredClaims: ['certifications'],
      supplierWallet: SUPPLIER,
      batchId: record.batchId,
    });
    expect(verified.payload[certificationClaim(entryId)]).toMatchObject({
      reference: 'CERT-42',
      scope: 'This batch',
    });
    expect(verified.payload).not.toHaveProperty(certificationClaim(otherId));
    expect(verified.payload).toMatchObject({
      category: input.category,
      quantity: input.quantity,
      unit: input.unit,
    });
    expect(verified.payload).not.toHaveProperty('privateOriginAddress');
    expect(verified.payload).not.toHaveProperty(certificationDocumentsClaim(first.id));
    const docsOnly = await browser.createSelectiveIngredientPresentation(holder, envelope.sdJwt, {
      audience,
      nonce,
      claims: [certificationDocumentsClaim(first.id)],
    });
    await expect(
      verifyIngredientSdJwtPresentation(agent, docsOnly, {
        audience,
        nonce,
        now: Math.floor(Date.now() / 1000),
        requiredClaims: [],
        supplierWallet: SUPPLIER,
        batchId: record.batchId,
      }),
    ).rejects.toThrow(/complete certification/);
    const sharedFiles = await browser.createSelectiveIngredientPresentation(
      holder,
      envelope.sdJwt,
      {
        audience,
        nonce,
        claims: [certificationClaim(entryId), certificationDocumentsClaim(first.id)],
      },
    );
    expect(
      (
        await verifyIngredientSdJwtPresentation(agent, sharedFiles, {
          audience,
          nonce,
          now: Math.floor(Date.now() / 1000),
          requiredClaims: ['certificationDocuments'],
          supplierWallet: SUPPLIER,
          batchId: record.batchId,
        })
      ).payload[certificationDocumentsClaim(first.id)],
    ).toMatchObject({ documents: [{ id: first.id }] });
    const tampered = sharedFiles
      .split('~')
      .map((part: string) => {
        try {
          const disclosure = JSON.parse(Buffer.from(part, 'base64url').toString());
          if (
            Array.isArray(disclosure) &&
            disclosure[1] === certificationDocumentsClaim(first.id)
          ) {
            disclosure[2].documents[0].sha256 = '0'.repeat(64);
            return Buffer.from(JSON.stringify(disclosure)).toString('base64url');
          }
        } catch {}
        return part;
      })
      .join('~');
    await expect(
      verifyIngredientSdJwtPresentation(agent, tampered, {
        audience,
        nonce,
        now: Math.floor(Date.now() / 1000),
        requiredClaims: ['certificationDocuments'],
        supplierWallet: SUPPLIER,
        batchId: record.batchId,
      }),
    ).rejects.toBeDefined();
    expect(await browser.readSelectiveIngredientClaims(sharedFiles)).not.toHaveProperty(
      certificationDocumentsClaim(second.id),
    );
    expect((await issuing.drafts('session')).workflows[0]?.input).not.toHaveProperty(
      'supplierWallet',
    );
    const foreign = new IngredientBatchService({
      ...dependencies,
      repository: repo,
      contentStore: store,
      authService: {
        requireSession: async () => ({
          ...(await authorizedAuthService().requireSession('session')),
          address: '0x5000000000000000000000000000000000000005',
        }),
      } as any,
    });
    await expect(
      foreign.certificationDocument('session', record.batchId, first.id),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ACCESS_DENIED' });
  });
  it('rejects corrupt and unsupported uploads before storage and supports a stable retry after storage failure', async () => {
    const documents = new Map<string, any>(),
      repo = {
        ...dependencies.repository,
        findAttachment: async (key: string) => documents.get(key),
        saveAttachment: async (record: any) => {
          documents.set(record.id, record);
        },
      };
    const encryptAndStore = vi
      .fn()
      .mockRejectedValueOnce(new Error('Pinning failed'))
      .mockResolvedValue({
        cid: 'bafy-test',
        payload: { algorithm: 'aes-256-gcm', version: 1, iv: '', authTag: '', ciphertext: 'test' },
      });
    const uploader = new IngredientBatchService({
      ...dependencies,
      repository: repo,
      contentStore: { ...dependencies.contentStore, encryptAndStore },
    });
    const file = {
      id: randomUUID(),
      operationId: randomUUID(),
      certificationId: randomUUID(),
      fileName: 'cert.png',
      mimeType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDfsAAAAASUVORK5CYII=',
    };
    for (const patch of [
      { data: Buffer.from('not an image').toString('base64') },
      { mimeType: 'text/html' },
      { data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') },
      {
        fileName: 'bad.pdf',
        mimeType: 'application/pdf',
        data: Buffer.from('%PDF-1.7 fake %%EOF').toString('base64'),
      },
    ])
      await expect(
        uploader.uploadCertificationDocument('session', { ...file, ...patch }),
      ).rejects.toBeDefined();
    expect(encryptAndStore).not.toHaveBeenCalled();
    await expect(uploader.uploadCertificationDocument('session', file)).rejects.toMatchObject({
      code: 'DOCUMENT_STORAGE_UNAVAILABLE',
    });
    expect((await uploader.uploadCertificationDocument('session', file)).id).toBe(file.id);
  });
  it('filters a foreign Supplier batch from management reads before decryption', async () => {
    vi.mocked(gateway.listBatchIds).mockResolvedValue([`0x${'11'.repeat(32)}`]);
    batch = { supplier: '0x5000000000000000000000000000000000000005' } as ChainIngredientBatch;
    const decrypt = vi.fn();
    const reader = new IngredientBatchService({
      ...dependencies,
      contentStore: { ...dependencies.contentStore, decrypt },
    });
    expect((await reader.list('session')).batches).toEqual([]);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('does not decrypt another Supplier stored metadata when a batch ID is reused on chain', async () => {
    await service.prepare('session', {
      ...BODY,
      productionDate: new Date(BODY.productionDate),
      expiryDate: new Date(BODY.expiryDate),
    });
    const record = [...records.values()][0]!;
    record.supplierWallet = '0x5000000000000000000000000000000000000005';
    batch = {
      supplier: SUPPLIER,
      credentialId: record.credentialId,
      metadataHash: record.metadataHash,
      encryptedCid: record.encryptedCid,
    } as ChainIngredientBatch;
    vi.mocked(gateway.listBatchIds).mockResolvedValue([record.batchId]);
    const decrypt = vi.fn();
    const reader = new IngredientBatchService({
      ...dependencies,
      contentStore: { ...dependencies.contentStore, decrypt },
    });
    const result = await reader.list('session');
    expect(result.batches[0].ingredientName).toBe('Registered ingredient');
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('requires an authenticated SIWE session and authorized Supplier credential', async () => {
    const unauthenticated = new IngredientBatchService({
      ...dependencies,
      authService: {
        requireSession: async () => {
          throw new AuthError('AUTHENTICATION_REQUIRED', 'Authentication is required.', 401);
        },
      } as unknown as AuthService,
    });
    const app = createApp({ ingredientBatchService: unauthenticated });
    const response = await request(app).post('/api/ingredient-batches/prepare').send(BODY);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects a non-Supplier credential and missing on-chain permissions', async () => {
    const wrongRole = new IngredientBatchService({
      ...dependencies,
      authService: {
        requireSession: async () => ({
          address: SUPPLIER,
          onChainAuthorization: {
            checkedAt: new Date(),
            credentialHash: 'a'.repeat(64),
            role: CompanyRole.DISTRIBUTOR,
            status: 'AUTHORIZED',
          },
          credentialVerification: {
            authorizationReady: true,
            credentialHash: 'a'.repeat(64),
            role: CompanyRole.DISTRIBUTOR,
          },
          id: 'test-session',
        }),
      } as unknown as AuthService,
    });
    await expect(
      wrongRole.prepare('test-session', {
        ...BODY,
        expiryDate: new Date(BODY.expiryDate),
        productionDate: new Date(BODY.productionDate),
      }),
    ).rejects.toMatchObject({ code: 'SUPPLIER_AUTHORIZATION_REQUIRED', status: 403 });

    vi.mocked(gateway.getSupplierAccess).mockResolvedValue({
      credentialAuthorized: true,
      issuePermission: true,
      registerPermission: false,
      role: 2,
      status: 1,
    });
    await expect(
      service.prepare('test-session', {
        ...BODY,
        expiryDate: new Date(BODY.expiryDate),
        productionDate: new Date(BODY.productionDate),
      }),
    ).rejects.toMatchObject({ code: 'SUPPLIER_PERMISSION_REQUIRED', status: 403 });
  });

  it('prepares exact credential and batch calldata sequentially, then verifies completion', async () => {
    const app = createApp({ ingredientBatchService: service });
    const client = request(app);
    const first = await client
      .post('/api/ingredient-batches/prepare')
      .set('Cookie', 'tracechain_session=test-session')
      .send(BODY)
      .expect(200);
    expect(first.body.state).toBe('CREDENTIAL_REGISTRATION_REQUIRED');
    expect(first.body.transaction).toMatchObject({ chainId: CHAIN_ID, to: CREDENTIAL_ADDRESS });
    const credentialCall = new Interface([
      'function registerCredential(bytes32,bytes32,string,address,uint8,uint64)',
    ]).decodeFunctionData('registerCredential', first.body.transaction.data);
    expect(credentialCall[0]).toBe(first.body.credentialId);
    expect(credentialCall[2]).toBe('bafy-encrypted-ingredient-test');
    expect(getAddress(credentialCall[3])).toBe(getAddress(SUPPLIER));
    expect(Number(credentialCall[4])).toBe(2);
    const record = [...records.values()][0]!;
    credential = {
      credentialHash: credentialCall[1],
      credentialType: 2,
      encryptedCid: credentialCall[2],
      expiresAt: Number(credentialCall[5]),
      issuer: SUPPLIER,
      status: 1,
      subject: SUPPLIER,
    };

    const second = await client
      .post('/api/ingredient-batches/prepare')
      .set('Cookie', 'tracechain_session=test-session')
      .send(BODY)
      .expect(200);
    expect(second.body.state).toBe('BATCH_REGISTRATION_REQUIRED');
    expect(second.body.transaction.to).toBe(INGREDIENT_ADDRESS);
    const batchCall = new Interface([
      'function registerBatch(bytes32,bytes32,string,bytes32,uint256,bytes32,uint64,uint64)',
    ]).decodeFunctionData('registerBatch', second.body.transaction.data);
    expect(batchCall[0]).toBe(record.batchId);
    expect(batchCall[1]).toBe(record.metadataHash);
    expect(batchCall[2]).toBe(record.encryptedCid);
    expect(batchCall[3]).toBe(record.credentialId);
    expect(batchCall[4].toString()).toBe('500');

    batch = {
      availableQuantity: '500',
      credentialId: record.credentialId,
      encryptedCid: record.encryptedCid,
      expiresAt: record.expiresAt,
      metadataHash: record.metadataHash,
      producedAt: record.producedAt,
      status: 1,
      supplier: SUPPLIER,
      totalQuantity: '500',
      unit: batchCall[5],
    };
    const completed = await client
      .post('/api/ingredient-batches/prepare')
      .set('Cookie', 'tracechain_session=test-session')
      .send(BODY)
      .expect(200);
    expect(completed.body).toMatchObject({
      batchId: record.batchId,
      credentialId: record.credentialId,
      state: 'COMPLETE',
      supplierWallet: getAddress(SUPPLIER),
    });
    expect(records.size).toBe(1);

    vi.mocked(gateway.listBatchIds).mockResolvedValue([record.batchId]);
    const listed = await client
      .get('/api/ingredient-batches')
      .set('Cookie', 'tracechain_session=test-session')
      .expect(200);
    expect(listed.body.batches).toEqual([
      expect.objectContaining({
        batchId: record.batchId,
        batchReference: BODY.batchReference,
        credentialId: record.credentialId,
        ingredientName: BODY.ingredientName,
        quantity: BODY.quantity,
      }),
    ]);
  });

  it('rejects conflicting duplicate batch input without issuing another credential', async () => {
    await service.prepare('test-session', {
      ...BODY,
      expiryDate: new Date(BODY.expiryDate),
      productionDate: new Date(BODY.productionDate),
    });
    await expect(
      service.prepare('test-session', {
        ...BODY,
        expiryDate: new Date(BODY.expiryDate),
        ingredientName: 'Different ingredient',
        productionDate: new Date(BODY.productionDate),
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_CONFLICT', status: 409 });
    expect(records.size).toBe(1);
  });

  it('does not prepare a transaction when encrypted IPFS storage fails', async () => {
    const unavailable = new IngredientBatchService({
      ...dependencies,
      contentStore: {
        decrypt: vi.fn(),
        encryptAndStore: vi.fn().mockRejectedValue(new Error('pinning unavailable')),
      },
    });
    await expect(
      unavailable.prepare('test-session', {
        ...BODY,
        expiryDate: new Date(BODY.expiryDate),
        productionDate: new Date(BODY.productionDate),
      }),
    ).rejects.toMatchObject({ code: 'ENCRYPTED_STORAGE_UNAVAILABLE', status: 503 });
  });

  it('uploads only an AES-GCM encrypted credential envelope to the pinning service', async () => {
    const plaintext = JSON.stringify({ credential: { proof: { jwt: 'sensitive-jwt' } } });
    let uploaded = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = init.body as FormData;
        uploaded = await (body.get('file') as Blob).text();
        return {
          json: async () => ({ IpfsHash: 'bafy-encrypted-ingredient' }),
          ok: true,
          status: 200,
        };
      }),
    );
    const store = new IpfsEncryptedCredentialStore(
      Buffer.alloc(32, 7),
      'https://example.invalid/pinning',
      'test-token',
    );

    const stored = await store.encryptAndStore(plaintext, `0x${'12'.repeat(32)}`);

    expect(stored.cid).toBe('bafy-encrypted-ingredient');
    expect(uploaded).not.toContain('sensitive-jwt');
    expect(uploaded).not.toContain('credential');
    expect(await store.decrypt(stored.payload)).toBe(plaintext);
  });
});

function authorizedAuthService() {
  return {
    requireSession: async (sessionId: string | undefined) => {
      if (!sessionId)
        throw new AuthError('AUTHENTICATION_REQUIRED', 'Authentication is required.', 401);
      return {
        address: getAddress(SUPPLIER),
        onChainAuthorization: {
          checkedAt: new Date(),
          credentialHash: 'a'.repeat(64),
          role: CompanyRole.SUPPLIER,
          status: 'AUTHORIZED',
        },
        credentialVerification: {
          authorizationReady: true,
          credentialHash: 'a'.repeat(64),
          role: CompanyRole.SUPPLIER,
        },
        id: sessionId,
      };
    },
  } as unknown as AuthService;
}
