import { describe, expect, it, vi } from 'vitest';
import { EthersProductionFlowGateway } from './production-flow.gateway.js';

describe('fresh company proof authorization gateway', () => {
  it.each([
    ['active company and credential', 1, 1, true, true],
    ['suspended company with active credential', 2, 1, true, false],
    ['revoked company with active credential', 3, 1, true, false],
    ['active company with suspended credential', 1, 2, true, false],
    ['active company with revoked credential', 1, 3, true, false],
    ['active company with expired credential', 1, 4, true, false],
    ['active company with denied permission', 1, 1, false, false],
  ])('%s', async (_label, companyStatus, credentialStatus, permission, expected) => {
    const hash = '0x' + 'ab'.repeat(32),
      wallet = '0x' + '12'.repeat(20);
    // Exercise the actual gateway decision with stubbed RPC contract reads.
    const gateway = Object.assign(Object.create(EthersProductionFlowGateway.prototype), {
      stakeholders: {
        getStakeholder: vi
          .fn()
          .mockResolvedValue({ role: 2, status: companyStatus, credentialHash: hash }),
        hasPermission: vi.fn().mockResolvedValue(permission),
      },
      credentials: {
        credentialIdByHash: vi.fn().mockResolvedValue('0x' + 'cd'.repeat(32)),
        effectiveStatus: vi.fn().mockResolvedValue(credentialStatus),
      },
    }) as EthersProductionFlowGateway;
    expect(await gateway.getAccess(wallet, hash, 2, 'ISSUE_INGREDIENT_CREDENTIAL')).toBe(expected);
  });
});
