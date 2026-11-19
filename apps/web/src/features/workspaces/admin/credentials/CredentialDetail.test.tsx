// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { readableError } from '../../../../components/ui/feedback';

const mocks = vi.hoisted(() => ({
  getCompanyCredentials: vi.fn(),
  getAuthSession: vi.fn(),
  getAddress: vi.fn(),
  getPersonalPermissions: vi.fn(),
  prepareCredentialLifecycle: vi.fn(),
  prepareStakeholderLifecycle: vi.fn(),
  preparePersonalPermission: vi.fn(),
  sendPreparedTransaction: vi.fn(),
  notify: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock('../../../blockchain/blockchain.api', () => mocks);
vi.mock('../../../auth/auth.api', () => ({
  getAuthSession: mocks.getAuthSession,
  prepareAdministratorCredentialOnChain: vi.fn(),
}));
vi.mock('../../../../components/ui/feedback', async (original) => ({
  ...(await original<typeof import('../../../../components/ui/feedback')>()),
  notify: mocks.notify,
  reportError: mocks.reportError,
}));
vi.mock('../../../orders/CatalogueMedia', () => ({
  CompanyAvatar: ({ name }: { name: string }) => (
    <span aria-label={`Company logo fallback: ${name}`} />
  ),
}));
vi.mock('ethers', async (original) => ({
  ...(await original<typeof import('ethers')>()),
  BrowserProvider: class {
    getSigner() {
      return Promise.resolve({ getAddress: mocks.getAddress });
    }
  },
}));
import { CredDetail, formatDate } from './CredentialDetail';
import { CompanyCredentials } from './CompanyCredentialsPage';
import type { ChainCredential } from '../../../blockchain/blockchain.api';

const company: ChainCredential = {
  companyName: 'Registered Company',
  companyRegistrationNumber: 'REG-42',
  role: 'SUPPLIER',
  subject: '0x2000000000000000000000000000000000000002',
  issuer: '0x1000000000000000000000000000000000000001',
  applicationId: '0x' + 'ab'.repeat(32),
  credentialId: '0x' + 'cd'.repeat(32),
  credentialHash: '0x' + 'ef'.repeat(32),
  encryptedCredentialCid: 'bafy' + 'a'.repeat(150),
  issuedAt: 1700000000,
  expiresAt: 2100000000,
  updatedAt: 1800000000,
  stakeholderUpdatedAt: 1800000000,
  status: 'active',
  stakeholderStatus: 'active',
};
const permission = {
  id: 'ingredient',
  name: 'REGISTER_INGREDIENT',
  setting: 2,
  roleAllowed: true,
  effective: false,
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function detail(
  override: Partial<ChainCredential> = {},
  onChanged = vi.fn().mockResolvedValue(undefined),
) {
  return render(
    <CredDetail cred={{ ...company, ...override }} onBack={vi.fn()} onChanged={onChanged} />,
  );
}
function Location() {
  return <output aria-label="Current URL">{useLocation().search}</output>;
}
function page(url = '/admin/credentials') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CompanyCredentials />
      <Location />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  window.ethereum = {
    request: vi.fn().mockResolvedValue(['0x1000000000000000000000000000000000000001']),
  } as unknown as NonNullable<Window['ethereum']>;
  mocks.getAddress.mockResolvedValue(company.issuer);
  mocks.getAuthSession.mockResolvedValue({
    authenticated: true,
    authorizationReady: true,
    role: 'SYSTEM_ADMIN',
    address: company.issuer,
  });
  mocks.getPersonalPermissions.mockResolvedValue({ permissions: [permission] });
  mocks.getCompanyCredentials.mockResolvedValue({ credentials: [company] });
  mocks.prepareCredentialLifecycle.mockResolvedValue({ chainId: 31337 });
  mocks.prepareStakeholderLifecycle.mockResolvedValue({ chainId: 31337 });
  mocks.preparePersonalPermission.mockResolvedValue({ chainId: 31337 });
  mocks.sendPreparedTransaction.mockResolvedValue({ wait: async () => ({ status: 1 }) });
  mocks.reportError.mockImplementation((error, fallback) => readableError(error, fallback));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Admin company identity', () => {
  it.each(['active', 'suspended', 'revoked', 'expired'] as const)(
    'shows actual %s status separately from cryptographic verification',
    async (status) => {
      detail({ status });
      expect(
        screen.getByText(`Credential: ${status.charAt(0).toUpperCase() + status.slice(1)}`),
      ).toBeTruthy();
      expect(screen.getByText(/Cryptographic verification: not performed/)).toBeTruthy();
      expect(screen.queryByText('Suspend credential') !== null).toBe(status === 'active');
      expect(screen.queryByText('Reactivate credential') !== null).toBe(status === 'suspended');
      expect(screen.queryByText('Permanently revoke') !== null).toBe(
        ['active', 'suspended'].includes(status),
      );
      await screen.findByText('Denied');
    },
  );
  it('does not reactivate an expired suspended credential or edit Admin/revoked stakeholder permissions', async () => {
    const view = detail({ status: 'suspended', expiresAt: 1, stakeholderStatus: 'revoked' });
    expect(screen.queryByText('Reactivate credential')).toBeNull();
    expect(mocks.getPersonalPermissions).not.toHaveBeenCalled();
    view.rerender(
      <CredDetail
        cred={{ ...company, role: 'SYSTEM_ADMIN' }}
        onBack={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(mocks.getPersonalPermissions).not.toHaveBeenCalled();
  });
  it('uses missing-value fallbacks and explicit timezone without fabricated branding', async () => {
    detail({
      companyName: '',
      companyRegistrationNumber: '',
      issuer: '',
      issuedAt: 0,
      encryptedCredentialCid: '',
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Company name unavailable');
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(2);
    expect(screen.getAllByText(/SGT \(UTC\+08:00\)/).length).toBe(2);
    expect(formatDate(NaN)).toBe('Unavailable');
    expect(formatDate(-1)).toBe('Unavailable');
    await screen.findByText('Denied');
  });
  it('keeps long technical values collapsed and full wallets keyboard-accessible, with copy feedback', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy },
    });
    detail({ companyName: 'Long company '.repeat(30) });
    const technical = screen.getByText('Technical details').closest('details')!;
    expect(technical.open).toBe(false);
    fireEvent.click(screen.getByText('Technical details'));
    expect(technical.open).toBe(true);
    expect(screen.getByText(company.encryptedCredentialCid)).toBeTruthy();
    expect(screen.getAllByText('Show full address').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Associated wallet' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(company.subject));
    expect(mocks.notify).toHaveBeenCalledWith('Associated wallet copied.', 'success');
    copy.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Credential hash' }));
    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('Copy failed'), 'error'),
    );
  });
  it('downloads the actual summary without private CID or a fabricated signature result', async () => {
    const create = vi.fn().mockReturnValue('blob:summary');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    detail();
    fireEvent.click(screen.getByRole('button', { name: 'Download summary' }));
    const blob = create.mock.calls[0]![0] as Blob;
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    const summary = JSON.parse(content);
    expect(summary.companyName).toBe(company.companyName);
    expect(summary.credentialHash).toBe(company.credentialHash);
    expect(summary.status).toBe('active');
    expect(summary.verification).toContain('not performed');
    expect(summary.encryptedCredentialCid).toBeUndefined();
    expect(mocks.notify).toHaveBeenCalledWith('Company identity summary downloaded.', 'success');
    await screen.findByText('Denied');
  });
});

describe('confirmed lifecycle transactions', () => {
  it('updates the actual company badge through the normal Manage companies entry point', async () => {
    mocks.getCompanyCredentials
      .mockResolvedValueOnce({ credentials: [company] })
      .mockResolvedValueOnce({ credentials: [company] })
      .mockResolvedValue({ credentials: [{ ...company, stakeholderStatus: 'suspended' }] });
    page();
    fireEvent.click(await screen.findByText('Manage'));
    fireEvent.click(screen.getByRole('button', { name: 'Suspend company access' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review company' } });
    fireEvent.click(screen.getByText('Confirm suspend'));
    await screen.findByText('Company: Suspended');
    expect(screen.getByText('Access: Suspended')).toBeTruthy();
    expect(screen.getByText('Credential: Active')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reactivate company access' })).toBeTruthy();
    expect(screen.getByText('Transaction confirmed on-chain.')).toBeTruthy();
  });
  it('stops a second account switch after preparation but before submission', async () => {
    window.ethereum!.request = vi.fn().mockResolvedValue([company.subject]);
    detail();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend company access' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review' } });
    fireEvent.click(screen.getByText('Confirm suspend'));
    await screen.findByText(/Transaction failed or was cancelled/);
    expect(mocks.prepareStakeholderLifecycle).toHaveBeenCalledTimes(1);
    expect(mocks.sendPreparedTransaction).not.toHaveBeenCalled();
  });
  it('groups company access and credential actions in one read-only management card', async () => {
    detail();
    expect(screen.getByRole('button', { name: 'Suspend company access' })).toBeTruthy();
    const heading = screen.getByRole('heading', { name: 'Company management' });
    const card = heading.closest('.admin-company-lifecycle')!;
    expect(
      within(card as HTMLElement).getByRole('region', { name: 'Company access' }),
    ).toBeTruthy();
    expect(
      within(card as HTMLElement).getByRole('region', { name: 'Issued credential' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Suspend credential' })).toBeTruthy();
    expect(
      screen.getByText('Manage this specific credential separately from company access.'),
    ).toBeTruthy();
    expect(mocks.prepareCredentialLifecycle).not.toHaveBeenCalled();
    expect(mocks.sendPreparedTransaction).not.toHaveBeenCalled();
    await screen.findByText('Denied');
  });
  it.each(['unauthorized', 'wallet changed', 'stale record'])(
    'stops %s before a wallet transaction',
    async (condition) => {
      detail();
      if (condition === 'unauthorized')
        mocks.getAuthSession.mockResolvedValue({ authenticated: false });
      if (condition === 'wallet changed') mocks.getAddress.mockResolvedValue(company.subject);
      if (condition === 'stale record')
        mocks.getCompanyCredentials.mockResolvedValue({
          credentials: [{ ...company, stakeholderStatus: 'suspended' }],
        });
      fireEvent.click(screen.getByRole('button', { name: 'Suspend company access' }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review' } });
      fireEvent.click(screen.getByText('Confirm suspend'));
      await screen.findByText(/Transaction failed or was cancelled/);
      expect(mocks.sendPreparedTransaction).not.toHaveBeenCalled();
    },
  );
  it('waits for a matching reread and prevents duplicate submissions while pending', async () => {
    const reading = deferred<ChainCredential>();
    const changed = vi.fn().mockReturnValue(reading.promise);
    detail({}, changed);
    fireEvent.click(screen.getByRole('button', { name: 'Suspend company access' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review' } });
    const confirm = screen.getByText('Confirm suspend');
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await screen.findByText('Transaction mined. Reading the resulting chain state...');
    expect(mocks.sendPreparedTransaction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Transaction confirmed on-chain.')).toBeNull();
    expect(mocks.notify).not.toHaveBeenCalledWith(
      'Company access change confirmed on-chain.',
      'success',
    );
    reading.resolve({ ...company, stakeholderStatus: 'suspended' });
    await screen.findByText('Transaction confirmed on-chain.');
  });
  it('does not claim success when the reread is stale and allows a safe reread retry', async () => {
    const changed = vi
      .fn()
      .mockResolvedValueOnce(company)
      .mockResolvedValueOnce({ ...company, stakeholderStatus: 'suspended' });
    detail({}, changed);
    fireEvent.click(screen.getByRole('button', { name: 'Suspend company access' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review' } });
    fireEvent.click(screen.getByText('Confirm suspend'));
    await screen.findByText(/record could not be refreshed/);
    expect(screen.queryByText('Transaction confirmed on-chain.')).toBeNull();
    fireEvent.click(screen.getByText('Refresh record'));
    await screen.findByText('Transaction confirmed on-chain.');
    expect(mocks.sendPreparedTransaction).toHaveBeenCalledTimes(1);
  });
  it('reactivates company access with a still-active credential', async () => {
    mocks.getCompanyCredentials.mockResolvedValue({
      credentials: [{ ...company, stakeholderStatus: 'suspended' }],
    });
    detail({ stakeholderStatus: 'suspended' }, vi.fn().mockResolvedValue(company));
    fireEvent.click(screen.getByText('Reactivate company access'));
    fireEvent.click(screen.getByText('Confirm reactivate'));
    await screen.findByText('Transaction confirmed on-chain.');
    expect(mocks.prepareStakeholderLifecycle).toHaveBeenCalledWith({
      action: 'reactivate',
      account: company.subject,
      reasonHash: undefined,
    });
  });
  it('preserves separate stakeholder access management in the unified company detail', async () => {
    const changed = vi.fn().mockResolvedValue({ ...company, stakeholderStatus: 'suspended' });
    detail({}, changed);
    expect(screen.getByText('Access: Active')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend company access' }));
    expect(screen.getByRole('dialog').textContent).toContain('stakeholder-authorized operations');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Company access review' } });
    fireEvent.click(screen.getByText('Confirm suspend'));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(mocks.prepareStakeholderLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ account: company.subject, action: 'suspend' }),
    );
    expect(mocks.prepareCredentialLifecycle).not.toHaveBeenCalled();
  });
  it('requires a reason and explicit permanent-revocation consent before invoking MetaMask', async () => {
    const changed = vi.fn().mockResolvedValue({ ...company, status: 'revoked' });
    const receipt = deferred<{ status: number }>();
    mocks.sendPreparedTransaction.mockResolvedValue({ wait: () => receipt.promise });
    detail({}, changed);
    fireEvent.click(screen.getByText('Permanently revoke'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(company.companyName)).toBeTruthy();
    expect(within(dialog).getByText(/can never be reactivated/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', {
      name: 'Confirm revoke',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'Policy violation' },
    });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(mocks.prepareCredentialLifecycle).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await screen.findByText('Transaction submitted. Waiting for blockchain confirmation...');
    expect(changed).not.toHaveBeenCalled();
    receipt.resolve({ status: 1 });
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.prepareCredentialLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'revoke', credentialId: company.credentialId }),
    );
  });
  it.each(['rejected', 'failed receipt', 'wrong chain'])(
    'handles %s without refreshing or reporting success',
    async (failure) => {
      if (failure === 'rejected') mocks.sendPreparedTransaction.mockRejectedValue({ code: 4001 });
      if (failure === 'failed receipt')
        mocks.sendPreparedTransaction.mockResolvedValue({ wait: async () => ({ status: 0 }) });
      if (failure === 'wrong chain')
        mocks.prepareCredentialLifecycle.mockResolvedValue({ chainId: 1 });
      const changed = vi.fn();
      detail({}, changed);
      fireEvent.click(screen.getByText('Suspend credential'));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review needed' } });
      fireEvent.click(screen.getByText('Confirm suspend'));
      await screen.findByText(/Transaction failed or was cancelled/);
      expect(changed).not.toHaveBeenCalled();
      expect(mocks.notify).not.toHaveBeenCalledWith(
        'Credential change confirmed on-chain.',
        'success',
      );
      if (failure === 'rejected')
        expect(screen.getAllByText(/wallet request was cancelled/).length).toBeGreaterThan(0);
      if (failure === 'wrong chain') expect(mocks.sendPreparedTransaction).not.toHaveBeenCalled();
    },
  );
  it('does not resubmit a mined transaction when refreshing fails', async () => {
    detail({}, vi.fn().mockRejectedValue(new Error('offline')));
    fireEvent.click(screen.getByText('Suspend credential'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review' } });
    fireEvent.click(screen.getByText('Confirm suspend'));
    await screen.findByText(/record could not be refreshed/);
    expect(
      (screen.getByText('Suspend credential').closest('button') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.sendPreparedTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('persisted permissions and company navigation', () => {
  it('combines role statistics, role/status filters, search and management in one list', async () => {
    mocks.getCompanyCredentials.mockResolvedValue({
      credentials: [
        company,
        {
          ...company,
          credentialId: 'manufacturer-id',
          companyName: 'Manufacturer Company',
          role: 'MANUFACTURER',
          stakeholderStatus: 'suspended',
        },
        {
          ...company,
          credentialId: 'retailer-id',
          companyName: 'Retailer Company',
          role: 'RETAILER',
        },
      ],
    });
    page();
    const stats = await screen.findByLabelText('Company statistics by role');
    expect(within(stats).getByRole('button', { name: 'Suppliers 1' })).toBeTruthy();
    fireEvent.click(within(stats).getByRole('button', { name: 'Manufacturers 1' }));
    expect(screen.queryByText(company.companyName)).toBeNull();
    expect(screen.getByText('Manufacturer Company')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All companies' }));
    fireEvent.change(screen.getByLabelText('Company access'), { target: { value: 'suspended' } });
    expect(screen.queryByText('Retailer Company')).toBeNull();
    fireEvent.change(screen.getByLabelText('Company access'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search companies'), {
      target: { value: 'Retailer Company' },
    });
    expect(screen.queryByText('Manufacturer Company')).toBeNull();
    fireEvent.click(screen.getByText('Manage'));
    await screen.findByRole('heading', { name: 'Retailer Company' });
    fireEvent.click(screen.getByText('Back to Manage companies'));
    expect((screen.getByLabelText('Search companies') as HTMLInputElement).value).toBe(
      'Retailer Company',
    );
    fireEvent.change(screen.getByLabelText('Search companies'), {
      target: { value: 'not a company' },
    });
    await screen.findByText('No matching companies');
  });
  it.each(['rejected', 'failed receipt', 'confirmed but unreadable'])(
    'keeps saved permissions when a transaction is %s',
    async (failure) => {
      detail();
      await screen.findByText('Denied');
      if (failure === 'rejected')
        mocks.sendPreparedTransaction.mockRejectedValueOnce({ code: 4001 });
      if (failure === 'failed receipt')
        mocks.sendPreparedTransaction.mockResolvedValueOnce({ wait: async () => ({ status: 0 }) });
      if (failure === 'confirmed but unreadable')
        mocks.getPersonalPermissions.mockRejectedValueOnce(new Error('offline'));
      const select = screen.getByLabelText(
        'Company override: Register ingredient batches',
      ) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: '1' } });
      fireEvent.click(screen.getByText('Confirm permission'));
      await waitFor(() => expect(screen.queryByText('Waiting for confirmation...')).toBeNull());
      expect(screen.getByText('Denied')).toBeTruthy();
      expect(select.value).toBe('2');
      if (failure === 'confirmed but unreadable') {
        expect(select.disabled).toBe(true);
        expect(screen.getByText(/permission transaction is confirmed/)).toBeTruthy();
      } else {
        expect(screen.getByText('Confirm permission')).toBeTruthy();
        expect(screen.queryByText('Individual permission updated on-chain.')).toBeNull();
      }
    },
  );
  it('retains confirmed access during a pending selection and refresh, then uses the refetched record', async () => {
    detail();
    await screen.findByText('Denied');
    const select = screen.getByLabelText(
      'Company override: Register ingredient batches',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '1' } });
    expect(select.value).toBe('2');
    expect(screen.getByText('Pending: Allow (not saved)')).toBeTruthy();
    expect(screen.getByText('Denied')).toBeTruthy();
    const read = deferred<{ permissions: (typeof permission)[] }>();
    mocks.getPersonalPermissions.mockReturnValueOnce(read.promise);
    fireEvent.click(screen.getByText('Confirm permission'));
    await screen.findByText('Individual permission updated on-chain.');
    expect(select.value).toBe('2');
    expect(select.disabled).toBe(true);
    read.resolve({ permissions: [{ ...permission, setting: 1, effective: true }] });
    await screen.findByText('Allowed');
    expect(select.value).toBe('1');
    mocks.getPersonalPermissions.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByText('Refresh permissions'));
    await screen.findByText(/Company permissions could not be loaded/);
    expect(screen.getByText('Allowed')).toBeTruthy();
  });
  it('cancels pending permission changes without sending, and reports empty permissions honestly', async () => {
    const view = detail();
    await screen.findByText('Denied');
    fireEvent.change(screen.getByLabelText('Company override: Register ingredient batches'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByText('Cancel'));
    expect(mocks.preparePersonalPermission).not.toHaveBeenCalled();
    view.unmount();
    mocks.getPersonalPermissions.mockResolvedValue({ permissions: [] });
    detail();
    await screen.findByText('No operational permissions were returned for this company.');
  });
  it('opens Manage, supports direct links, preserves selection after refresh, and returns to the list', async () => {
    page();
    fireEvent.click(await screen.findByText('Manage'));
    await screen.findByRole('heading', { name: company.companyName });
    expect(screen.getByLabelText('Current URL').textContent).toContain(company.credentialId);
    fireEvent.click(screen.getByText('Refresh record'));
    await waitFor(() => expect(mocks.getCompanyCredentials).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', { name: company.companyName })).toBeTruthy();
    fireEvent.click(screen.getByText('Back to Manage companies'));
    await screen.findByText('Manage');
    expect(screen.getByLabelText('Current URL').textContent).toBe('');
    cleanup();
    page(`/admin/credentials?credentialId=${company.credentialId}`);
    await screen.findByRole('heading', { name: company.companyName });
  });
  it('handles unavailable direct records and authorization errors without displaying a company', async () => {
    page('/admin/credentials?credentialId=missing');
    await screen.findByText('Company record unavailable');
    expect(screen.queryByRole('heading', { name: company.companyName })).toBeNull();
    cleanup();
    mocks.getCompanyCredentials.mockRejectedValue(new Error('Administrator access required.'));
    page(`/admin/credentials?credentialId=${company.credentialId}`);
    await screen.findByText('Administrator access required.');
    expect(screen.queryByRole('button', { name: 'Suspend credential' })).toBeNull();
    expect(mocks.getPersonalPermissions).not.toHaveBeenCalled();
  });
});
