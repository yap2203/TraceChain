import express from 'express';
import request from 'supertest';
import { CompanyRole, companyLogoBindingMessage } from '@tracechain/shared';
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
import type {
  ApplicationMetadata,
  ApplicationMetadataRepository,
} from './application-metadata.repository.js';
import { BlockchainController } from './blockchain.controller.js';
import type { BlockchainGateway } from './blockchain-gateway.service.js';
import { createBlockchainRouter } from './blockchain.routes.js';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('registration company logos', () => {
  it('binds a validated pending logo to the signed application and exposes it only after activation', async () => {
    const applicant = Wallet.createRandom();
    const other = Wallet.createRandom();
    const applicationId = id('application');
    const profileHash = id('profile');
    const logo = { data: png, fileName: 'company.png', mimeType: 'image/png' as const };
    const logoDigest = id(`${logo.mimeType}:${logo.data}`);
    const logoSignature = await applicant.signMessage(
      companyLogoBindingMessage({
        applicationId,
        applicantWallet: applicant.address,
        profileHash,
        logoDigest,
      }),
    );
    const records = new Map<string, any>();
    const metadata = new Map<string, ApplicationMetadata>();
    let activeApplicationId: string | undefined;
    const repository = {
      findPrivate: vi.fn(async (_kind, key) => records.get(key)),
      savePrivate: vi.fn(async (_kind, record) => records.set(record.id, record)),
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
        metadata.set(record.applicationId.toLowerCase(), record);
      }),
    } as ApplicationMetadataRepository;
    const auth = {
      getSession: vi.fn(async () => ({
        authenticated: true,
        authorizationReady: true,
        address: other.address,
        role: CompanyRole.SYSTEM_ADMIN,
      })),
    } as unknown as AuthService;
    const directory = {
      resolve: vi.fn(async (wallet: string) =>
        activeApplicationId && wallet.toLowerCase() === applicant.address.toLowerCase()
          ? {
              active: true as const,
              applicationId: activeApplicationId,
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
      { chainId: 31337, address: other.address } as unknown as OrdersGateway,
      store,
      repository,
      undefined,
      undefined,
      directory,
      undefined,
      applicationMetadata,
    );
    const chainApplications = [
      {
        applicant: applicant.address,
        encryptedProfileCid: `local://${profileHash}`,
        id: applicationId,
        previousApplicationId: `0x${'0'.repeat(64)}`,
        profileHash,
        requestedRole: 'Supplier',
        status: 'pending',
        submittedAt: 1,
        updatedAt: 1,
      },
    ];
    const gateway = {
      listApplications: vi.fn(async () => chainApplications),
      prepareApplication: vi.fn(() => ({
        chainId: 31337,
        data: '0x1234',
        to: other.address,
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
        savePendingCompanyLogo: (input) => orders.savePendingCompanyLogo(input),
        hasPendingCompanyLogo: (id, wallet) => orders.hasPendingCompanyLogo(id, wallet),
        pendingCompanyLogo: (id, wallet) => orders.pendingCompanyLogo(id, wallet),
      },
    );
    const app = express();
    app.use('/api/blockchain', express.json({ limit: '4mb' }), createBlockchainRouter(controller));
    app.use(
      '/api/orders',
      express.json({ limit: '4mb' }),
      createOrdersRouter(() => orders, 'session'),
    );

    await request(app)
      .post('/api/blockchain/transactions/company-application')
      .send({
        applicationId,
        applicantWallet: applicant.address,
        companyName: 'Applicant Company',
        companyRegistrationNumber: 'REG-1',
        encryptedProfileCid: `local://${profileHash}`,
        previousApplicationId: `0x${'0'.repeat(64)}`,
        profileHash,
        requestedRole: 2,
        logo,
        logoSignature,
      })
      .expect(200);

    await request(app)
      .post('/api/blockchain/transactions/company-application')
      .send({
        applicationId: id('application-without-logo'),
        companyName: 'No Logo Company',
        companyRegistrationNumber: 'REG-2',
        encryptedProfileCid: `local://${id('profile-without-logo')}`,
        previousApplicationId: `0x${'0'.repeat(64)}`,
        profileHash: id('profile-without-logo'),
        requestedRole: 2,
      })
      .expect(200);

    const applications = await request(app).get('/api/blockchain/applications').expect(200);
    expect(applications.body.applications[0].pendingLogoPath).toBe(
      `/api/blockchain/applications/${applicationId}/logo`,
    );
    await request(app)
      .get(`/api/blockchain/applications/${applicationId}/logo`)
      .expect(200)
      .expect('Content-Type', 'image/png');

    await request(app).get(`/api/orders/branding/${applicant.address}/logo`).expect(404);
    activeApplicationId = id('different-application');
    await request(app).get(`/api/orders/branding/${applicant.address}/logo`).expect(404);
    activeApplicationId = applicationId;
    const activated = await request(app)
      .get(`/api/orders/branding/${applicant.address}/logo`)
      .expect(200)
      .expect('Content-Type', 'image/png');
    expect(activated.body).toEqual(Buffer.from(png, 'base64'));
  });

  it('rejects forged bindings and image bytes that do not match the declared type', async () => {
    const applicant = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const applicationId = id('forged-application');
    const profileHash = id('forged-profile');
    const logo = { data: png, fileName: 'company.png', mimeType: 'image/png' as const };
    const service = new OrdersService(
      {} as AuthService,
      {} as OrdersGateway,
      {} as CredentialContentStore,
      {} as ProductionFlowRepository,
    );
    const forgedSignature = await attacker.signMessage(
      companyLogoBindingMessage({
        applicationId,
        applicantWallet: applicant.address,
        profileHash,
        logoDigest: id(`${logo.mimeType}:${logo.data}`),
      }),
    );
    await expect(
      service.savePendingCompanyLogo({
        applicationId,
        applicantWallet: applicant.address,
        profileHash,
        logo,
        logoSignature: forgedSignature,
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_LOGO_SIGNATURE_INVALID', status: 403 });
    await expect(
      service.savePendingCompanyLogo({
        applicationId,
        applicantWallet: applicant.address,
        profileHash,
        logo: {
          ...logo,
          data: Buffer.from('not a PNG').toString('base64'),
        },
        logoSignature: forgedSignature,
      }),
    ).rejects.toMatchObject({ code: 'IMAGE_INVALID', status: 400 });
  });
});
