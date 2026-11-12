// @vitest-environment jsdom

import { CompanyRole } from '@tracechain/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), verify: vi.fn() }));
const brandingApi = vi.hoisted(() => ({
  get: vi.fn(),
  image: vi.fn(),
  upload: vi.fn(),
  media: vi.fn(),
}));
vi.mock('../../auth/auth.api', () => ({
  getMyCompanyIdentity: api.get,
  verifyMyCompanyIdentity: api.verify,
}));
vi.mock('../../orders/orders.api', () => ({
  getMyCompanyBranding: brandingApi.get,
  imageFilePayload: brandingApi.image,
  uploadCompanyLogo: brandingApi.upload,
  fetchCatalogueMedia: brandingApi.media,
}));

import type { CompanyIdentityResponse } from '../../auth/auth.api';
import {
  createIdentitySummaryLines,
  createIdentitySummaryPdfSource,
  StakeholderCredentialPage,
} from './StakeholderCredentialPage';

const identity: CompanyIdentityResponse = {
  identity: {
    applicationReference: `0x${'11'.repeat(32)}`,
    associatedWallet: '0x2000000000000000000000000000000000000002',
    chainId: 11_155_111,
    companyName: 'Verified Cocoa Company',
    companyRegistrationNumber: 'REG-2026-001',
    credentialHash: `0x${'22'.repeat(32)}`,
    credentialId: 'urn:tracechain:credential:company-role:test',
    encryptedCredentialCid: 'bafy-encrypted-company-role',
    expiresAt: '2027-11-07T00:00:00.000Z',
    issuerDid: 'did:ethr:sepolia:0x1000000000000000000000000000000000000001',
    issuerName: 'TraceChain Demo Authority',
    issuedAt: '2026-11-07T00:00:00.000Z',
    lifecycleStatus: 'ACTIVE',
    registryCredentialId: `0x${'33'.repeat(32)}`,
    registryReferences: {
      credentialRegistry: '0x3000000000000000000000000000000000000003',
      stakeholderRegistry: '0x4000000000000000000000000000000000000004',
    },
    role: CompanyRole.MANUFACTURER,
    subjectDid: 'did:ethr:sepolia:0x2000000000000000000000000000000000000002',
    updatedAt: '2026-11-07T01:00:00.000Z',
  },
};

describe('My Company Identity', () => {
  afterEach(cleanup);
  beforeEach(() => {
    api.get.mockReset().mockResolvedValue(identity);
    api.verify.mockReset();
    brandingApi.get.mockReset().mockResolvedValue({
      branding: {
        companyName: 'Verified Cocoa Company',
        role: 'MANUFACTURER',
      },
    });
    brandingApi.image.mockReset().mockResolvedValue({
      data: 'logo-data',
      fileName: 'logo.webp',
      mimeType: 'image/webp',
    });
    brandingApi.upload.mockReset().mockResolvedValue({
      branding: { logoPath: '/branding/logo' },
    });
    brandingApi.media.mockReset().mockResolvedValue(new Blob(['logo'], { type: 'image/webp' }));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:identity-summary'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('renders actual API identity fields and copies the complete wallet', async () => {
    render(<StakeholderCredentialPage expectedRole="MANUFACTURER" />);
    expect(await screen.findByText('Verified Cocoa Company')).toBeTruthy();
    const settings = screen.getByText('Presentation signing settings').closest('details');
    expect(settings?.open).toBe(false);
    expect(screen.queryByRole('textbox', { name: 'Presentation key backup password' })).toBeNull();
    expect(screen.queryByText(/Secure DIDComm delivery/)).toBeNull();
    expect(screen.getByText('REG-2026-001')).toBeTruthy();
    expect(screen.getByText('Manufacturer')).toBeTruthy();
    expect(screen.getByText('TraceChain Demo Authority')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy full Associated wallet' })[0]!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(identity.identity.associatedWallet);
    expect(await screen.findByText('Associated wallet copied successfully.')).toBeTruthy();
  });
  it('updates only the authenticated company presentation logo', async () => {
    render(<StakeholderCredentialPage expectedRole="MANUFACTURER" />);
    await screen.findByLabelText('Choose company logo');
    const file = new File(['logo'], 'logo.webp', { type: 'image/webp' });
    fireEvent.change(screen.getByLabelText('Choose company logo'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload logo' }));
    await waitFor(() =>
      expect(brandingApi.upload).toHaveBeenCalledWith(identity.identity.associatedWallet, {
        data: 'logo-data',
        fileName: 'logo.webp',
        mimeType: 'image/webp',
      }),
    );
    expect(screen.getByText(/Authorization is unchanged/)).toBeTruthy();
  });

  it('downloads the PDF summary from the top-right action without overflowing line wrapping', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<StakeholderCredentialPage expectedRole="MANUFACTURER" />);
    await screen.findByText('Verified Cocoa Company');
    fireEvent.click(screen.getByRole('button', { name: /Download Identity Summary/ }));
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(await screen.findByText('Identity summary downloaded successfully.')).toBeTruthy();
    click.mockRestore();
  });

  it('keeps cryptographic verification separate and shows individual failures', async () => {
    api.verify.mockResolvedValue({
      ...identity,
      verification: {
        checks: [
          { detail: 'Signed hash does not match.', label: 'Deterministic hash', status: 'FAILED' },
        ],
        outcome: 'CHECKS_FAILED',
        verifiedAt: '2026-11-07T02:00:00.000Z',
      },
    } satisfies CompanyIdentityResponse);
    render(<StakeholderCredentialPage expectedRole="MANUFACTURER" />);
    await screen.findByText('Verified Cocoa Company');
    fireEvent.click(screen.getByRole('button', { name: 'Verify My Credential' }));
    expect(await screen.findByText('Checks failed')).toBeTruthy();
    expect(screen.getByText('Deterministic hash')).toBeTruthy();
    expect(screen.getByText('Signed hash does not match.')).toBeTruthy();
  });

  it('shows a safe no-credential/service error state', async () => {
    api.get.mockRejectedValue(
      new Error('No Company Role Credential is linked to this wallet yet.'),
    );
    render(<StakeholderCredentialPage expectedRole="MANUFACTURER" />);
    expect(
      await screen.findByText('No Company Role Credential is linked to this wallet yet.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('creates an accurate identity-summary payload with the required disclaimer', () => {
    const lines = createIdentitySummaryLines(identity, new Date('2026-11-07T03:00:00.000Z'));
    expect(lines).toContain('Company: Verified Cocoa Company');
    expect(lines).toContain('Credential ID: urn:tracechain:credential:company-role:test');
    expect(lines).toContain('Verification: Not verified in this session');
    expect(lines).toContain(
      'Credential summary — not a substitute for the original signed credential.',
    );
    expect(lines.join(' ')).toContain(
      'It does not represent government or independent product certification.',
    );
  });

  it('creates a branded TraceChain PDF with themed sections and actual identity data', () => {
    const pdf = createIdentitySummaryPdfSource(identity, new Date('2026-11-07T03:00:00.000Z'));
    expect(pdf).toMatch(/^%PDF-1\.4/);
    expect(pdf).toContain('/BaseFont /Helvetica-Bold');
    expect(pdf).toContain('(TraceChain) Tj');
    expect(pdf).toContain('(COMPANY DIGITAL IDENTITY) Tj');
    expect(pdf).toContain('(Verified Cocoa Company) Tj');
    expect(pdf).toContain('(TraceChain Demo Authority) Tj');
    expect(pdf).toContain(
      '(Credential summary - not a substitute for the original signed credential.) Tj',
    );
  });
});
