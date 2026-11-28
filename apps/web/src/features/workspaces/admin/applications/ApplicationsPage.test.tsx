// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ useApplications: vi.fn() }));
vi.mock('./useChainApplications', () => ({ useChainApplications: mocks.useApplications }));
vi.mock('./ApplicationDetail', () => ({
  AppDetail: ({ app }: { app: { companyName: string } }) => <h2>Review {app.companyName}</h2>,
}));
import { Applications } from './ApplicationsPage';
const record = {
  id: '0x1234',
  applicant: '0x1000000000000000000000000000000000000001',
  companyName: 'Registered supplier',
  requestedRole: 'Supplier',
  status: 'pending',
  submittedAt: 1_800_000_000,
};
beforeEach(() =>
  mocks.useApplications.mockReturnValue({
    applications: [record],
    loading: false,
    error: '',
    reload: vi.fn(),
  }),
);
afterEach(cleanup);
describe('application review list', () => {
  it('opens the selected real application from its Review button', () => {
    render(<Applications />);
    fireEvent.click(screen.getByRole('button', { name: 'Review application' }));
    expect(screen.getByRole('heading', { name: 'Review Registered supplier' })).toBeTruthy();
  });
  it('shows an explicit empty filter result and allows returning to all applications', () => {
    render(<Applications />);
    fireEvent.click(screen.getByRole('button', { name: /Approved/ }));
    expect(screen.getByText('No applications found')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Approved/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /All/ }));
    expect(screen.getByText('Registered supplier')).toBeTruthy();
  });
  it('keeps read failures visible rather than suggesting successful loading', () => {
    mocks.useApplications.mockReturnValue({
      applications: [],
      loading: false,
      error: 'RPC unavailable',
      reload: vi.fn(),
    });
    render(<Applications />);
    expect(screen.getByText('Applications unavailable: RPC unavailable')).toBeTruthy();
    expect(screen.queryByText('No applications found')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

it('uses a table skeleton without premature zero counts or empty states', () => {
  mocks.useApplications.mockReturnValue({
    applications: [],
    loading: true,
    error: '',
    reload: vi.fn(),
  });
  const { container } = render(<Applications />);
  expect(screen.getByRole('status', { name: /Loading applications/ })).toBeTruthy();
  expect(container.querySelector('.page-skeleton--table')).toBeTruthy();
  expect(screen.queryByText('No applications found')).toBeNull();
  expect(screen.queryByText('0')).toBeNull();
});

it('retains existing application rows with refreshing feedback', () => {
  mocks.useApplications.mockReturnValue({
    applications: [record],
    loading: true,
    error: '',
    reload: vi.fn(),
  });
  render(<Applications />);
  expect(screen.getByText('Registered supplier')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Refreshing/ }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('status', { name: /Loading applications/ })).toBeNull();
});
