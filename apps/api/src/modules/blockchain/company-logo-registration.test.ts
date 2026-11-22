import express from 'express';
import request from 'supertest';
import { CompanyRole, companyApplicationBindingMessage } from '@tracechain/shared';
import { id, Wallet } from 'ethers';
import { describe, expect, it, vi } from 'vitest';

import type { AuthService } from '../auth/auth.service.js';
import { createOrdersRouter } from '../orders/orders.routes.js';
import { OrdersService } from '../orders/orders.service.js';
import type { OrdersGateway } from '../orders/orders.gateway.js';
import type { ProductionFlowRepository } from '../production-flow/production-flow.repository.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { CompanyRoleIssuanceRepository } from '../ssi/issuance.repository.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import {
  ApplicationMetadataConflictError,
  type ApplicationMetadata,
  type ApplicationMetadataRepository,
} from './application-metadata.repository.js';
import { BlockchainController } from './blockchain.controller.js';
import type { BlockchainGateway } from './blockchain-gateway.service.js';
import { createBlockchainRouter } from './blockchain.routes.js';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const zeroHash = `0x${'0'.repeat(64)}`;

describe('company application ownership and logos', () => {
  it('accepts signed registration with and without a logo and keeps identical retries idempotent', async () => {
    const fixture = createFixture();
    const logo = { data: png, fileName: 'company.png', mimeType: 'image/png' as const };
    const withLogo = await signedSubmission(fixture.applicant, { logo });

    await request(fixture.app)
      .post('/api/blockchain/transactions/company-application')
      .send(withLogo)
      .expect(200);
    await request(fixture.app)
      .post('/api/blockchain/transactions/company-application')
      .send(withLogo)
      .expect(200);
    expect(fixture.metadata.size).toBe(1);
    expect(fixture.presentationRecords.size).toBe(1);

    const withoutLogo = await signedSubmission(fixture.applicant, {
      applicationId: id('application-without-logo'),
      companyName: 'No Logo Company',
      companyRegistrationNumber: 'REG-2',
      encryptedProfileCid: `local://${id('profile-without-logo')}`,
      profileHash: id('profile-without-logo'),
    });
    await request(fixture.app)
      .post('/api/blockchain/transactions/company-application')
      .send(withoutLogo)
      .expect(200);
    expect(fixture.metadata.size).toBe(2);

    const applications = await request(fixture.app).get('/api/blockchain/applications').expect(200);
    expect(applications.body.applications[0].pendingLogoPath).toBe(
      `/api/blockchain/applications/${withLogo.applicationId}/logo`,
    );
    await request(fixture.app)
      .get(`/api/blockchain/applications/${withLogo.applicationId}/logo`)
      .expect(200)
      .expect('Content-Type', 'image/png');

    await request(fixture.app)
      .get(`/api/orders/branding/${fixture.applicant.address}/logo`)
      .expect(404);
    fixture.activeApplicationId = id('different-application');
    await request(fixture.app)
      .get(`/api/orders/branding/${fixture.applicant.address}/logo`)
      .expect(404);
    fixture.activeApplicationId = withLogo.applicationId;
    await request(fixture.app)
      .get(`/api/orders/branding/${fixture.applicant.address}/logo`)
      .expect(200)
      .expect('Content-Type', 'image/png');
  });

  it('rejects tampering, forged ownership and invalid image bytes without persisting records', async () => {
    const tampered = createFixture();
    const signed = await signedSubmission(tampered.applicant);
    await request(tampered.app)
      .post('/api/blockchain/transactions/company-application')
      .send({ ...signed, companyName: 'Changed after signing' })
      .expect(403);
    expect(tampered.metadata.size).toBe(0);
    expect(tampered.presentationRecords.size).toBe(0);

    const forged = createFixture();
    const forgedBody = await signedSubmission(Wallet.createRandom(), {
      applicantWallet: forged.applicant.address,
    });
    await request(forged.app)
      .post('/api/blockchain/transactions/company-application')
      .send(forgedBody)
      .expect(403);
    expect(forged.metadata.size).toBe(0);

    const invalidImage = createFixture();
    const invalidLogo = {
      data: Buffer.from('not a PNG').toString('base64'),
      fileName: 'company.png',
      mimeType: 'image/png' as const,
    };
    const invalidBody = await signedSubmission(invalidImage.applicant, { logo: invalidLogo });
    await request(invalidImage.app)
      .post('/api/blockchain/transactions/company-application')
      .send(invalidBody)
      .expect(400);
    expect(invalidImage.metadata.size).toBe(0);
    expect(invalidImage.presentationRecords.size).toBe(0);
  });

  it('rejects a conflicting signed retry even when it reuses the same profile hash', async () => {
    const fixture = createFixture();
    const original = await signedSubmission(fixture.applicant);
    await request(fixture.app)
      .post('/api/blockchain/transactions/company-application')
      .send(original)
      .expect(200);
    const conflicting = await signedSubmission(fixture.applicant, {
      companyName: 'Conflicting Company Name',
      profileHash: original.profileHash,
      encryptedProfileCid: original.encryptedProfileCid,
    });
    await request(fixture.app)
      .post('/api/blockchain/transactions/company-application')
      .send(conflicting)
      .expect(409);
    expect(fixture.metadata.get(original.applicationId.toLowerCase())?.companyName).toBe(
      original.companyName,
    );
  });
});

function createFixture() {
  const applicant = Wallet.createRandom();
  const administrator = Wallet.createRandom();
  const presentationRecords = new Map<string, any>();
  const metadata = new Map<string, ApplicationMetadata>();
  const repository = {
    findPrivate: vi.fn(async (_kind, key) => presentationRecords.get(key)),
    savePrivate: vi.fn(async (_kind, record) => presentationRecords.set(record.id, record)),
  } as unknown as ProductionFlowRepository;
  const store = {
    encryptAndStore: vi.fn(async (serialized: string) => ({
      cid: 'encrypted-logo',
      payload: { ciphertext: serialized },
    })),
    decrypt: vi.fn(async (payload: any) => payload.ciphertext),
  } as unknown as CredentialContentStore;
  const applicationMetadata = {
    find: vi.fn(async (key: string) => metadata.get(key.toLowerCase())),
    save: vi.fn(async (record: ApplicationMetadata) => {
      const key = record.applicationId.toLowerCase();
      const existing = metadata.get(key);
      if (existing && existing.submissionDigest !== record.submissionDigest)
        throw new ApplicationMetadataConflictError();
      if (!existing) metadata.set(key, record);
    }),
  } as ApplicationMetadataRepository;
  const auth = {
    getSession: vi.fn(async () => ({
      authenticated: true,
      authorizationReady: true,
      address: administrator.address,
      role: CompanyRole.SYSTEM_ADMIN,
    })),
  } as unknown as AuthService;
  const fixture: { activeApplicationId?: string } = {};
  const directory = {
    resolve: vi.fn(async (wallet: string) =>
      fixture.activeApplicationId && wallet.toLowerCase() === applicant.address.toLowerCase()
        ? {
            active: true as const,
            applicationId: fixture.activeApplicationId,
            companyName: 'Applicant Company',
            role: CompanyRole.SUPPLIER,
            walletAddress: applicant.address,
          }
        : null,
    ),
    resolveMany: vi.fn(async () => []),
    list: vi.fn(async () => []),
  } as unknown as StakeholderDirectory;
  const orders = new OrdersService(
    auth,
    {
      chainId: 31337,
      address: administrator.address,
      read: vi.fn(async (_contract: string, method: string) => {
        if (method === 'getCompanyBranding')
          return { contentHash: zeroHash, encryptedCid: '', updatedAt: '0' };
        throw Object.assign(new Error(`Unexpected contract read: ${method}`), {
          code: 'CALL_EXCEPTION',
          data: '0x',
        });
      }),
    } as unknown as OrdersGateway,
    store,
    repository,
    undefined,
    undefined,
    directory,
    undefined,
    applicationMetadata,
  );
  const applicationId = id('application');
  const gateway = {
    listApplications: vi.fn(async () => [
      {
        applicant: applicant.address,
        encryptedProfileCid: `local://${id('profile')}`,
        id: applicationId,
        previousApplicationId: zeroHash,
        profileHash: id('profile'),
        requestedRole: 'Supplier',
        status: 'pending',
        submittedAt: 1,
        updatedAt: 1,
      },
    ]),
    prepareApplication: vi.fn(() => ({
      chainId: 31337,
      data: '0x1234',
      to: administrator.address,
      value: '0x0',
    })),
  } as unknown as BlockchainGateway;
  const controller = new BlockchainController(
    gateway,
    auth,
    'session',
    applicationMetadata,
    {} as CompanyRoleIssuanceRepository,
    directory,
    {
      validatePendingCompanyLogo: (input) => orders.validatePendingCompanyLogo(input),
      savePendingCompanyLogo: (input) => orders.savePendingCompanyLogo(input),
      hasPendingCompanyLogo: (key, wallet) => orders.hasPendingCompanyLogo(key, wallet),
      pendingCompanyLogo: (key, wallet) => orders.pendingCompanyLogo(key, wallet),
    },
  );
  const app = express();
  app.use('/api/blockchain', express.json({ limit: '4mb' }), createBlockchainRouter(controller));
  app.use(
    '/api/orders',
    express.json({ limit: '4mb' }),
    createOrdersRouter(() => orders, 'session'),
  );
  return Object.assign(fixture, {
    app,
    applicant,
    applicationId,
    metadata,
    presentationRecords,
  });
}

async function signedSubmission(
  signer: Wallet,
  overrides: Partial<{
    applicationId: string;
    applicantWallet: string;
    companyName: string;
    companyRegistrationNumber: string;
    encryptedProfileCid: string;
    initialLocationName: string;
    logo: { data: string; fileName: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' };
    previousApplicationId: string;
    profileHash: string;
    requestedRole: number;
  }> = {},
) {
  const profileHash = overrides.profileHash ?? id('profile');
  const input = {
    applicationId: overrides.applicationId ?? id('application'),
    applicantWallet: overrides.applicantWallet ?? signer.address,
    companyName: overrides.companyName ?? 'Applicant Company',
    companyRegistrationNumber: overrides.companyRegistrationNumber ?? 'REG-1',
    encryptedProfileCid: overrides.encryptedProfileCid ?? `local://${profileHash}`,
    initialLocationName: overrides.initialLocationName ?? 'Main warehouse',
    previousApplicationId: overrides.previousApplicationId ?? zeroHash,
    profileHash,
    requestedRole: overrides.requestedRole ?? 2,
    ...(overrides.logo ? { logo: overrides.logo } : {}),
  };
  const applicantSignature = await signer.signMessage(
    companyApplicationBindingMessage({
      ...input,
      logoDigest: input.logo ? id(`${input.logo.mimeType}:${input.logo.data}`) : undefined,
      logoFileName: input.logo?.fileName,
      logoMimeType: input.logo?.mimeType,
    }),
  );
  return { ...input, applicantSignature };
}
