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
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdminKeystoreStatus).mockResolvedValue({
      initializationAllowed: false,
      status: 'Locked',
    });
    vi.mocked(unlockAdminKeystore).mockResolvedValue({ status: 'Unlocked' });
    vi.mocked(lockAdminKeystore).mockResolvedValue({ status: 'Locked' });
    vi.mocked(downloadAdminKeystore).mockResolvedValue(new Blob(['{}']));
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
    fireEvent.change(screen.getByLabelText('Administrator keystore password'), {
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
      initializationAllowed: false,
      status: 'Unlocked',
    });
    render(<AdminKeystorePage />);
    expect(await screen.findByText('Unlocked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download encrypted keystore' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lock now' })).toBeTruthy();
    expect(screen.queryByLabelText('Upload keystore JSON')).toBeNull();
  });
});
