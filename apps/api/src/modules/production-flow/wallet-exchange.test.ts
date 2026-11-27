import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Wallet, id, encodeBytes32String } from 'ethers';
import { SDJwtInstance } from '@sd-jwt/core';
import { CompanyRole, WALLET_VP_FORMAT, walletProofData } from '@tracechain/shared';
import {
  createTraceChainAgent,
  createOrGetAuthorityDid,
  issueCompanyRoleCredential,
  issueIngredientSdJwt,
  type TraceChainAgent,
} from '@tracechain/ssi';
import { IpfsEncryptedCredentialStore } from '../ssi/encrypted-credential.store.js';
import { JsonProductionFlowRepository } from './production-flow.repository.js';
import { ProductionFlowService } from './production-flow.service.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Server } from 'node:http';
import { ProductionFlowController } from './production-flow.controller.js';
import { createProductionFlowRouter } from './production-flow.routes.js';
import type { CompanyProofReference, CompanyProofReferences } from './company-proof.gateway.js';

const sha = (v: string) => '0x' + createHash('sha256').update(v).digest('hex');
let directory: string;
const servers: Server[] = [];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tc-two-api-wallet-'));
});
afterEach(async () => {
  for (const server of servers.splice(0))
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
async function serve(service: ProductionFlowService) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    '/api/production-flow',
    createProductionFlowRouter(new ProductionFlowController(service, 'test-session')),
  );
  const server = app.listen(0);
  servers.push(server);
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
  return server;
}
async function setup() {
  const supplier = Wallet.createRandom(),
    manufacturer = Wallet.createRandom(),
    retailer = Wallet.createRandom(),
    distributor = Wallet.createRandom(),
    stranger = Wallet.createRandom();
  const now = Math.floor(Date.now() / 1000),
    expires = now + 3600;
  const domain = { chainId: 31337, verifyingContract: Wallet.createRandom().address };
  const companyDomain = { chainId: 31337, verifyingContract: Wallet.createRandom().address };
  const ipfs = new Map<string, any>();
  let cidNumber = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const cid =
          'b' +
          'a'.repeat(24) +
          String.fromCharCode(97 + Math.floor(cidNumber / 26), 97 + (cidNumber++ % 26));
        const file = (options.body as FormData).get('file') as File;
        ipfs.set(cid, JSON.parse(await file.text()));
        return new Response(JSON.stringify({ IpfsHash: cid }), { status: 200 });
      }
      const value = ipfs.get(String(url).split('/').at(-1)!);
      return new Response(JSON.stringify(value), { status: value ? 200 : 404 });
    }),
  );
  const store = new IpfsEncryptedCredentialStore(
    Buffer.alloc(32, 7),
    'https://pinning.invalid',
    'synthetic-test-token',
    'https://gateway.invalid/ipfs',
  );
  async function agent(name: string) {
    return createTraceChainAgent({
      chainId: 11155111,
      networkName: 'sepolia',
      rpcUrl: 'https://rpc.invalid',
      kmsSecretKey: '4'.repeat(64),
      publicStorePath: join(directory, name, 'metadata.json'),
      privateKeyStorePath: join(directory, name, 'keys.json'),
      resolverOverrides: {
        ethr: async (did, parsed) => {
          const key = parsed.id.split(':').at(-1)!;
          const method = did + '#controllerKey';
          return {
            didDocument: {
              id: did,
              verificationMethod: [
                {
                  id: method,
                  controller: did,
                  publicKeyHex: key.slice(2),
                  type: 'EcdsaSecp256k1VerificationKey2019',
                },
              ],
              assertionMethod: [method],
              authentication: [method],
            },
            didDocumentMetadata: {},
            didResolutionMetadata: {},
          };
        },
      },
    });
  }
  const agentA = await agent('issuer-A'),
    agentB = await agent('verifier-B');
  const issuerDid = (await createOrGetAuthorityDid(agentA, 'authority')).identifier.did;
  const roles = new Map([
    [supplier.address, CompanyRole.SUPPLIER],
    [manufacturer.address, CompanyRole.MANUFACTURER],
    [retailer.address, CompanyRole.RETAILER],
    [distributor.address, CompanyRole.DISTRIBUTOR],
  ]);
  const companyRefs = new Map<string, { credentialHash: string; credentialCid: string }>();
  for (const [wallet, role] of roles) {
    const issued = await issueCompanyRoleCredential(agentA, {
      applicationReference: id('application:' + wallet),
      companyId: 'CO-' + wallet.slice(2, 6),
      companyName: 'Signed ' + role,
      companyRegistrationNumber: 'REG-' + wallet.slice(2, 6),
      registrationCountry: 'MY',
      issuerDid,
      subjectDid: `did:ethr:sepolia:${wallet}`,
      walletAddress: wallet,
      role,
      issuerOperatorWallet: supplier.address,
      issuerOperatorChainId: 31337,
      issuanceDate: new Date((now - 10) * 1000),
      expirationDate: new Date(expires * 1000),
    });
    const stored = await store.encryptAndStore(
      JSON.stringify(issued.credential),
      issued.credential.id,
    );
    companyRefs.set(wallet, {
      credentialHash: '0x' + issued.credentialHash,
      credentialCid: stored.cid,
    });
  }
  const batchId = id('ingredient-batch'),
    credentialId = id('urn:test:ingredient');
  const metadata = {
    batchId: 'ingredient-batch',
    ingredientName: 'Actual cocoa',
    supplierWallet: supplier.address,
  };
  const certificationId = '11111111-1111-4111-8111-111111111111',
    documentId = '22222222-2222-4222-8222-222222222222';
  const certKey = 'certification_' + certificationId.replaceAll('-', ''),
    docKey = 'certificationDocuments_' + documentId.replaceAll('-', '');
  const attachment = {
    fileName: 'authorized.pdf',
    mimeType: 'application/pdf',
    data: Buffer.from('%PDF-1.7\nTest authorized document\n%%EOF').toString('base64'),
  };
  const attachmentStored = await store.encryptAndStore(JSON.stringify(attachment), documentId);
  const attachmentHash = createHash('sha256')
    .update(Buffer.from(attachment.data, 'base64'))
    .digest('hex');
  const sdJwt = await issueIngredientSdJwt(agentA, {
    issuerDid,
    holderWallet: supplier.address,
    issuedAt: now - 1,
    expiresAt: expires,
    claims: {
      credentialId: 'urn:test:ingredient',
      batchId,
      batchReference: 'ingredient-batch',
      ingredientName: 'Actual cocoa',
      supplierWallet: supplier.address,
      [certKey]: {
        id: certificationId,
        name: 'Organic',
        issuer: 'Supplier-provided organization',
        reference: 'CERT-1',
        scope: 'This batch',
        scopeReference: 'ingredient-batch',
        noExpiry: true,
      },
      [docKey]: {
        certificationId,
        documents: [
          {
            id: documentId,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            size: Buffer.from(attachment.data, 'base64').length,
            sha256: attachmentHash,
            cid: attachmentStored.cid,
          },
        ],
      },
      supplierDid: `did:ethr:sepolia:${supplier.address}`,
      countryOfOrigin: 'Ghana',
      exactSourceFacility: 'Unselected confidential facility',
    },
  });
  const stored = await store.encryptAndStore(JSON.stringify({ sdJwt, metadata }), credentialId);
  const batch = {
    supplier: supplier.address,
    metadataHash: sha(JSON.stringify(metadata)),
    encryptedCid: stored.cid,
    credentialId,
    totalQuantity: '100',
    availableQuantity: '100',
    unit: encodeBytes32String('g'),
    producedAt: now - 1,
    expiresAt: expires,
    status: 1,
  };
  const credential = {
    credentialHash: sha(sdJwt),
    encryptedCid: stored.cid,
    credentialType: 2,
    issuer: supplier.address,
    subject: supplier.address,
    status: 1,
    expiresAt: expires,
  };
  const evidence = new Map<string, any>(),
    references = new Map<string, CompanyProofReference>(),
    bindings = new Map<string, any>();
  const pending = new Map<string, () => void>();
  let tx = 0;
  const prepare = (apply: () => void) => {
    const data = '0x' + (++tx).toString(16).padStart(8, '0');
    pending.set(data, apply);
    return { ...domain, to: domain.verifyingContract, value: '0x0' as const, data };
  };
  const apply = (transaction: any) => {
    pending.get(transaction.data)!();
  };
  const refs: CompanyProofReferences = {
    domain: companyDomain,
    get: async (key) => references.get(key),
    list: async (wallet) =>
      [...references]
        .filter(([, r]) => r.verifier === wallet || r.presenter === wallet)
        .map(([key]) => key),
    binding: async (wallet) => bindings.get(wallet) ?? { cid: '', sourceHash: '', contentHash: '' },
    prepare: (method, args) =>
      prepare(() => {
        const [key] = args as string[];
        if (method === 'request')
          references.set(key, {
            presenter: String(args[1]),
            verifier: activeVerifier!,
            challengeHash: String(args[2]),
            expiresAt: Number(args[3]),
            requestHash: String(args[4]),
            requestCid: String(args[5]),
            responseHash: '',
            responseCid: '',
            status: 1,
          });
        if (method === 'respond')
          Object.assign(references.get(key)!, {
            responseHash: args[2],
            responseCid: args[3],
            status: 2,
          });
        if (method === 'review') references.get(key)!.status = args[1] ? 4 : 3;
        if (method === 'registerBinding')
          bindings.set(activePresenter!, {
            sourceHash: args[0],
            contentHash: args[1],
            cid: args[2],
          });
      }),
  };
  let activeVerifier: string, activePresenter: string;
  const numbers = {
    [CompanyRole.SUPPLIER]: 2,
    [CompanyRole.MANUFACTURER]: 3,
    [CompanyRole.DISTRIBUTOR]: 4,
    [CompanyRole.RETAILER]: 5,
  };
  const revoked = new Set<string>();
  const gateway: any = {
    presentationDomain: () => domain,
    assertDeployment: async () => {},
    companyCredential: async (wallet: string) => companyRefs.get(wallet),
    getIngredient: async () => batch,
    getCredential: async () => credential,
    getEvidenceRequest: async (key: string) => evidence.get(key),
    listEvidenceRequestIds: async (wallet: string) =>
      [...evidence]
        .filter(([, r]) => r.supplier === wallet || r.requester === wallet)
        .map(([key]) => key),
    isRoleAuthorized: async (wallet: string, role: number) =>
      !revoked.has(wallet) && numbers[roles.get(wallet)!] === role,
    getAccess: async (wallet: string) => roles.has(wallet) && !revoked.has(wallet),
    hasPermission: async () => true,
    prepareEvidenceRequest: (input: any) =>
      prepare(() =>
        evidence.set(input.requestId, {
          ...input,
          requester: manufacturer.address,
          ingredientBatchId: input.batchId,
          status: 1,
          presentationCid: '',
          presentationHash: '',
          presentationExpiresAt: 0,
          updatedAt: now,
        }),
      ),
    prepareEvidenceResponse: (input: any) =>
      prepare(() =>
        Object.assign(evidence.get(input.requestId), {
          status: 2,
          presentationCid: input.presentationCid,
          presentationHash: input.presentationHash,
          presentationExpiresAt: input.expiresAt,
        }),
      ),
    getAccepted: async () => false,
  };
  const auth: any = {
    requireSession: async (wallet: string) => ({
      address: wallet,
      onChainAuthorization: {
        status: revoked.has(wallet) ? 'SUSPENDED' : 'AUTHORIZED',
        role: roles.get(wallet),
        credentialHash: companyRefs.get(wallet)?.credentialHash,
      },
    }),
  };
  function service(name: string, verifierAgent: TraceChainAgent) {
    return new ProductionFlowService({
      agentProvider: async () => verifierAgent,
      authService: auth,
      contentStore: store,
      gateway,
      ingredientRepository: {
        find: async () => undefined,
        listForSupplier: async () => [],
        save: async () => {},
      },
      repository: new JsonProductionFlowRepository(join(directory, name, 'workflows.json')),
      companyReferences: () => refs,
      walletCompanyExchange: true,
      validateDeliveryIdentity: async () => true,
    });
  }
  async function sign(material: any, signer: Wallet, selected: string[]) {
    const value = material.sdJwt ?? material.credential;
    const instance = new SDJwtInstance<Record<string, unknown>>({
      hashAlg: 'sha-256',
      hasher: async (v) =>
        Uint8Array.from(
          createHash('sha256')
            .update(typeof v === 'string' ? v : Buffer.from(v))
            .digest(),
        ),
    });
    const presentation = await instance.present(
      value,
      Object.fromEntries(selected.map((key) => [key, true])) as never,
    );
    const context = material.walletContext;
    const data = walletProofData(presentation, context);
    return JSON.stringify({
      format: WALLET_VP_FORMAT,
      presentation: presentation,
      proof: {
        context,
        signature: await signer.signTypedData(data.domain, data.types, data.value),
      },
    });
  }
  return {
    supplier,
    manufacturer,
    retailer,
    distributor,
    stranger,
    agentA,
    agentB,
    now,
    expires,
    batchId,
    service,
    apply,
    refs,
    evidence,
    store,
    revoked,
    credential,
    sign,
    certKey,
    docKey,
    documentId,
    attachment,
    setVerifier: (wallet: string) => {
      activeVerifier = wallet;
    },
    setPresenter: (wallet: string) => {
      activePresenter = wallet;
    },
  };
}

describe('Wallet exchange across independent API data directories', () => {
  it('stops HTTP API A, publishes through empty HTTP API B, then verifies on restarted A', async () => {
    const f = await setup();
    const a = await serve(f.service('HTTP-A', f.agentA));
    const prepared = await request(a)
      .post('/api/production-flow/evidence-requests/prepare')
      .set('Cookie', `test-session=${f.manufacturer.address}`)
      .send({
        operationId: crypto.randomUUID(),
        batchId: f.batchId,
        dueAt: new Date((f.now + 600) * 1000).toISOString(),
        claims: ['countryOfOrigin'],
        requiredClaims: ['countryOfOrigin'],
        reason: 'HTTP origin verification',
        policy: { policyVersion: 2, template: 'custom', allowUnknownAllergens: false },
      })
      .expect(200);
    f.apply(prepared.body.transaction);
    const key = prepared.body.requestId;
    await new Promise<void>((resolve) => a.close(() => resolve()));
    const b = await serve(f.service('HTTP-B', f.agentB));
    const decrypt = vi.spyOn(f.store, 'decrypt');
    decrypt.mockClear();
    await request(b)
      .get(`/api/production-flow/evidence-requests/${key}`)
      .set('Cookie', `test-session=${f.retailer.address}`)
      .expect(404);
    expect(decrypt).not.toHaveBeenCalled();
    const material = await request(b)
      .post(`/api/production-flow/evidence-requests/${key}/respond/prepare`)
      .set('Cookie', `test-session=${f.supplier.address}`)
      .expect(200);
    const presentation = await f.sign(material.body.holderSigning, f.supplier, ['countryOfOrigin']);
    const response = await request(b)
      .post(`/api/production-flow/evidence-requests/${key}/respond/prepare`)
      .set('Cookie', `test-session=${f.supplier.address}`)
      .send({ presentation })
      .expect(200);
    f.apply(response.body.transaction);
    const restarted = await serve(f.service('HTTP-A', f.agentA));
    const reviewed = await request(restarted)
      .get(`/api/production-flow/evidence-requests/${key}/review`)
      .set('Cookie', `test-session=${f.manufacturer.address}`)
      .expect(200);
    expect(reviewed.body.sharedClaims).not.toHaveProperty('exactSourceFacility');
    await request(restarted)
      .post(`/api/production-flow/evidence-requests/${key}/verify`)
      .set('Cookie', `test-session=${f.manufacturer.address}`)
      .expect(200);
    await expect(f.store.retrieveAndDecrypt('b' + 'z'.repeat(24))).rejects.toThrow();
  });
  it('accepts a response that withholds a required field and reports it as unmet', async () => {
    const f = await setup();
    const a = f.service('API-A', f.agentA);
    const prepared = await a.prepareEvidenceRequest(f.manufacturer.address, {
      operationId: crypto.randomUUID(),
      batchId: f.batchId,
      dueAt: new Date((f.now + 600) * 1000),
      claims: ['countryOfOrigin'],
      requiredClaims: ['countryOfOrigin'],
      reason: 'Origin check',
      policy: { policyVersion: 2, template: 'custom', allowUnknownAllergens: false },
    } as any);
    f.apply(prepared.transaction);
    const b = f.service('API-B', f.agentB);
    const material = await b.prepareEvidenceResponse(f.supplier.address, prepared.requestId);
    const presentation = await f.sign(material.holderSigning, f.supplier, []);
    const response = await b.prepareEvidenceResponse(f.supplier.address, prepared.requestId, {
      presentation,
    });
    f.apply(response.transaction);
    const view = await f
      .service('API-A', f.agentA)
      .reviewEvidence(f.manufacturer.address, prepared.requestId);
    expect(view.sharedClaims).not.toHaveProperty('countryOfOrigin');
    expect(view.unmetRequirements).toEqual([
      'Country of origin is required.',
    ]);
  });
  it('opens the request and responds on empty B, then verifies on restarted A without a holder kit', async () => {
    const f = await setup();
    let a: ProductionFlowService | undefined = f.service('API-A', f.agentA);
    const prepared = await a.prepareEvidenceRequest(f.manufacturer.address, {
      operationId: crypto.randomUUID(),
      batchId: f.batchId,
      dueAt: new Date((f.now + 600) * 1000),
      claims: ['countryOfOrigin'],
      requiredClaims: ['countryOfOrigin'],
      reason: 'Origin check',
      policy: { policyVersion: 2, template: 'custom', allowUnknownAllergens: false },
    } as any);
    f.apply(prepared.transaction);
    const requestId = prepared.requestId;
    a = undefined; // No API A workflow lookup or issuer signing agent is supplied to B.
    const b = f.service('API-B', f.agentB);
    await expect(b.getEvidenceDetails(f.stranger.address, requestId)).rejects.toMatchObject({
      status: 403,
    });
    const details = await b.getEvidenceDetails(f.supplier.address, requestId);
    expect(details.reason).toBe('Origin check');
    expect((await b.listEvidence(f.supplier.address)).requests).toHaveLength(1);
    const material = await b.prepareEvidenceResponse(f.supplier.address, requestId);
    const presentation = await f.sign(material.holderSigning, f.supplier, ['countryOfOrigin']);
    const response = await b.prepareEvidenceResponse(f.supplier.address, requestId, {
      presentation,
    });
    f.apply(response.transaction);
    const restartedA = f.service('API-A', f.agentA);
    const view = await restartedA.reviewEvidence(f.manufacturer.address, requestId);
    expect(view.sharedClaims.countryOfOrigin).toBe('Ghana');
    expect(view.sharedClaims).not.toHaveProperty('exactSourceFacility');
    expect(view.sharedClaims).not.toHaveProperty(f.docKey);
    await expect(
      restartedA.certificationDocument(f.manufacturer.address, requestId, f.documentId),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ACCESS_DENIED' });
    expect(view.verification.state).toBe('NOT_VERIFIED');
    await expect(
      restartedA.verifyEvidence(f.manufacturer.address, requestId),
    ).resolves.toHaveProperty('verifiedAt');
    expect(
      (await b.prepareEvidenceResponse(f.supplier.address, requestId, { presentation })).state,
    ).toBe('COMPLETE');
    expect(await f.agentB.didManagerFind()).toHaveLength(0);
  });
  it('retrieves only an explicitly shared signed attachment on empty B without a local file index', async () => {
    const f = await setup(),
      a = f.service('attachment-A', f.agentA);
    const prepared = await a.prepareEvidenceRequest(f.manufacturer.address, {
      operationId: crypto.randomUUID(),
      batchId: f.batchId,
      dueAt: new Date((f.now + 600) * 1000),
      claims: ['countryOfOrigin', 'certifications', 'certificationDocuments'],
      requiredClaims: ['countryOfOrigin'],
      reason: 'Review attached certification',
      policy: { policyVersion: 2, template: 'custom', allowUnknownAllergens: false },
    } as any);
    f.apply(prepared.transaction);
    const key = prepared.requestId!;
    const b = f.service('attachment-B', f.agentB);
    const material = await b.prepareEvidenceResponse(f.supplier.address, key);
    const presentation = await f.sign(material.holderSigning, f.supplier, [
      'countryOfOrigin',
      f.certKey,
      f.docKey,
    ]);
    const response = await b.prepareEvidenceResponse(f.supplier.address, key, { presentation });
    f.apply(response.transaction);
    await expect(
      b.certificationDocument(f.manufacturer.address, key, f.documentId),
    ).resolves.toEqual(f.attachment);
    await expect(
      b.certificationDocument(f.manufacturer.address, key, 'unselected-file'),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ACCESS_DENIED' });
    await expect(
      b.certificationDocument(f.retailer.address, key, f.documentId),
    ).rejects.toMatchObject({ status: 404 });
  });
  it.each([
    ['Manufacturer order', CompanyRole.MANUFACTURER, false],
    ['Retailer order', CompanyRole.RETAILER, false],
    ['Supplier delivery', CompanyRole.SUPPLIER, true],
    ['Manufacturer delivery', CompanyRole.MANUFACTURER, true],
  ] as const)(
    'recovers %s company request and response from chain/IPFS alone',
    async (_label, role, delivery) => {
      const f = await setup();
      const presenter =
        role === CompanyRole.SUPPLIER
          ? f.supplier
          : role === CompanyRole.RETAILER
            ? f.retailer
            : f.manufacturer;
      const verifier = delivery ? f.distributor : f.supplier;
      let a: ProductionFlowService | undefined = f.service('API-A', f.agentA);
      f.setPresenter(presenter.address);
      const binding = await a.prepareCompanyWalletBinding(presenter.address);
      f.apply(binding.transaction);
      f.setVerifier(verifier.address);
      const requestId = id('company-' + role + delivery);
      const result = await a.startOrderIdentity(verifier.address, {
        orderId: requestId,
        ...(delivery ? { deliveryOrderId: id('delivery') } : {}),
        buyer: presenter.address,
        seller: verifier.address,
        batchId: f.batchId,
        purpose: 'Review requesting company',
        expiresAt: f.now + 600,
        requiredClaims: ['companyName'],
        optionalClaims: ['companyId'],
        selectiveDisclosure: true,
      });
      f.apply(result.referenceTransaction);
      const stoppedA = await serve(a);
      await new Promise<void>((resolve) => stoppedA.close(() => resolve()));
      a = undefined;
      const b = f.service('API-B', f.agentB);
      expect(await b.listSharedCompanyRequests(presenter.address)).toHaveLength(1);
      const httpB = await serve(b);
      const base = `/api/production-flow/evidence-requests/${requestId}/company-identity`;
      const decrypt = vi.spyOn(f.store, 'decrypt');
      decrypt.mockClear();
      await request(httpB)
        .get(base + '/material')
        .set('Cookie', `test-session=${f.stranger.address}`)
        .expect(404);
      expect(decrypt).not.toHaveBeenCalled();
      const material = (
        await request(httpB)
          .get(base + '/material')
          .set('Cookie', `test-session=${presenter.address}`)
          .expect(200)
      ).body;
      expect(material.bindingTransaction).toBeUndefined();
      const presentation = await f.sign(material, presenter, material.requiredClaims!);
      const response = await request(httpB)
        .post(base + '/present')
        .set('Cookie', `test-session=${presenter.address}`)
        .send({ presentation })
        .expect(200);
      f.apply(response.body.transaction);
      const restartedA = f.service('API-A', f.agentA);
      const httpA = await serve(restartedA);
      const checked = (
        await request(httpA)
          .post(base + '/verify')
          .set('Cookie', `test-session=${verifier.address}`)
          .expect(200)
      ).body;
      f.apply(checked.transaction);
      expect(checked.credential).toHaveProperty('companyName');
      expect(checked.credential).not.toHaveProperty('companyId');
      expect(
        (await restartedA.getCompanyIdentityProofStatus(verifier.address, requestId)).status,
      ).toBe('VERIFIED');
      f.revoked.add(presenter.address);
      await expect(
        restartedA.verifyCompanyIdentityProof(verifier.address, requestId),
      ).rejects.toMatchObject({ code: 'COMPANY_CREDENTIAL_INACTIVE' });
      expect(await f.agentB.didManagerFind()).toHaveLength(0);
    },
  );
});
