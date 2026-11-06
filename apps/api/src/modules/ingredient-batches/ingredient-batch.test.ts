import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTraceChainAgent, type TraceChainAgent } from '@tracechain/ssi';
import { CompanyRole } from '@tracechain/shared';
import type { DIDResolver } from 'did-resolver';
import { Interface, computeAddress, getAddress, isAddress } from 'ethers';
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
