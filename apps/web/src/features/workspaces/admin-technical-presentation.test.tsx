// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { CREDENTIAL_ID, WALLET } = vi.hoisted(() => ({
  CREDENTIAL_ID: `0x${'12'.repeat(32)}`,
  WALLET: '0x4000000000000000000000000000000000000004',
}));

vi.mock('../blockchain/blockchain.api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../blockchain/blockchain.api')>();
  return {
    ...original,
    getCompanyCredentials: vi.fn().mockResolvedValue({
      credentials: [
        {
          applicationId: `0x${'34'.repeat(32)}`,
          companyName: 'Swift Distribution Sdn. Bhd.',
          companyRegistrationNumber: 'PRIVATE-IN-ADMIN-TEST',
          credentialHash: `0x${'56'.repeat(32)}`,
          credentialId: CREDENTIAL_ID,
          encryptedCredentialCid: 'bafy-test',
          expiresAt: 1_900_000_000,
          issuedAt: 1_800_000_000,
          issuer: '0x1000000000000000000000000000000000000001',
          role: 'DISTRIBUTOR',
          stakeholderStatus: 'active',
          stakeholderUpdatedAt: 1_800_000_000,
          status: 'active',
          subject: WALLET,
          updatedAt: 1_800_000_000,
        },
      ],
    }),
    getRolePermissions: vi.fn().mockResolvedValue({ permissions: [] }),
  };
});

import AccessControl from './admin/access-control/AccessControlPage';

afterEach(cleanup);

describe('administrator stakeholder presentation', () => {
  it('keeps company names first while retaining technical wallet and credential columns', async () => {
    render(<AccessControl />);
    expect(await screen.findByText('Swift Distribution Sdn. Bhd.')).toBeTruthy();
    expect(screen.getByText('0x400000...00004')).toBeTruthy();
    expect(screen.getByText('0x121212...21212')).toBeTruthy();
  });
});
