// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    getPersonalPermissions: vi.fn().mockResolvedValue({ permissions: [] }),
  };
});

import { CompanyCredentials } from './admin/credentials/CompanyCredentialsPage';

afterEach(cleanup);

describe('administrator stakeholder presentation', () => {
  it('keeps company names first and full wallet/credential details accessible from Manage companies', async () => {
    render(
      <MemoryRouter>
        <CompanyCredentials />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Swift Distribution Sdn. Bhd.')).toBeTruthy();
    expect(screen.getByText('0x12121212...121212')).toBeTruthy();
    fireEvent.click(screen.getByText('Manage'));
    expect(screen.getByRole('heading', { name: 'Swift Distribution Sdn. Bhd.' })).toBeTruthy();
    expect(screen.getByText(WALLET)).toBeTruthy();
    expect(screen.getByText(CREDENTIAL_ID)).toBeTruthy();
    await screen.findByText('No operational permissions were returned for this company.');
  });
});
