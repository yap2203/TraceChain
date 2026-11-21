// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HolderSigningKeyPanel } from './HolderSigningKeyPanel';
import {
  createBindingProof,
  createMessagingAgent,
  exportRecoveryKit,
  getActiveMessagingAgent,
  importRecoveryKit,
  setActiveMessagingAgent,
  type HolderMessagingAgent,
} from './didcomm-agent';
import { didCommApi } from './didcomm.api';

vi.mock('./didcomm-agent', () => ({
  createBindingProof: vi.fn(),
  createMessagingAgent: vi.fn(),
  exportRecoveryKit: vi.fn(),
  getActiveMessagingAgent: vi.fn(),
  importRecoveryKit: vi.fn(),
  setActiveMessagingAgent: vi.fn((holder) => holder),
}));

vi.mock('./didcomm.api', () => ({
  didCommApi: {
    bind: vi.fn(),
    challenge: vi.fn(),
  },
}));

const HOLDER = {
  did: 'did:key:z6MkPresentationHolder',
  privateKey: new Uint8Array(32).fill(7),
} as unknown as HolderMessagingAgent;

describe('presentation signing-key settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getActiveMessagingAgent).mockReturnValue(undefined);
    vi.mocked(createMessagingAgent).mockResolvedValue(HOLDER);
    vi.mocked(exportRecoveryKit).mockResolvedValue('{"encrypted":true}');
    vi.mocked(createBindingProof).mockResolvedValue('binding-proof');
    vi.mocked(didCommApi.challenge).mockResolvedValue({
      chainId: 31337,
      domain: 'localhost',
      expiresAt: '2026-11-21T12:00:00.000Z',
      nonce: 'nonce',
      purpose: 'bind-holder-key',
      wallet: '0x1000000000000000000000000000000000000001',
    });
    vi.mocked(didCommApi.bind).mockResolvedValue({
      companyName: 'TraceChain Supplier',
      did: HOLDER.did,
      role: 'SUPPLIER',
      wallet: '0x1000000000000000000000000000000000000001',
    });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:presentation-keystore'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downloads and confirms the backup before binding a newly generated key', async () => {
    render(<HolderSigningKeyPanel />);
    fireEvent.change(screen.getByLabelText('Presentation key backup password'), {
      target: { value: 'presentation-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm presentation key backup password'), {
      target: { value: 'presentation-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate and download keystore' }));

    expect(await screen.findByText(/The key is not bound to the company yet/)).toBeTruthy();
    expect(exportRecoveryKit).toHaveBeenCalledWith(HOLDER, 'presentation-password');
    expect(didCommApi.bind).not.toHaveBeenCalled();
    expect(setActiveMessagingAgent).not.toHaveBeenCalled();

    const bind = screen.getByRole('button', { name: 'Bind key to company' }) as HTMLButtonElement;
    expect(bind.disabled).toBe(true);
    fireEvent.click(
      screen.getByLabelText(
        'I saved the encrypted presentation keystore and its password separately.',
      ),
    );
    expect(bind.disabled).toBe(false);
    fireEvent.click(bind);

    await waitFor(() => expect(didCommApi.bind).toHaveBeenCalledWith('binding-proof'));
    expect(createBindingProof).toHaveBeenCalledWith(
      HOLDER,
      expect.objectContaining({ nonce: 'nonce' }),
    );
    expect(setActiveMessagingAgent).toHaveBeenCalledWith(HOLDER);
  });

  it('does not generate a key when the backup-password confirmation differs', async () => {
    render(<HolderSigningKeyPanel />);
    fireEvent.change(screen.getByLabelText('Presentation key backup password'), {
      target: { value: 'presentation-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm presentation key backup password'), {
      target: { value: 'mistyped-presentation-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate and download keystore' }));

    expect(await screen.findByText('The password confirmation does not match.')).toBeTruthy();
    expect(createMessagingAgent).not.toHaveBeenCalled();
    expect(didCommApi.bind).not.toHaveBeenCalled();
  });

  it('requires a 12-character password when restoring a presentation keystore', async () => {
    render(<HolderSigningKeyPanel expectedDid={HOLDER.did} />);
    fireEvent.change(screen.getByLabelText('Presentation key restore password'), {
      target: { value: '12345678901' },
    });
    fireEvent.change(screen.getByLabelText('Restore presentation key backup'), {
      target: {
        files: [new File(['{}'], 'presentation.json', { type: 'application/json' })],
      },
    });

    expect(
      await screen.findByText(
        'Enter the original presentation-keystore password (12+ characters).',
      ),
    ).toBeTruthy();
    expect(importRecoveryKit).not.toHaveBeenCalled();
  });

  it('requires matching password confirmation when exporting an active key', async () => {
    vi.mocked(getActiveMessagingAgent).mockReturnValue(HOLDER);
    render(<HolderSigningKeyPanel expectedDid={HOLDER.did} />);
    fireEvent.change(screen.getByLabelText('Presentation key backup password'), {
      target: { value: 'presentation-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm presentation key backup password'), {
      target: { value: 'mistyped-presentation-password' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Download encrypted presentation keystore' }),
    );

    expect(await screen.findByText('The password confirmation does not match.')).toBeTruthy();
    expect(exportRecoveryKit).not.toHaveBeenCalled();
  });
});
