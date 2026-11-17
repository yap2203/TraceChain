import { goToWalletStep } from './registration.test-helpers';
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), notify: vi.fn() }));
vi.mock('ethers', async (original) => ({
  ...(await original<typeof import('ethers')>()),
  BrowserProvider: class {
    send = mocks.send;
  },
}));
vi.mock('../../components/ui/feedback', async (original) => ({
  ...(await original<typeof import('../../components/ui/feedback')>()),
  notify: mocks.notify,
}));
import { RegisterCompanyPage } from './RegisterCompanyPage';
const first = '0x1000000000000000000000000000000000000001';
const second = '0x2000000000000000000000000000000000000002';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ethereum', {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const show = () => {
  const result = render(
    <MemoryRouter>
      <RegisterCompanyPage />
    </MemoryRouter>,
  );
  goToWalletStep();
  return result;
};

it('asks MetaMask for account selection before reading accounts and confirms the chosen wallet', async () => {
  let choose!: () => void;
  mocks.send.mockImplementation((method: string) =>
    method === 'wallet_requestPermissions'
      ? new Promise<void>((resolve) => {
          choose = resolve;
        })
      : Promise.resolve([first]),
  );
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Connect MetaMask' }));
  expect(mocks.send).toHaveBeenCalledWith('wallet_requestPermissions', [{ eth_accounts: {} }]);
  expect(screen.getByText('Open MetaMask and choose the account for this company.')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: /Choose in MetaMask/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  choose();
  expect(await screen.findByText(first)).toBeTruthy();
  expect(mocks.send).toHaveBeenNthCalledWith(2, 'eth_accounts', []);
  expect(screen.getByRole('button', { name: 'Change account' })).toBeTruthy();
  expect(mocks.notify).toHaveBeenCalledWith('Company wallet connected successfully.', 'success');
});
it('reopens account selection to change wallets and keeps the previous wallet on cancellation', async () => {
  mocks.send.mockResolvedValueOnce([]).mockResolvedValueOnce([first]);
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Connect MetaMask' }));
  await screen.findByText(first);
  mocks.send.mockResolvedValueOnce([]).mockResolvedValueOnce([second]);
  fireEvent.click(screen.getByRole('button', { name: 'Change account' }));
  await screen.findByText(second);
  mocks.send.mockRejectedValueOnce({ code: 4001 });
  fireEvent.click(screen.getByRole('button', { name: 'Change account' }));
  await waitFor(() =>
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.stringContaining('Account selection was cancelled'),
      'error',
    ),
  );
  expect(screen.getByText(second)).toBeTruthy();
  expect(mocks.send).toHaveBeenCalledTimes(5);
});
it('explains pending MetaMask requests without silently connecting', async () => {
  mocks.send.mockRejectedValue({ code: -32002 });
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Connect MetaMask' }));
  await waitFor(() =>
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.stringContaining('MetaMask already has a pending request'),
      'error',
    ),
  );
  expect(screen.getByText('No wallet connected')).toBeTruthy();
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
