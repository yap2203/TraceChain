// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('./orders.api', () => ({ getPickupPlan: api.get, savePickupPlan: api.save }));
import { PickupPlanPanel } from './PickupPlanPanel';
beforeEach(() => {
  api.get.mockResolvedValue({ plan: null });
  api.save.mockImplementation(async (_id, pickupAt) => ({
    plan: { pickupAt, arrangedAt: new Date().toISOString(), distributor: 'carrier' },
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('requires an explicit valid pickup time and saves it without a transaction', async () => {
  const ready = vi.fn();
  render(
    <PickupPlanPanel
      referenceId="actual-order"
      canArrange
      expiresAt={Math.floor(Date.now() / 1000) + 7200}
      onReady={ready}
    />,
  );
  await screen.findByText('The accepted Distributor has not scheduled pickup yet.');
  expect(
    (screen.getByRole('button', { name: 'Arrange pickup' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  const date = new Date(Date.now() + 600000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  fireEvent.change(screen.getByLabelText(/Planned pickup/), {
    target: { value: date.toISOString().slice(0, 16) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Arrange pickup' }));
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true));
  expect(api.save).toHaveBeenCalledWith('actual-order', expect.any(Number));
  expect(screen.getByRole('status').textContent).toContain('Planned pickup:');
});
it('shows a plan to other participants without scheduling controls', async () => {
  api.get.mockResolvedValueOnce({
    plan: {
      pickupAt: Math.floor(Date.now() / 1000) + 600,
      arrangedAt: new Date().toISOString(),
      distributor: 'carrier',
    },
  });
  render(
    <PickupPlanPanel
      referenceId="actual-order"
      canArrange={false}
      expiresAt={Math.floor(Date.now() / 1000) + 7200}
    />,
  );
  await screen.findByRole('status');
  expect(screen.queryByLabelText(/Planned pickup date/)).toBeNull();
  expect(api.save).not.toHaveBeenCalled();
});
it('fails closed on an unavailable plan and can retry without scheduling over it', async () => {
  api.get.mockRejectedValueOnce(new Error('RPC temporarily unavailable'));
  render(
    <PickupPlanPanel
      referenceId="actual-order"
      canArrange
      expiresAt={Math.floor(Date.now() / 1000) + 7200}
    />,
  );
  expect(await screen.findByText('RPC temporarily unavailable')).toBeTruthy();
  expect(screen.queryByLabelText(/Planned pickup date/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry pickup arrangement' }));
  await screen.findByLabelText(/Planned pickup date/);
  expect(api.save).not.toHaveBeenCalled();
});
