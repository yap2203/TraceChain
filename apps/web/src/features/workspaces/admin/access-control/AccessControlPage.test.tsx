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

const account = '0x2000000000000000000000000000000000000002';
describe('individual company permissions UI', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.clearAllMocks();
    mocks.getCompanyCredentials.mockResolvedValue({
      credentials: [
        {
          subject: account,
          companyName: 'Registered Supplier',
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
    render(<AccessControl />);
    fireEvent.click(screen.getByText('Individual Permissions'));
    await screen.findByText(/Registered Supplier/);
    fireEvent.change(screen.getByLabelText('Company wallet'), { target: { value: account } });
    await screen.findByText('Denied');
  }
  it('shows actual defaults and effective access and requires confirmation before a wallet update', async () => {
    await open();
    expect(mocks.getPersonalPermissions).toHaveBeenCalledWith(account);
    fireEvent.change(screen.getByLabelText('Individual setting: Register ingredient batches'), {
      target: { value: '1' },
    });
    expect(mocks.preparePersonalPermission).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm individual permission')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    expect(mocks.preparePersonalPermission).not.toHaveBeenCalled();
  });
  it('saves the exact selected wallet and setting after confirmation and reports success', async () => {
    mocks.preparePersonalPermission.mockResolvedValue({ chainId: 31337 });
    mocks.sendPreparedTransaction.mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ status: 1 }),
    });
    await open();
    fireEvent.change(screen.getByLabelText('Individual setting: Register ingredient batches'), {
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
    render(<AccessControl />);
    fireEvent.click(screen.getByText('Individual Permissions'));
    await screen.findByText(/Registered Supplier/);
    fireEvent.change(screen.getByLabelText('Company wallet'), { target: { value: account } });
    await waitFor(() =>
      expect(screen.getByText(/Individual permissions could not be read/)).toBeTruthy(),
    );
    expect(screen.queryByText('Allowed')).toBeNull();
  });
});
