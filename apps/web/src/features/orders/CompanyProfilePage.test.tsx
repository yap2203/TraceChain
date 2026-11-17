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
        address: '10 Original Road',
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
  fireEvent.click(screen.getByRole('button', { name: 'Edit location' }));
  fireEvent.change(await screen.findByLabelText(/^Display name/), {
    target: { value: 'Updated name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
  await waitFor(() =>
    expect(api.rename).toHaveBeenCalledWith('actual-location', 'Updated name', '10 Original Road'),
  );
  expect(api.sign).not.toHaveBeenCalled();
});
it('requires a physical address when registering a location and sends it separately from the name', async () => {
  render(<CompanyProfilePage role="supplier" />);
  await screen.findByText('Actual warehouse');
  fireEvent.change(screen.getByLabelText(/^Location name/), {
    target: { value: 'Dispatch depot' },
  });
  const register = screen.getByRole('button', { name: 'Register location' }) as HTMLButtonElement;
  expect(register.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/^Dispatch \/ receiving address/), {
    target: { value: '25 Depot Road, Malaysia' },
  });
  fireEvent.click(register);
  await waitFor(() =>
    expect(api.location).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Dispatch depot', address: '25 Depot Road, Malaysia' }),
    ),
  );
});
it('uses the registration location draft and completes two explicit warehouse confirmations', async () => {
  api.get.mockResolvedValue({
    wallet: 'actual-wallet',
    role: 'DISTRIBUTOR',
    locations: [],
    initialLocationName: 'Registered warehouse draft',
    initialLocationAddress: '20 Warehouse Street',
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
