// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AdminKeystorePage from './AdminKeystorePage';
import {
  downloadAdminKeystore,
  getAdminKeystoreStatus,
  lockAdminKeystore,
  unlockAdminKeystore,
} from './admin-keystore.api';

vi.mock('./admin-keystore.api', () => ({
  downloadAdminKeystore: vi.fn(),
  getAdminKeystoreStatus: vi.fn(),
  lockAdminKeystore: vi.fn(),
  unlockAdminKeystore: vi.fn(),
}));

describe('administrator keystore page', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdminKeystoreStatus).mockResolvedValue({
      backupRequired: false,
      initializationAllowed: false,
      status: 'Locked',
    });
    vi.mocked(unlockAdminKeystore).mockResolvedValue({
      backupRequired: false,
      status: 'Unlocked',
    });
    vi.mocked(lockAdminKeystore).mockResolvedValue({ backupRequired: false, status: 'Locked' });
    vi.mocked(downloadAdminKeystore).mockResolvedValue(new Blob(['{}']));
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:keystore'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('uploads the selected JSON and password without displaying key material', async () => {
    render(<AdminKeystorePage />);
    expect(await screen.findByText('Locked')).toBeTruthy();
    const file = new File(['{"format":"tracechain-admin-keystore"}'], 'keys.json', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByLabelText('Upload keystore JSON'), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText('Administrator keystore unlock password'), {
      target: { value: 'portable-admin-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock keystore' }));
    await waitFor(() =>
      expect(unlockAdminKeystore).toHaveBeenCalledWith(
        '{"format":"tracechain-admin-keystore"}',
        'portable-admin-password',
      ),
    );
    expect(screen.queryByText('portable-admin-password')).toBeNull();
  });

  it('shows only status and export/lock controls after unlock', async () => {
    vi.mocked(getAdminKeystoreStatus).mockResolvedValue({
      backupRequired: false,
      initializationAllowed: false,
      status: 'Unlocked',
    });
    render(<AdminKeystorePage />);
    expect(await screen.findByText('Unlocked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download encrypted keystore' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lock now' })).toBeTruthy();
    expect(screen.queryByLabelText('Upload keystore JSON')).toBeNull();
  });

  it('requires matching confirmation before downloading an export', async () => {
    vi.mocked(getAdminKeystoreStatus).mockResolvedValue({
      backupRequired: false,
      initializationAllowed: false,
      status: 'Unlocked',
    });
    render(<AdminKeystorePage />);
    await screen.findByText('Unlocked');
    fireEvent.change(screen.getByLabelText('Administrator keystore download password'), {
      target: { value: 'portable-admin-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm administrator keystore download password'), {
      target: { value: 'mistyped-admin-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download encrypted keystore' }));
    expect(await screen.findByText('The password confirmation does not match.')).toBeTruthy();
    expect(downloadAdminKeystore).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Confirm administrator keystore download password'), {
      target: { value: 'portable-admin-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download encrypted keystore' }));
    await waitFor(() =>
      expect(downloadAdminKeystore).toHaveBeenCalledWith(
        'export',
        'portable-admin-password',
        'portable-admin-password',
      ),
    );
  });

  it('shows the required-backup warning and prevents manual locking', async () => {
    vi.mocked(getAdminKeystoreStatus).mockResolvedValue({
      backupRequired: true,
      initializationAllowed: false,
      status: 'Unlocked',
    });
    render(<AdminKeystorePage />);
    expect(await screen.findByText('Backup required')).toBeTruthy();
    expect(
      screen.getByText(/Download an updated encrypted keystore before locking or restarting/),
    ).toBeTruthy();
    const lock = screen.getByRole('button', { name: 'Lock now' }) as HTMLButtonElement;
    expect(lock.disabled).toBe(true);
    fireEvent.click(lock);
    expect(lockAdminKeystore).not.toHaveBeenCalled();
  });

  it('requires matching confirmation for initial keystore creation', async () => {
    vi.mocked(getAdminKeystoreStatus).mockResolvedValue({
      backupRequired: false,
      initializationAllowed: true,
      status: 'Locked',
    });
    render(<AdminKeystorePage />);
    await screen.findByRole('button', { name: 'Create initial keystore' });
    fireEvent.change(screen.getByLabelText('Administrator keystore download password'), {
      target: { value: 'portable-admin-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm administrator keystore download password'), {
      target: { value: 'mistyped-admin-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create initial keystore' }));
    expect(await screen.findByText('The password confirmation does not match.')).toBeTruthy();
    expect(downloadAdminKeystore).not.toHaveBeenCalled();
  });
});
