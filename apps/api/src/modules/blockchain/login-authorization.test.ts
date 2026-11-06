import { CompanyRole } from '@tracechain/shared';
import { describe, expect, it, vi } from 'vitest';

import type { BlockchainGateway } from './blockchain-gateway.service.js';
import { GatewayLoginAuthorizationResolver } from './login-authorization.service.js';

const NOW = new Date('2026-11-07T00:00:00.000Z');
const ADMIN = '0x1000000000000000000000000000000000000001';
const WALLET = '0x2000000000000000000000000000000000000002';
const HASH = `0x${'33'.repeat(32)}`;
const CREDENTIAL_ID = `0x${'44'.repeat(32)}`;

function gateway(overrides: Record<string, unknown> = {}) {
  return {
    getAdministrator: vi.fn(async () => ADMIN),
    getCredential: vi.fn(async () => ({
      credentialHash: HASH,
      credentialType: 1,
      encryptedCid: 'bafy-company-role',
      expiresAt: Math.floor(NOW.getTime() / 1_000) + 3600,
      issuedAt: 1,
      issuer: ADMIN,
      status: 1,
      subject: WALLET,
      updatedAt: 1,
    })),
    getCredentialState: vi.fn(async () => ({ credentialId: CREDENTIAL_ID, status: 1 })),
    getEffectiveRole: vi.fn(async () => 2),
    getStakeholder: vi.fn(async () => ({
      credentialCid: 'bafy-company-role',
      credentialExpiresAt: Math.floor(NOW.getTime() / 1_000) + 3600,
      credentialHash: HASH,
      role: 2,
      status: 1,
      updatedAt: 1,
    })),
    listApplications: vi.fn(async () => []),
    ...overrides,
  } as unknown as BlockchainGateway;
}

describe('direct on-chain login authorization', () => {
  it('authorizes the current constructor administrator without a credential', async () => {
    const result = await new GatewayLoginAuthorizationResolver(gateway(), () => NOW).resolve(ADMIN);
    expect(result).toMatchObject({ role: CompanyRole.SYSTEM_ADMIN, status: 'AUTHORIZED' });
  });

  it('includes the registered credential identifiers for a linked administrator', async () => {
    const expiresAt = Math.floor(NOW.getTime() / 1_000) + 3600;
    const result = await new GatewayLoginAuthorizationResolver(
      gateway({
        getCredential: vi.fn(async () => ({
          credentialHash: HASH,
          credentialType: 1,
          encryptedCid: 'bafy-company-role',
          expiresAt,
          issuedAt: 1,
          issuer: ADMIN,
          status: 1,
          subject: ADMIN,
          updatedAt: 1,
        })),
        getStakeholder: vi.fn(async () => ({
          credentialCid: 'bafy-company-role',
          credentialExpiresAt: expiresAt,
          credentialHash: HASH,
          role: 1,
          status: 1,
          updatedAt: 1,
        })),
      }),
      () => NOW,
    ).resolve(ADMIN);
    expect(result).toMatchObject({
      credentialHash: HASH,
      credentialId: CREDENTIAL_ID,
      role: CompanyRole.SYSTEM_ADMIN,
      status: 'AUTHORIZED',
    });
  });

  it.each([
    [2, CompanyRole.SUPPLIER],
    [3, CompanyRole.MANUFACTURER],
    [4, CompanyRole.DISTRIBUTOR],
    [5, CompanyRole.RETAILER],
  ])('authorizes active role %s only when registry records match', async (roleNumber, role) => {
    const configured = gateway({
      getEffectiveRole: vi.fn(async () => roleNumber),
      getStakeholder: vi.fn(async () => ({
        credentialCid: 'bafy-company-role',
        credentialExpiresAt: Math.floor(NOW.getTime() / 1_000) + 3600,
        credentialHash: HASH,
        role: roleNumber,
        status: 1,
        updatedAt: 1,
      })),
    });
    const result = await new GatewayLoginAuthorizationResolver(configured, () => NOW).resolve(
      WALLET,
    );
    expect(result).toMatchObject({
      credentialHash: HASH,
      credentialId: CREDENTIAL_ID,
      role,
      status: 'AUTHORIZED',
    });
  });

  it('reports activation pending when approval exists but credential registration is incomplete', async () => {
    const result = await new GatewayLoginAuthorizationResolver(
      gateway({
        getCredentialState: vi.fn(async () => ({ credentialId: `0x${'0'.repeat(64)}`, status: 0 })),
      }),
      () => NOW,
    ).resolve(WALLET);
    expect(result.status).toBe('ACTIVATION_PENDING');
  });

  it('does not authorize suspended stakeholders or mismatched credential subjects', async () => {
    const suspended = gateway({
      getStakeholder: vi.fn(async () => ({
        credentialCid: 'bafy-company-role',
        credentialExpiresAt: 2_000_000_000,
        credentialHash: HASH,
        role: 2,
        status: 2,
        updatedAt: 1,
      })),
    });
    await expect(
      new GatewayLoginAuthorizationResolver(suspended, () => NOW).resolve(WALLET),
    ).resolves.toMatchObject({ status: 'SUSPENDED' });

    const mismatch = gateway({
      getCredential: vi.fn(async () => ({
        credentialHash: HASH,
        credentialType: 1,
        encryptedCid: 'bafy-company-role',
        expiresAt: 2_000_000_000,
        issuedAt: 1,
        issuer: ADMIN,
        status: 1,
        subject: ADMIN,
        updatedAt: 1,
      })),
    });
    await expect(
      new GatewayLoginAuthorizationResolver(mismatch, () => NOW).resolve(WALLET),
    ).resolves.toMatchObject({ status: 'UNAUTHORIZED' });
  });

  it.each([
    [3, 'REVOKED'],
    [1, 'EXPIRED'],
  ] as const)(
    'reports stakeholder/credential lifecycle denial %s as %s',
    async (status, expected) => {
      const configured = gateway({
        getStakeholder: vi.fn(async () => ({
          credentialCid: 'bafy-company-role',
          credentialExpiresAt:
            expected === 'EXPIRED' ? Math.floor(NOW.getTime() / 1_000) - 1 : 2_000_000_000,
          credentialHash: HASH,
          role: 2,
          status,
          updatedAt: 1,
        })),
      });
      await expect(
        new GatewayLoginAuthorizationResolver(configured, () => NOW).resolve(WALLET),
      ).resolves.toMatchObject({ status: expected });
    },
  );

  it('returns the actual latest application state and distinguishes RPC failure', async () => {
    const pending = gateway({
      getStakeholder: vi.fn(async () => ({
        credentialCid: '',
        credentialExpiresAt: 0,
        credentialHash: `0x${'0'.repeat(64)}`,
        role: 0,
        status: 0,
        updatedAt: 0,
      })),
      listApplications: vi.fn(async () => [
        {
          applicant: WALLET,
          encryptedProfileCid: 'cid',
          id: HASH,
          previousApplicationId: `0x${'0'.repeat(64)}`,
          profileHash: HASH,
          requestedRole: 'Supplier',
          status: 'additional evidence required',
          submittedAt: 1,
          updatedAt: 2,
        },
      ]),
    });
    await expect(
      new GatewayLoginAuthorizationResolver(pending, () => NOW).resolve(WALLET),
    ).resolves.toMatchObject({ applicationId: HASH, status: 'ADDITIONAL_EVIDENCE_REQUIRED' });

    const unavailable = gateway({
      getAdministrator: vi.fn(async () => {
        throw new Error('RPC down');
      }),
    });
    await expect(
      new GatewayLoginAuthorizationResolver(unavailable, () => NOW).resolve(WALLET),
    ).resolves.toMatchObject({ status: 'UNAVAILABLE' });
  });
});
