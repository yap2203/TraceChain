import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { Wallet, id } from 'ethers';
import { companyApplicationBindingMessage } from '@tracechain/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ApplicationDocuments,
  applicationDocumentsRouter,
  applicationDocumentsSchema,
} from './application-documents.js';
import { IpfsEncryptedCredentialStore } from '../ssi/encrypted-credential.store.js';
import { BlockchainController } from './blockchain.controller.js';
import { createBlockchainRouter } from './blockchain.routes.js';

const owner = Wallet.createRandom(),
  admin = Wallet.createRandom(),
  stranger = Wallet.createRandom();
const applicationId = id('documents-test');
const files = ['registrationProof', 'businessProof', 'authorisationProof'].map((kind) => ({
  kind: kind as 'registrationProof' | 'businessProof' | 'authorisationProof',
  fileName: `${kind}.pdf`,
  mimeType: 'application/pdf' as const,
  data: Buffer.from('%PDF-1.7\nprivate applicant document').toString('base64'),
}));
let directory: string, path: string, service: ApplicationDocuments, app: express.Express;
let current: string | undefined, activeAdmin: boolean;
let auth: any, gateway: any, store: IpfsEncryptedCredentialStore;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tracechain-documents-'));
  path = join(directory, 'documents.json');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ IpfsHash: 'b' + 'a'.repeat(58) }))),
  );
  store = new IpfsEncryptedCredentialStore(
    Buffer.alloc(32, 7),
    'https://pin.invalid',
    'test-token',
  );
  service = new ApplicationDocuments(path, () => store);
  current = owner.address;
  activeAdmin = true;
  auth = {
    requireSession: async () => {
      if (!current) throw Object.assign(new Error(), { code: 'AUTHENTICATION_REQUIRED' });
      return {
        address: current,
        onChainAuthorization: {
          status: activeAdmin ? 'AUTHORIZED' : 'REVOKED',
          role: current === admin.address ? 'SYSTEM_ADMIN' : 'SUPPLIER',
        },
      };
    },
  };
  gateway = {
    listApplications: async () => [
      { id: applicationId, applicant: owner.address, status: 'pending' },
    ],
    getAdministrator: async () => admin.address,
  };
  app = express()
    .use(cookieParser())
    .use(express.json())
    .use('/api/blockchain', applicationDocumentsRouter(service, auth, gateway, 'session'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

it('encrypts uploads before pinning/persistence, survives restart, and returns exact authorized bytes', async () => {
  await request(app)
    .post(`/api/blockchain/applications/${applicationId}/documents`)
    .send({ documents: files })
    .expect(200);
  const disk = await readFile(path, 'utf8');
  expect(disk).not.toContain('private applicant document');
  expect(disk).not.toContain(files[0].data);
  const upload = (vi.mocked(fetch).mock.calls[0]![1]!.body as FormData).get('file') as Blob;
  expect(await upload.text()).not.toContain(files[0].data);
  expect(
    await new ApplicationDocuments(path, () => store).read(applicationId, owner.address),
  ).toEqual(files);
  const list = await request(app)
    .get(`/api/blockchain/applications/${applicationId}/documents`)
    .expect(200);
  expect(list.body.documents).toHaveLength(3);
  expect(JSON.stringify(list.body)).not.toContain(files[0].data);
  const response = await request(app)
    .get(`/api/blockchain/applications/${applicationId}/documents/0`)
    .expect(200);
  expect(response.body.toString()).toBe(Buffer.from(files[0].data, 'base64').toString());
  expect(response.headers['cache-control']).toContain('no-store');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
});
it('allows applicant and current Admin review, denies other companies and inactive Admin', async () => {
  await service.save(applicationId, owner.address, files);
  current = admin.address;
  await request(app).get(`/api/blockchain/applications/${applicationId}/documents/0`).expect(200);
  await request(app)
    .post(`/api/blockchain/applications/${applicationId}/documents`)
    .send({ documents: files })
    .expect(403);
  current = stranger.address;
  await request(app).get(`/api/blockchain/applications/${applicationId}/documents`).expect(404);
  await request(app).get(`/api/blockchain/applications/${applicationId}/documents/0`).expect(404);
  expect(
    (await request(app).get('/api/blockchain/applications/documents/me')).body.applications,
  ).toEqual([]);
  current = admin.address;
  activeAdmin = false;
  await request(app).get(`/api/blockchain/applications/${applicationId}/documents/0`).expect(404);
  current = undefined;
  await request(app).get(`/api/blockchain/applications/${applicationId}/documents`).expect(401);
});
it('permits a pending applicant to attach missing legacy documents without overwriting a saved set', async () => {
  expect(
    (await request(app).get(`/api/blockchain/applications/${applicationId}/documents`)).body
      .documents,
  ).toEqual([]);
  await request(app)
    .post(`/api/blockchain/applications/${applicationId}/documents`)
    .send({ documents: files })
    .expect(200);
  await request(app)
    .post(`/api/blockchain/applications/${applicationId}/documents`)
    .send({ documents: files })
    .expect(200);
  await request(app)
    .post(`/api/blockchain/applications/${applicationId}/documents`)
    .send({ documents: files.map((f) => ({ ...f, fileName: 'changed.pdf' })) })
    .expect(409);
  await request(app).get(`/api/blockchain/applications/${applicationId}/documents/3`).expect(404);
});
it('rejects missing, duplicate, forged-type, path-injection and oversized documents', () => {
  for (const invalid of [
    files.slice(0, 1),
    [files[0], files[0], files[2]],
    files.map((f) => ({ ...f, data: Buffer.from('<script>bad</script>').toString('base64') })),
    files.map((f) => ({ ...f, fileName: '../private.pdf' })),
    files.map((f) => ({ ...f, data: 'A'.repeat(13981020) })),
  ])
    expect(applicationDocumentsSchema.safeParse(invalid).success).toBe(false);
});
it('fails safely if encrypted storage is unavailable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 403 })),
  );
  const response = await request(app)
    .post(`/api/blockchain/applications/${applicationId}/documents`)
    .send({ documents: files })
    .expect(503);
  expect(response.body.error.message).not.toContain('pin.invalid');
  expect(await service.read(applicationId, owner.address)).toEqual([]);
});
it('binds registration document bytes to the applicant signature and keeps them out of transaction calldata', async () => {
  const prepareApplication = vi.fn(() => ({ data: '0x', chainId: 31337 }));
  const controller = new BlockchainController(
    { ...gateway, prepareApplication } as any,
    auth,
    'session',
    { save: async () => undefined } as any,
    {} as any,
    undefined,
    undefined,
    service,
  );
  const registration = express().use(express.json()).use(createBlockchainRouter(controller));
  const input = {
    applicationId,
    applicantWallet: owner.address,
    companyName: 'Test',
    companyRegistrationNumber: 'TEST-1',
    encryptedProfileCid: 'local://test',
    previousApplicationId: id('previous'),
    profileHash: id('profile'),
    requestedRole: 2,
    documents: files,
  };
  const signature = await owner.signMessage(
    companyApplicationBindingMessage({ ...input, documentsDigest: id(JSON.stringify(files)) }),
  );
  await request(registration)
    .post('/transactions/company-application')
    .send({
      ...input,
      applicantSignature: signature,
      documents: files.map((f) => ({ ...f, fileName: 'substituted.pdf' })),
    })
    .expect(403);
  await request(registration)
    .post('/transactions/company-application')
    .send({ ...input, applicantSignature: signature })
    .expect(200);
  expect(prepareApplication.mock.calls[0]![0]).not.toHaveProperty('documents');
  expect(await service.read(applicationId, owner.address)).toEqual(files);
});
