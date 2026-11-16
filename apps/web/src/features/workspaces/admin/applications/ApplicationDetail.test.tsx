// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ChainApplication } from './types';

const mocks = vi.hoisted(() => ({ issue: vi.fn(), send: vi.fn(), notify: vi.fn() }));
vi.mock('../../../auth/auth.api', () => ({ issueCompanyRoleCredential: mocks.issue }));
vi.mock('../../../blockchain/blockchain.api', () => ({
  sendPreparedTransaction: mocks.send,
  prepareApplicationRejection: vi.fn(),
}));
vi.mock('../../../registration/ApplicationDocumentsPanel', () => ({
  ApplicationDocumentsPanel: () => null,
}));
vi.mock('../../../orders/CatalogueMedia', () => ({ CompanyAvatar: () => null }));
vi.mock('../../../../components/ui/feedback', () => ({
  notify: mocks.notify,
  reportError: () => 'Issuance failed.',
}));
vi.mock('ethers', async (original) => ({
  ...(await original<typeof import('ethers')>()),
  BrowserProvider: class {
    async getSigner() {
      return {};
    }
  },
}));
import { AppDetail } from './ApplicationDetail';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it.each(['pending', 'approved'] as const)(
  'completes %s issuance without downloading a credential',
  async (status) => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    const changed = vi.fn(async () => undefined);
    Object.defineProperty(window, 'ethereum', { configurable: true, value: { request: vi.fn() } });
    const prepared = { chainId: 31337, to: '0x123', data: '0x', value: '0x0' };
    mocks.issue.mockResolvedValue({
      issuanceState: status === 'approved' ? 'CREDENTIAL_ACTIVE' : 'CREDENTIAL_PREPARED',
      credential: { private: 'credential' },
      credentialId: 'test-id',
      ...(status === 'pending'
        ? { approvalTransaction: prepared, credentialRegistrationTransaction: prepared }
        : {}),
    });
    mocks.send.mockResolvedValue({ wait: async () => ({ status: 1 }) });
    const app = {
      id: '0x123',
      applicant: '0x1000000000000000000000000000000000000001',
      companyName: 'Test Company',
      companyRegistrationNumber: 'TEST-1',
      requestedRole: 'Supplier',
      status,
      submittedAt: 1,
      updatedAt: 1,
      profileHash: 'hash',
      encryptedProfileCid: 'cid',
      previousApplicationId: '0x0',
    } satisfies ChainApplication;
    render(<AppDetail app={app} onBack={() => undefined} onChanged={changed} />);
    fireEvent.click(
      screen.getByRole('button', {
        name:
          status === 'pending' ? 'Issue credential & approve' : 'Complete credential activation',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: status === 'pending' ? 'Issue and approve' : 'Resume issuance',
      }),
    );
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledTimes(status === 'pending' ? 2 : 0);
    expect(click).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.stringContaining('My Company Identity'),
      'success',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);
