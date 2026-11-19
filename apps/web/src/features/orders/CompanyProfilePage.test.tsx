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
vi.mock('../registration/ApplicationDocumentsPanel', () => ({
  ApplicationDocumentsPanel: () => (
    <details data-testid="registration-documents">
      <summary>Registration documents (3)</summary>
    </details>
  ),
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
it('keeps documents after locations and opens the add form only after an explicit action', async () => {
  render(<CompanyProfilePage role="supplier" />);
  const locations = await screen.findByLabelText('Your registered locations');
  expect(screen.queryByLabelText(/^Location name/)).toBeNull();
  const documents = screen.getByTestId('registration-documents');
  expect(locations.compareDocumentPosition(documents) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add location' }));
  expect(await screen.findByLabelText(/^Location name/)).toBeTruthy();
});
it('requires a physical address when registering a location and renders the refreshed card', async () => {
  const initial = await api.get();
  api.get.mockReset();
  api.get.mockResolvedValueOnce(initial).mockResolvedValue({
    ...initial,
    locations: [
      ...initial.locations,
      {
        location: 'new-location',
        label: 'Dispatch depot',
        registeredLabel: 'Dispatch depot',
        address: '25 Depot Road, Malaysia',
        warehouse: false,
      },
    ],
  });
  render(<CompanyProfilePage role="supplier" />);
  await screen.findByText('Actual warehouse');
  fireEvent.click(screen.getByRole('button', { name: 'Add location' }));
  fireEvent.change(screen.getByLabelText(/^Location name/), {
    target: { value: 'Dispatch depot' },
  });
  const register = screen.getByRole('button', { name: 'Save location' }) as HTMLButtonElement;
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
  expect(await screen.findByRole('heading', { name: 'Dispatch depot' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save location' })).toBeNull();
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
  fireEvent.click(await screen.findByRole('button', { name: 'Add location' }));
  await screen.findByDisplayValue('Registered warehouse draft');
  fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
  await waitFor(() => expect(api.sign).toHaveBeenCalledTimes(2));
  expect(api.warehouse).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'warehouse',
      location: 'new-location',
      name: 'Registered warehouse draft',
    }),
  );
});

it('shows compact loading, empty and retry states', async () => {
  let resolveProfile: ((value: unknown) => void) | undefined;
  api.get.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveProfile = resolve;
    }),
  );
  const view = render(<CompanyProfilePage role="retailer" />);
  expect(screen.getByLabelText('Loading company profile')).toBeTruthy();
  resolveProfile?.({ wallet: 'retailer', role: 'RETAILER', locations: [] });
  expect(await screen.findByText('No registered locations')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add your first location' })).toBeTruthy();
  view.unmount();

  api.get.mockRejectedValueOnce(new Error('RPC unavailable'));
  render(<CompanyProfilePage role="retailer" />);
  expect(await screen.findByText('Locations could not be loaded')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});

it.each([
  ['supplier', 'Supplier location'],
  ['manufacturer', 'Production location'],
  ['distributor', 'Company location'],
  ['retailer', 'Retail location'],
] as const)('shares the location-card layout for the %s workspace', async (role, type) => {
  render(<CompanyProfilePage role={role} />);
  expect(await screen.findByText(type)).toBeTruthy();
});
