// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getCompanyCredentials: vi.fn(),
  getRolePermissions: vi.fn(),
  getPersonalPermissions: vi.fn(),
  preparePersonalPermission: vi.fn(),
  sendPreparedTransaction: vi.fn(),
}));
vi.mock('../../../blockchain/blockchain.api', () => ({
  ...mocks,
  prepareRolePermission: vi.fn(),
  prepareStakeholderLifecycle: vi.fn(),
}));
vi.mock('ethers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ethers')>()),
  BrowserProvider: class {
    getSigner() {
      return Promise.resolve({});
    }
  },
}));
import AccessControl from './AccessControlPage';
import { CredDetail } from '../credentials/CredentialDetail';
import type { ChainCredential } from '../../../blockchain/blockchain.api';
import { workspaceNavigation } from '../../workspace-navigation';
import { workspacePage, workspacePath } from '../../workspace-paths';

const account = '0x2000000000000000000000000000000000000002';
describe('individual company permissions UI', () => {
  it('names company management clearly and redirects retired individual-permission links', () => {
    expect(
      workspaceNavigation.admin.some(
        ([id, label]) => id === 'credentials' && label === 'Manage companies',
      ),
    ).toBe(true);
    expect(workspaceNavigation.admin.some(([id]) => String(id) === 'personal')).toBe(false);
    expect(workspacePage('admin', 'permissions/companies')).toBe('credentials');
    expect(workspacePage('admin', 'personal')).toBe('credentials');
    expect(workspacePage('admin', 'stakeholders')).toBe('credentials');
    expect(workspacePage('admin', 'accesscontrol')).toBe('credentials');
    expect(workspacePage('admin', 'credentials')).toBe('credentials');
    expect(workspacePath('admin', 'accesscontrol')).toBe('/admin/credentials');
    expect(workspaceNavigation.admin.some(([, label]) => String(label) === 'Stakeholders')).toBe(
      false,
    );
    expect(workspacePath('admin', 'credentials')).toBe('/admin/credentials');
  });
  it('keeps only role permissions and the matrix in Access Control', async () => {
    render(<AccessControl />);
    expect(await screen.findByText('Role Permissions')).toBeTruthy();
    expect(screen.getByText('Permission Matrix')).toBeTruthy();
    expect(screen.queryByText('Individual Permissions')).toBeNull();
    expect(mocks.getPersonalPermissions).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.clearAllMocks();
    mocks.getCompanyCredentials.mockResolvedValue({
      credentials: [
        {
          subject: account,
          companyName: 'Registered Supplier',
          credentialId: '0x' + '12'.repeat(32),
          issuedAt: 1_700_000_000,
          role: 'Supplier',
          stakeholderStatus: 'active',
          status: 'active',
        },
      ],
    });
    mocks.getRolePermissions.mockResolvedValue({ permissions: [] });
    mocks.getPersonalPermissions.mockResolvedValue({
      permissions: [
        {
          id: 'permission',
          name: 'REGISTER_INGREDIENT',
          roleAllowed: true,
          effective: false,
          setting: 2,
        },
      ],
    });
    window.ethereum = {} as NonNullable<Window['ethereum']>;
  });
  afterEach(cleanup);
  async function open() {
    const cred = {
      ...(await mocks.getCompanyCredentials()).credentials[0],
      expiresAt: 2_000_000_000,
      updatedAt: 1,
    } as ChainCredential;
    render(<CredDetail cred={cred} onBack={() => undefined} onChanged={async () => undefined} />);
    await screen.findByText('Denied');
  }
  it('shows actual defaults and effective access and requires confirmation before a wallet update', async () => {
    await open();
    expect(mocks.getPersonalPermissions).toHaveBeenCalledWith(account);
    fireEvent.change(screen.getByLabelText('Company override: Register ingredient batches'), {
      target: { value: '1' },
    });
    expect(mocks.preparePersonalPermission).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm company permission')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    expect(mocks.preparePersonalPermission).not.toHaveBeenCalled();
  });
  it('saves the exact selected wallet and setting after confirmation and reports success', async () => {
    mocks.preparePersonalPermission.mockResolvedValue({ chainId: 31337 });
    mocks.sendPreparedTransaction.mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ status: 1 }),
    });
    await open();
    fireEvent.change(screen.getByLabelText('Company override: Register ingredient batches'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByText('Confirm permission'));
    await screen.findByText('Individual permission updated on-chain.');
    expect(mocks.preparePersonalPermission).toHaveBeenCalledWith({
      account,
      permission: 'permission',
      setting: 0,
    });
  });
  it('shows read failures without fabricating effective permissions', async () => {
    mocks.getPersonalPermissions.mockRejectedValue(new Error('RPC unavailable'));
    const cred = {
      ...(await mocks.getCompanyCredentials()).credentials[0],
      expiresAt: 2_000_000_000,
      updatedAt: 1,
    } as ChainCredential;
    render(<CredDetail cred={cred} onBack={() => undefined} onChanged={async () => undefined} />);
    await waitFor(() =>
      expect(screen.getByText(/Company permissions could not be loaded/)).toBeTruthy(),
    );
    expect(screen.queryByText('Allowed')).toBeNull();
  });
  it('manages the credential company directly without a second wallet selection', async () => {
    mocks.preparePersonalPermission.mockResolvedValue({ chainId: 31337 });
    mocks.sendPreparedTransaction.mockResolvedValue({ wait: async () => ({ status: 1 }) });
    const cred = {
      ...(await mocks.getCompanyCredentials()).credentials[0],
      role: 'SUPPLIER',
      expiresAt: 2_000_000_000,
      updatedAt: 1,
      companyRegistrationNumber: 'TEST-1',
      registrationCountry: 'MY',
      issuer: account,
      applicationId: 'app',
      credentialHash: 'hash',
      encryptedCredentialCid: 'cid',
      stakeholderUpdatedAt: 1,
    } as ChainCredential;
    render(<CredDetail cred={cred} onBack={() => undefined} onChanged={async () => undefined} />);
    await screen.findByText('Denied');
    expect(mocks.getPersonalPermissions).toHaveBeenCalledWith(account);
    expect(screen.queryByLabelText('Company wallet')).toBeNull();
    fireEvent.change(screen.getByLabelText('Company override: Register ingredient batches'), {
      target: { value: '1' },
    });
    expect(mocks.preparePersonalPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm permission'));
    await screen.findByText('Individual permission updated on-chain.');
    expect(mocks.preparePersonalPermission).toHaveBeenCalledWith({
      account,
      permission: 'permission',
      setting: 1,
    });
  });
  it('does not offer individual overrides for the Admin credential', async () => {
    const cred = {
      ...(await mocks.getCompanyCredentials()).credentials[0],
      role: 'SYSTEM_ADMIN',
      expiresAt: 2_000_000_000,
      updatedAt: 1,
    } as ChainCredential;
    render(<CredDetail cred={cred} onBack={() => undefined} onChanged={async () => undefined} />);
    expect(
      screen.getByText(/Admin authority and revoked records cannot be changed here/),
    ).toBeTruthy();
    expect(mocks.getPersonalPermissions).not.toHaveBeenCalled();
  });
});
