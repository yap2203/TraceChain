import {
  fillCompanyDetails,
  fillContactDetails,
  continueRegistration,
} from '../registration/registration.test-helpers';
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  prepare: vi.fn(),
  prepareManifest: vi.fn(),
  send: vi.fn(),
  wait: vi.fn(),
}));
const wallet = '0x2000000000000000000000000000000000000002';
vi.mock('../auth/useWalletAuthentication', () => ({
  useWalletAuthentication: () => ({
    logout: mocks.logout,
    state: {
      phase: 'authenticated',
      authorizationReady: true,
      onChainStatusChecked: true,
      address: wallet,
      role: 'SUPPLIER',
    },
  }),
}));
vi.mock('./WorkspaceScreen', () => ({ WorkspaceScreen: () => <p>Authorized workspace screen</p> }));
vi.mock('../blockchain/blockchain.api', () => ({
  getApplicationManifestConfiguration: vi.fn(async () => ({
    chainId: 31337,
    declarationVersion: 'tracechain-company-registration-v1',
    registryAddress: '0x1000000000000000000000000000000000000001',
  })),
  prepareApplicationManifest: mocks.prepareManifest,
  prepareCompanyApplication: mocks.prepare,
  sendPreparedTransaction: mocks.send,
}));
vi.mock('ethers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ethers')>()),
  BrowserProvider: class {
    async send() {
      return [wallet];
    }
    async getNetwork() {
      return { chainId: 31337n };
    }
    async getSigner() {
      return { getAddress: async () => wallet, signMessage: async () => `0x${'11'.repeat(65)}` };
    }
  },
}));
import WorkspaceApp from './WorkspaceApp';
import { RegisterCompanyPage } from '../registration/RegisterCompanyPage';
import { Notifications } from '../../components/ui/Notifications';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.logout.mockResolvedValue(undefined);
  mocks.prepare.mockResolvedValue({ chainId: 31337 });
  mocks.prepareManifest.mockImplementation(async (input) => ({
    applicationId: input.applicationId,
    applicantWallet: input.applicantWallet,
    bindingMessage: 'Bind the encrypted manifest',
    companyName: input.companyName,
    companyRegistrationNumber: input.companyRegistrationNumber,
    registrationCountry: input.registrationCountry,
    encryptedProfileCid: `ipfs://b${'a'.repeat(50)}`,
    previousApplicationId: input.previousApplicationId,
    profileHash: `0x${'22'.repeat(32)}`,
    requestedRole: input.requestedRole,
  }));
  mocks.wait.mockResolvedValue({ status: 1, hash: '0x-public-test-reference' });
  mocks.send.mockResolvedValue({ hash: '0x-public-test-reference', wait: mocks.wait });
  window.ethereum = {} as NonNullable<Window['ethereum']>;
});
afterEach(cleanup);
function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Notifications />
      <Routes>
        <Route path="/supplier/*" element={<WorkspaceApp role="supplier" />} />
        <Route path="/register-company" element={<RegisterCompanyPage />} />
        <Route path="/login" element={<h1>Wallet login destination</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}
it('returns directly to Login after signing out of a workspace', async () => {
  show('/supplier/overview');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByRole('heading', { name: 'Wallet login destination' });
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(screen.getByText('You have signed out.')).toBeTruthy();
});
it('returns to Login only after company application confirmation and announces success', async () => {
  show('/register-company');
  fillCompanyDetails('SUPPLIER');
  continueRegistration();
  fillContactDetails();
  continueRegistration();
  fireEvent.click(screen.getByRole('button', { name: 'Connect MetaMask' }));
  await screen.findByText(wallet);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  for (const input of document.querySelectorAll('input[type="file"][required]'))
    fireEvent.change(input, {
      target: {
        files: [new File(['synthetic-test-only'], 'test.pdf', { type: 'application/pdf' })],
      },
    });
  const documentContinue = screen.getByRole('button', { name: 'Continue' });
  fireEvent.click(documentContinue);
  await screen.findByRole('heading', { name: 'Review your application' });
  const finalSubmit = screen.getByRole('button', {
    name: 'Submit application',
  }) as HTMLButtonElement;
  expect(finalSubmit).not.toBe(documentContinue);
  expect(finalSubmit.disabled).toBe(true);
  expect(screen.queryByText('Confirm the declaration before submitting.')).toBeNull();
  expect(mocks.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Submit application' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.submit(document.querySelector('form')!);
  expect(mocks.prepare).not.toHaveBeenCalled();
  let confirm: ((receipt: unknown) => void) | undefined;
  mocks.wait.mockReturnValueOnce(
    new Promise((resolve) => {
      confirm = resolve;
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Submit application' }));
  await waitFor(() => expect(mocks.prepareManifest).toHaveBeenCalledOnce(), { timeout: 10_000 });
  await waitFor(() => expect(mocks.wait).toHaveBeenCalledOnce(), { timeout: 10_000 });
  const application = mocks.prepare.mock.calls[0]![0];
  expect(application).not.toHaveProperty('initialLocationName');
  expect(application).not.toHaveProperty('initialLocationAddress');
  expect(screen.queryByRole('heading', { name: 'Wallet login destination' })).toBeNull();
  confirm?.({ status: 1, hash: '0x-public-test-reference' });
  await screen.findByRole('heading', { name: 'Wallet login destination' });
  expect(screen.getByText(/Application submitted successfully/)).toBeTruthy();
}, 15_000);
