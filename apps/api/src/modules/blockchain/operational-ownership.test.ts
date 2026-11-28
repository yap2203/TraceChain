import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { CompanyRole } from '@tracechain/shared';
import { BlockchainController } from './blockchain.controller.js';
import type { BlockchainGateway } from './blockchain-gateway.service.js';
import type { AuthService } from '../auth/auth.service.js';
import type { ApplicationMetadataRepository } from './application-metadata.repository.js';
import type { CompanyRoleIssuanceRepository } from '../ssi/issuance.repository.js';

const actor = '0x1000000000000000000000000000000000000001';
const other = '0x2000000000000000000000000000000000000002';
function fixture(role: CompanyRole, authorized = true, authorizationStatus?: string) {
  const data = {
    ingredientBatches: [
      { batchId: 'own-ingredient', supplier: actor },
      { batchId: 'foreign-ingredient', supplier: other },
    ],
    productBatches: [
      { batchId: 'own-product', manufacturer: actor },
      { batchId: 'foreign-product', manufacturer: other },
      { batchId: 'received-product', manufacturer: other },
    ],
    transfers: [
      { productBatchId: 'received-product', sender: other, recipient: actor },
      { productBatchId: 'foreign-product', sender: other, recipient: other },
    ],
    evidenceRequests: [
      { requestId: 'shared', requester: other, supplier: actor },
      { requestId: 'foreign', requester: other, supplier: other },
    ],
  };
  const gateway = { listOperationalData: vi.fn().mockResolvedValue(data) };
  const controller = new BlockchainController(
    gateway as unknown as BlockchainGateway,
    {
      getSession: vi.fn().mockResolvedValue({
        authenticated: authorized,
        authorizationReady: authorized && authorizationStatus !== 'UNAVAILABLE',
        authorizationStatus,
        address: actor,
        role,
      }),
    } as unknown as AuthService,
    'session',
    {} as ApplicationMetadataRepository,
    {} as CompanyRoleIssuanceRepository,
  );
  const app = express();
  app.get('/operational', controller.listOperationalData);
  return { app, gateway };
}
describe('operational resource ownership', () => {
  it('returns 503 rather than 403 when current authorization cannot be read', async () => {
    const f = fixture(CompanyRole.SUPPLIER, true, 'UNAVAILABLE');
    const response = await request(f.app).get('/operational').expect(503);
    expect(response.body.error.code).toBe('BLOCKCHAIN_AUTHORIZATION_UNAVAILABLE');
    expect(f.gateway.listOperationalData).not.toHaveBeenCalled();
  });
  it.each([CompanyRole.MANUFACTURER, CompanyRole.SUPPLIER])(
    'filters mixed gateway records before returning company management data: %s',
    async (role) => {
      const response = await request(fixture(role).app).get('/operational').expect(200);
      expect(response.headers['server-timing']).toContain('queue;dur=');
      expect(response.headers['server-timing']).toContain('ipfs;desc=');
      expect(response.body.actorWallet).toBe(actor);
      expect(response.body.productBatches.map((r: any) => r.batchId)).toEqual(['own-product']);
      expect(response.body.ingredientBatches.map((r: any) => r.batchId)).toEqual([
        'own-ingredient',
      ]);
      expect(response.body.transfers).toHaveLength(1);
      expect(response.body.evidenceRequests.map((r: any) => r.requestId)).toEqual(['shared']);
      expect(JSON.stringify(response.body)).not.toContain('foreign');
    },
  );
  it.each([CompanyRole.DISTRIBUTOR, CompanyRole.RETAILER])(
    'preserves downstream custody records but excludes unrelated products: %s',
    async (role) => {
      const response = await request(fixture(role).app).get('/operational').expect(200);
      expect(response.body.productBatches.map((r: any) => r.batchId)).toEqual([
        'own-product',
        'received-product',
      ]);
      expect(JSON.stringify(response.body)).not.toContain('foreign');
    },
  );
  it('preserves authorized administrator inspection', async () => {
    const response = await request(fixture(CompanyRole.SYSTEM_ADMIN).app)
      .get('/operational')
      .expect(200);
    expect(response.body.productBatches).toHaveLength(3);
  });
  it('does not read resources for an unauthorized session', async () => {
    const f = fixture(CompanyRole.MANUFACTURER, false);
    await request(f.app).get('/operational').expect(403);
    expect(f.gateway.listOperationalData).not.toHaveBeenCalled();
  });
  it('returns a readable 503 for RPC rate limits without exposing provider details', async () => {
    const f = fixture(CompanyRole.MANUFACTURER);
    f.gateway.listOperationalData.mockRejectedValueOnce(
      new Error('Too Many Requests: private-provider-details'),
    );
    const response = await request(f.app).get('/operational').expect(503);
    expect(response.body.error.code).toBe('BLOCKCHAIN_RATE_LIMITED');
    expect(response.body.error.message).toContain('Wait a moment');
    expect(JSON.stringify(response.body)).not.toContain('private-provider-details');
  });
  it('returns a readable 503 for unavailable operational reads', async () => {
    const f = fixture(CompanyRole.MANUFACTURER);
    f.gateway.listOperationalData.mockRejectedValueOnce(new Error('RPC unavailable'));
    const response = await request(f.app).get('/operational').expect(503);
    expect(response.body.error.code).toBe('OPERATIONAL_READS_UNAVAILABLE');
  });
});
