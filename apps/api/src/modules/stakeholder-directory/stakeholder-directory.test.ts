import { CompanyRole } from '@tracechain/shared';
import { describe, expect, it } from 'vitest';

import type { OnChainAuthorizationSummary } from '../auth/auth.types.js';
import type { LoginAuthorizationResolver } from '../blockchain/login-authorization.service.js';
import type {
  CompanyRoleIssuanceRecord,
  CompanyRoleIssuanceRepository,
} from '../ssi/issuance.repository.js';
import { VerifiedStakeholderDirectory } from './stakeholder-directory.service.js';

const WALLETS = [
  '0x1000000000000000000000000000000000000001',
  '0x2000000000000000000000000000000000000002',
  '0x3000000000000000000000000000000000000003',
] as const;

function record(
  wallet: string,
  companyName: string | undefined,
  role = CompanyRole.DISTRIBUTOR,
  credentialId = `0x${'11'.repeat(32)}`,
) {
  return {
    applicantWallet: wallet,
    applicationId: `0x${wallet.slice(2).padEnd(64, '0')}`,
    companyName,
    credentialId,
    issuedAt: '2026-11-07T00:00:00.000Z',
    role,
  } as CompanyRoleIssuanceRecord;
}

function repository(records: CompanyRoleIssuanceRecord[]): CompanyRoleIssuanceRepository {
  return {
    find: async () => undefined,
    list: async () => records,
    save: async () => undefined,
  };
}

function resolver(
  statusByWallet: Record<string, OnChainAuthorizationSummary['status']> = {},
): LoginAuthorizationResolver {
  return {
    resolve: async (walletAddress) => ({
      checkedAt: new Date(),
      credentialId: `0x${'11'.repeat(32)}`,
      role: CompanyRole.DISTRIBUTOR,
      status: statusByWallet[walletAddress.toLowerCase()] ?? 'AUTHORIZED',
    }),
  };
}

describe('verified stakeholder directory', () => {
  it('resolves a verified wallet to its credential-issued company name', async () => {
    const directory = new VerifiedStakeholderDirectory(
      repository([record(WALLETS[0], 'Swift Distribution Sdn. Bhd.')]),
      resolver(),
    );
    await expect(directory.resolve(WALLETS[0])).resolves.toEqual({
      active: true,
      companyName: 'Swift Distribution Sdn. Bhd.',
      role: CompanyRole.DISTRIBUTOR,
      walletAddress: WALLETS[0],
    });
  });

  it('excludes a revoked on-chain stakeholder', async () => {
    const directory = new VerifiedStakeholderDirectory(
      repository([record(WALLETS[0], 'Revoked Company')]),
      resolver({ [WALLETS[0].toLowerCase()]: 'REVOKED' }),
    );
    await expect(directory.list()).resolves.toEqual([]);
  });

  it('uses a safe role fallback when an old issuance record has no name', async () => {
    const directory = new VerifiedStakeholderDirectory(
      repository([record(WALLETS[0], undefined)]),
      resolver(),
    );
    await expect(directory.resolve(WALLETS[0])).resolves.toMatchObject({
      companyName: 'Verified Distributor',
    });
  });

  it('adds shortened wallets when active companies share a display name', async () => {
    const directory = new VerifiedStakeholderDirectory(
      repository([
        record(WALLETS[0], 'Shared Name Sdn. Bhd.'),
        record(WALLETS[1], 'Shared Name Sdn. Bhd.'),
      ]),
      resolver(),
    );
    const entries = await directory.list();
    expect(entries.map((entry) => entry.companyName)).toEqual([
      'Shared Name Sdn. Bhd. (0x1000...0001)',
      'Shared Name Sdn. Bhd. (0x2000...0002)',
    ]);
  });
});
