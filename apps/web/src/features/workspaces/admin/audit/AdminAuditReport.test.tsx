// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AdminAuditReport from './AdminAuditReport';

vi.mock('../../../blockchain/blockchain.api', () => ({
  getApplications: vi.fn(async () => ({ applications: [] })),
  getCompanyCredentials: vi.fn(async () => ({ credentials: [] })),
}));

afterEach(cleanup);

it('keeps audit exports without exposing backend-key backup or restore controls', async () => {
  render(<AdminAuditReport />);
  expect(await screen.findByText('Registry Audit Report')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Export JSON' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
  expect(screen.queryByText(/backend storage backup/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /backup|recovery|restore/i })).toBeNull();
  expect(screen.queryByLabelText(/password/i)).toBeNull();
});
