import express from 'express';
import request from 'supertest';
import { id, Interface } from 'ethers';
import { CompanyRole } from '@tracechain/shared';
import { describe, expect, it, vi } from 'vitest';
import { BlockchainController } from './blockchain.controller.js';
import { createBlockchainRouter } from './blockchain.routes.js';
import { BlockchainGatewayService, type BlockchainGateway } from './blockchain-gateway.service.js';
import type { AuthService } from '../auth/auth.service.js';
import type { ApplicationMetadataRepository } from './application-metadata.repository.js';
import type { CompanyRoleIssuanceRepository } from '../ssi/issuance.repository.js';

const account = '0x2000000000000000000000000000000000000002';
const prepared = { chainId: 31337, to: account, data: '0x1234', value: '0x0' };
function setup(role = CompanyRole.SYSTEM_ADMIN, status = 1, stakeholderRole = 2) {
  const gateway = {
    getStakeholder: vi.fn().mockResolvedValue({ role: stakeholderRole, status }),
    getRolePermission: vi.fn().mockResolvedValue(true),
    getPersonalPermission: vi.fn().mockResolvedValue({ setting: 2, effective: false }),
    preparePersonalPermission: vi.fn().mockReturnValue(prepared),
  };
  const controller = new BlockchainController(
    gateway as unknown as BlockchainGateway,
    {
      getSession: vi
        .fn()
        .mockResolvedValue({ authenticated: true, authorizationReady: true, role }),
    } as unknown as AuthService,
    'session',
    {} as ApplicationMetadataRepository,
    {} as CompanyRoleIssuanceRepository,
  );
  const app = express();
  app.use(express.json());
  app.use('/api/blockchain', createBlockchainRouter(controller));
  return { app, gateway };
}

describe('individual permissions', () => {
  it('reads current wallet overrides, defaults and effective chain access separately', async () => {
    const { app, gateway } = setup();
    const response = await request(app)
      .get(`/api/blockchain/personal-permissions/${account}`)
      .expect(200);
    expect(response.body.permissions).toHaveLength(6);
    expect(response.body.permissions[0]).toMatchObject({
      name: 'REGISTER_INGREDIENT',
      roleAllowed: true,
      setting: 2,
      effective: false,
    });
    expect(gateway.getPersonalPermission).toHaveBeenCalledWith(account, id('REGISTER_INGREDIENT'));
  });
  it('prepares only unsigned wallet-scoped changes for an authorized administrator', async () => {
    const { app, gateway } = setup();
    const input = { account, permission: id('REGISTER_INGREDIENT'), setting: 0 };
    expect(
      (
        await request(app)
          .post('/api/blockchain/transactions/personal-permission')
          .send(input)
          .expect(200)
      ).body,
    ).toEqual(prepared);
    expect(gateway.preparePersonalPermission).toHaveBeenCalledWith(input);
  });
  it('denies company access to both read and write administration endpoints', async () => {
    const { app, gateway } = setup(CompanyRole.SUPPLIER);
    await request(app).get(`/api/blockchain/personal-permissions/${account}`).expect(403);
    await request(app)
      .post('/api/blockchain/transactions/personal-permission')
      .send({ account, permission: id('REGISTER_INGREDIENT'), setting: 1 })
      .expect(403);
    expect(gateway.getPersonalPermission).not.toHaveBeenCalled();
    expect(gateway.preparePersonalPermission).not.toHaveBeenCalled();
  });
  it.each([
    { account: 'invalid', permission: id('REGISTER_INGREDIENT'), setting: 1 },
    { account, permission: id('REGISTER_INGREDIENT'), setting: 3 },
    { account, permission: id('UNKNOWN_PERMISSION'), setting: 1 },
    { account, permission: id('REGISTER_INGREDIENT'), setting: 1, extra: true },
  ])('rejects malformed or unsupported settings', async (input) => {
    const { app, gateway } = setup();
    await request(app)
      .post('/api/blockchain/transactions/personal-permission')
      .send(input)
      .expect(400);
    expect(gateway.preparePersonalPermission).not.toHaveBeenCalled();
  });
  it.each([
    [3, 2],
    [0, 0],
    [1, 1],
  ])('rejects revoked, unknown and Admin targets', async (status, role) => {
    const { app, gateway } = setup(CompanyRole.SYSTEM_ADMIN, status, role);
    await request(app)
      .post('/api/blockchain/transactions/personal-permission')
      .send({ account, permission: id('REGISTER_INGREDIENT'), setting: 1 })
      .expect(409);
    expect(gateway.preparePersonalPermission).not.toHaveBeenCalled();
  });
  it('encodes the selected wallet, permission and override into actual contract calldata', () => {
    const gateway = new BlockchainGatewayService(
      31337,
      'http://127.0.0.1:8545',
      account,
      account,
      account,
      account,
      account,
      account,
    );
    const tx = gateway.preparePersonalPermission({
      account,
      permission: id('REQUEST_EVIDENCE'),
      setting: 2,
    });
    const abi = new Interface(['function setPersonalPermission(address,bytes32,uint8)']);
    expect(Array.from(abi.decodeFunctionData('setPersonalPermission', tx.data))).toEqual([
      account,
      id('REQUEST_EVIDENCE'),
      2n,
    ]);
    expect(tx.to).toEqual(account);
  });
  it('fails closed when individual-permission reads fail or the deployment is too old', async () => {
    const { app, gateway } = setup();
    gateway.getPersonalPermission.mockRejectedValue(new Error('missing getter or RPC outage'));
    await request(app).get(`/api/blockchain/personal-permissions/${account}`).expect(503);
    await request(app)
      .post('/api/blockchain/transactions/personal-permission')
      .send({ account, permission: id('REGISTER_INGREDIENT'), setting: 1 })
      .expect(503);
    expect(gateway.preparePersonalPermission).not.toHaveBeenCalled();
  });
});
