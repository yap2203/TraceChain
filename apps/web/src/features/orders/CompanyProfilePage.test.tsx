// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  get: vi.fn(),
  rename: vi.fn(),
  location: vi.fn(),
  warehouse: vi.fn(),
  sign: vi.fn(),
}));
vi.mock('./orders.api', () => ({
  getCompanyProfile: api.get,
  updateLocationLabel: api.rename,
  prepareOrder: api.location,
  prepareLogistics: api.warehouse,
}));
vi.mock('../production-flow/production-flow.transaction', () => ({
  submitProductionTransaction: api.sign,
}));
import { CompanyProfilePage } from './CompanyProfilePage';
beforeEach(() => {
  api.get.mockResolvedValue({
    wallet: 'actual-wallet',
    role: 'SUPPLIER',
    locations: [
      {
        location: 'actual-location',
        label: 'Actual warehouse',
        registeredLabel: 'Original name',
        warehouse: false,
      },
    ],
  });
  api.rename.mockResolvedValue({});
  api.location.mockResolvedValue({ resultId: 'new-location', transaction: { to: 'registry' } });
  api.warehouse.mockResolvedValue({ transaction: { to: 'warehouse-registry' } });
  api.sign.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('changes a company location display name through its owner-checked endpoint', async () => {
  render(<CompanyProfilePage role="supplier" />);
  await screen.findByText('Actual warehouse');
  fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
  fireEvent.change(await screen.findByLabelText(/^Display name/), {
    target: { value: 'Updated name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(api.rename).toHaveBeenCalledWith('actual-location', 'Updated name'));
  expect(api.sign).not.toHaveBeenCalled();
});
it('uses the registration location draft and completes two explicit warehouse confirmations', async () => {
  api.get.mockResolvedValue({
    wallet: 'actual-wallet',
    role: 'DISTRIBUTOR',
    locations: [],
    initialLocationName: 'Registered warehouse draft',
  });
  render(<CompanyProfilePage role="distributor" />);
  await screen.findByDisplayValue('Registered warehouse draft');
  fireEvent.click(screen.getByRole('button', { name: 'Register warehouse' }));
  await waitFor(() => expect(api.sign).toHaveBeenCalledTimes(2));
  expect(api.warehouse).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'warehouse',
      location: 'new-location',
      name: 'Registered warehouse draft',
    }),
  );
});
