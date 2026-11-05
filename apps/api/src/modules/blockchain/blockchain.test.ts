import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import type { BlockchainGateway } from './blockchain-gateway.service.js';

const prepared = {
  chainId: 31_337,
  data: `0x${'12'.repeat(32)}`,
  to: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  value: '0x0' as const,
};

function testApp(gateway: BlockchainGateway) {
  return createApp({
    blockchainGateway: gateway,
    ssi: {
      agentProvider: async () => {
        throw new Error('SSI is not used by blockchain gateway tests.');
      },
      authorityDidAlias: 'unused',
    },
  });
}

describe('blockchain gateway API', () => {
  it('prepares a public company-application transaction without exposing configuration', async () => {
    const prepareApplication = vi.fn(() => prepared);
    const app = testApp({
      getApplicationForIssuance: vi.fn(async () => ({ applicant: prepared.to, requestedRole: 2, status: 1 })),
      listApplications: vi.fn(async () => []),
      prepareApplicationApproval: vi.fn(() => prepared),
      prepareApplication,
      prepareCredentialRegistration: vi.fn(() => prepared),
      prepareRejection: vi.fn(() => prepared),
    });
    const input = {
      applicationId: `0x${'11'.repeat(32)}`,
      encryptedProfileCid: 'urn:tracechain:application:test',
      previousApplicationId: `0x${'00'.repeat(32)}`,
      profileHash: `0x${'22'.repeat(32)}`,
      requestedRole: 2,
    };

    const response = await request(app)
      .post('/api/blockchain/transactions/company-application')
      .send(input)
      .expect(200);

    expect(prepareApplication).toHaveBeenCalledWith(input);
    expect(response.body).toEqual(prepared);
  });

  it('rejects malformed transaction preparation input', async () => {
    const app = testApp({
      getApplicationForIssuance: vi.fn(async () => ({ applicant: prepared.to, requestedRole: 2, status: 1 })),
      listApplications: vi.fn(async () => []),
      prepareApplication: vi.fn(() => prepared),
      prepareApplicationApproval: vi.fn(() => prepared),
      prepareCredentialRegistration: vi.fn(() => prepared),
      prepareRejection: vi.fn(() => prepared),
    });
    const response = await request(app)
      .post('/api/blockchain/transactions/company-application')
      .send({ requestedRole: 9 })
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  it('protects administrator reads and rejection preparation', async () => {
    const app = testApp({
      getApplicationForIssuance: vi.fn(async () => ({ applicant: prepared.to, requestedRole: 2, status: 1 })),
      listApplications: vi.fn(async () => []),
      prepareApplication: vi.fn(() => prepared),
      prepareApplicationApproval: vi.fn(() => prepared),
      prepareCredentialRegistration: vi.fn(() => prepared),
      prepareRejection: vi.fn(() => prepared),
    });
    expect((await request(app).get('/api/blockchain/applications').expect(403)).body.error.code)
      .toBe('ADMIN_AUTHORIZATION_REQUIRED');
    expect((await request(app).post('/api/blockchain/transactions/application-rejection').send({}).expect(403)).body.error.code)
      .toBe('ADMIN_AUTHORIZATION_REQUIRED');
  });
});
