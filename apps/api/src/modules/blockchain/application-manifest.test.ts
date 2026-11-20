import {
  companyApplicationContentAuthorizationMessage,
  type CompanyApplicationContentAuthorization,
} from '@tracechain/shared';
import { Wallet, ZeroHash, decodeBase64, sha256 } from 'ethers';
import { describe, expect, it } from 'vitest';

import type {
  CredentialContentStore,
  EncryptedCredentialPayload,
} from '../ssi/encrypted-credential.store.js';
import type { ChainApplicationRecord } from './blockchain-gateway.service.js';
import { ApplicationManifestError, ApplicationManifestService } from './application-manifest.js';

const registry = '0x1000000000000000000000000000000000000001';
const documents = [
  file('registrationProof', 'registration.pdf', 'application/pdf', '%PDF-registration'),
  file('businessProof', 'business.pdf', 'application/pdf', '%PDF-business'),
  file('authorisationProof', 'authorisation.pdf', 'application/pdf', '%PDF-authorisation'),
];

describe('encrypted company application manifests', () => {
  it('lets a fresh backend resolve complete signed data, documents and an optional logo', async () => {
    const storage = memoryContentStore();
    const wallet = Wallet.createRandom();
    const applications: ChainApplicationRecord[] = [];
    const first = service(storage, applications);
    const input = await signedInput(wallet, { logo: pngLogo() });

    const prepared = await first.create(input);
    applications.push(chainRecord(prepared, wallet.address));

    const freshBackend = service(storage, applications);
    const resolved = await freshBackend.resolve(applications[0]!);
    expect(resolved.manifest.company).toMatchObject({
      businessAddress: '1 Supply Chain Road',
      companyName: 'Cross Device Manufacturing',
      companyRegistrationNumber: 'MY-2026-001',
    });
    expect(resolved.manifest.contact).toEqual({
      companyEmail: 'company@example.test',
      contactNumber: '+60123456789',
    });
    expect(resolved.manifest.representative).toEqual({
      name: 'A. Representative',
      position: 'Director',
    });
    expect(await freshBackend.readDocuments(applications[0]!)).toHaveLength(3);
    expect((await freshBackend.readLogo(applications[0]!)).bytes.length).toBeGreaterThan(20);
    expect(storage.values.size).toBe(5); // three documents, logo and manifest
  });

  it('reuses the authoritative manifest after a confirmed transaction instead of uploading again', async () => {
    const storage = memoryContentStore();
    const wallet = Wallet.createRandom();
    const applications: ChainApplicationRecord[] = [];
    const first = service(storage, applications);
    const input = await signedInput(wallet);
    const prepared = await first.create(input);
    applications.push(chainRecord(prepared, wallet.address));
    const before = storage.values.size;

    const retry = await service(storage, applications).create(input);

    expect(retry.encryptedProfileCid).toBe(prepared.encryptedProfileCid);
    expect(retry.profileHash).toBe(prepared.profileHash);
    expect(storage.values.size).toBe(before);
  });

  it.each([
    ['application', { id: `0x${'ee'.repeat(32)}` }],
    ['wallet', { applicant: Wallet.createRandom().address }],
    ['profile hash', { profileHash: `0x${'ff'.repeat(32)}` }],
    ['role', { requestedRole: 'Retailer' }],
    ['registry', {}, '0x2000000000000000000000000000000000000002'],
  ])('rejects a manifest with the wrong %s binding', async (_label, override, otherRegistry) => {
    const storage = memoryContentStore();
    const wallet = Wallet.createRandom();
    const applications: ChainApplicationRecord[] = [];
    const writer = service(storage, applications);
    const prepared = await writer.create(await signedInput(wallet));
    const application = { ...chainRecord(prepared, wallet.address), ...override };
    const reader = service(storage, [application], otherRegistry ?? registry);

    await expect(reader.resolve(application)).rejects.toBeInstanceOf(ApplicationManifestError);
  });

  it('rejects a manifest read through the wrong configured chain', async () => {
    const storage = memoryContentStore();
    const wallet = Wallet.createRandom();
    const applications: ChainApplicationRecord[] = [];
    const prepared = await service(storage, applications).create(await signedInput(wallet));
    const application = chainRecord(prepared, wallet.address);

    await expect(
      service(storage, [application], registry, 11_155_111).resolve(application),
    ).rejects.toMatchObject({ code: 'APPLICATION_CONTEXT_MISMATCH' });
  });

  it('reports a missing or incorrect decryption key without accepting unavailable content', async () => {
    const storage = memoryContentStore();
    const wallet = Wallet.createRandom();
    const applications: ChainApplicationRecord[] = [];
    const prepared = await service(storage, applications).create(await signedInput(wallet));
    const application = chainRecord(prepared, wallet.address);
    const wrongKeyStore = {
      ...storage,
      retrieveAndDecrypt: async () => {
        throw new Error('Unsupported state or unable to authenticate data');
      },
    };

    await expect(service(wrongKeyStore, [application]).resolve(application)).rejects.toMatchObject({
      code: 'APPLICATION_DECRYPTION_KEY_UNAVAILABLE',
    });
  });

  it('distinguishes unsupported legacy and unavailable encrypted references', async () => {
    const wallet = Wallet.createRandom();
    const storage = memoryContentStore();
    const reader = service(storage, []);
    const legacy = chainRecord(
      {
        applicationId: `0x${'11'.repeat(32)}`,
        encryptedProfileCid: `local://0x${'22'.repeat(32)}`,
        previousApplicationId: ZeroHash,
        profileHash: `0x${'22'.repeat(32)}`,
        requestedRole: 3,
      },
      wallet.address,
    );
    await expect(reader.resolve(legacy)).rejects.toMatchObject({ code: 'LEGACY_LOCAL_REFERENCE' });

    const missing = { ...legacy, encryptedProfileCid: `ipfs://b${'a'.repeat(50)}` };
    await expect(reader.resolve(missing)).rejects.toMatchObject({
      code: 'APPLICATION_CONTENT_UNAVAILABLE',
    });
  });
});

function service(
  contentStore: CredentialContentStore,
  applications: ChainApplicationRecord[],
  registryAddress = registry,
  chainId = 31_337,
) {
  return new ApplicationManifestService({ chainId, registryAddress }, contentStore, {
    listApplications: async () => applications,
  });
}

async function signedInput(wallet: Wallet, extra: Record<string, unknown> = {}) {
  const applicationId = `0x${'12'.repeat(32)}`;
  const submissionTime = '2026-11-20T14:00:00.000Z';
  const authorization: CompanyApplicationContentAuthorization = {
    applicationId,
    applicantWallet: wallet.address,
    businessAddress: '1 Supply Chain Road',
    chainId: 31_337,
    companyDid: 'did:ethr:31337:0x1234',
    companyEmail: 'company@example.test',
    companyName: 'Cross Device Manufacturing',
    companyRegistrationNumber: 'MY-2026-001',
    contactNumber: '+60123456789',
    declarationAcceptedAt: submissionTime,
    declarationVersion: 'tracechain-company-registration-v1',
    documents: documents.map(({ data, ...document }) => ({
      ...document,
      contentHash: sha256(decodeBase64(data)),
      size: decodeBase64(data).length,
    })),
    ...(extra.logo
      ? {
          logo: {
            contentHash: sha256(decodeBase64((extra.logo as { data: string }).data)),
            fileName: (extra.logo as { fileName: string }).fileName,
            kind: 'companyLogo',
            mimeType: (extra.logo as { mimeType: string }).mimeType,
            size: decodeBase64((extra.logo as { data: string }).data).length,
          },
        }
      : {}),
    previousApplicationId: ZeroHash,
    registryAddress: registry,
    registrationCountry: 'MY',
    representativeName: 'A. Representative',
    representativePosition: 'Director',
    requestedRole: 3,
    submissionTime,
  };
  return {
    applicationId,
    applicantWallet: wallet.address,
    businessAddress: authorization.businessAddress,
    companyDid: authorization.companyDid,
    companyEmail: authorization.companyEmail,
    companyName: authorization.companyName,
    companyRegistrationNumber: authorization.companyRegistrationNumber,
    contactNumber: authorization.contactNumber,
    contentAuthorizationSignature: await wallet.signMessage(
      companyApplicationContentAuthorizationMessage(authorization),
    ),
    declarationAcceptedAt: submissionTime,
    declarationVersion: authorization.declarationVersion,
    documents,
    previousApplicationId: ZeroHash,
    registrationCountry: 'MY',
    representativeName: authorization.representativeName,
    representativePosition: authorization.representativePosition,
    requestedRole: 3,
    submissionTime,
    ...extra,
  };
}

function chainRecord(prepared: any, applicant: string): ChainApplicationRecord {
  return {
    applicant,
    encryptedProfileCid: prepared.encryptedProfileCid,
    id: prepared.applicationId,
    previousApplicationId: prepared.previousApplicationId,
    profileHash: prepared.profileHash,
    requestedRole: prepared.requestedRole === 3 ? 'Manufacturer' : String(prepared.requestedRole),
    status: 'pending',
    submittedAt: 1,
    updatedAt: 1,
  };
}

function file(kind: string, fileName: string, mimeType: string, value: string) {
  return { data: Buffer.from(value).toString('base64'), fileName, kind, mimeType };
}

function pngLogo() {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  return { data: bytes.toString('base64'), fileName: 'logo.png', mimeType: 'image/png' };
}

function memoryContentStore(): CredentialContentStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  let sequence = 0;
  const payload: EncryptedCredentialPayload = {
    algorithm: 'aes-256-gcm',
    authTag: Buffer.alloc(16).toString('base64'),
    ciphertext: '',
    iv: Buffer.alloc(12).toString('base64'),
    version: 1,
  };
  return {
    values,
    decrypt: async () => '',
    encryptAndStore: async (serialized) => {
      const cid = `b${'a'.repeat(48)}${String.fromCharCode(97 + sequence++)}`;
      values.set(cid, serialized);
      return { cid, payload };
    },
    retrieveAndDecrypt: async (reference) => {
      const value = values.get(reference.replace(/^ipfs:\/\//, ''));
      if (!value) throw new Error('gateway unavailable');
      return value;
    },
  };
}
