// @vitest-environment jsdom

import { CompanyRole } from '@tracechain/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  branding: vi.fn(),
  image: vi.fn(),
  media: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../../orders/orders.api', () => ({
  fetchCatalogueMedia: api.media,
  getMyCompanyBranding: api.branding,
  imageFilePayload: api.image,
  uploadCompanyLogo: api.upload,
}));

import { WorkspaceLayout } from '../WorkspaceLayout';
import { CompanyBrandingPanel } from './CompanyBrandingPanel';
import {
  clearCompanyBrandingState,
  selectCompanyBranding,
  useCompanyBrandingState,
} from './company-branding.state';

const wallet = '0x2000000000000000000000000000000000000002';
let finishOldMedia: ((value: Blob) => void) | undefined;

describe('shared company branding state', () => {
  beforeEach(() => {
    clearCompanyBrandingState();
    const oldMedia = new Promise<Blob>((resolve) => {
      finishOldMedia = resolve;
    });
    const newMedia = new Blob(['new-logo'], { type: 'image/webp' });
    api.branding.mockReset().mockResolvedValue({
      branding: {
        companyName: 'Verified Cocoa Company',
        logoPath: '/branding/company/logo',
        role: 'MANUFACTURER',
      },
    });
    api.image.mockReset().mockResolvedValue({
      data: 'new-logo',
      fileName: 'new-logo.webp',
      mimeType: 'image/webp',
    });
    api.upload.mockReset().mockResolvedValue({
      branding: { logoPath: '/branding/company/logo' },
    });
    api.media
      .mockReset()
      .mockImplementation((_path: string, revision: number) =>
        revision === 0 ? oldMedia : Promise.resolve(newMedia),
      );
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) =>
      blob === newMedia ? 'blob:new-company-logo' : 'blob:old-company-logo',
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    finishOldMedia = undefined;
  });

  it('refreshes the identity and header avatars and ignores an older in-flight logo response', async () => {
    render(
      <MemoryRouter>
        <BrandingHarness />
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.media).toHaveBeenCalledWith('/branding/company/logo', 0));

    fireEvent.change(screen.getByLabelText('Choose company logo'), {
      target: { files: [new File(['new-logo'], 'new-logo.webp', { type: 'image/webp' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace logo' }));

    await waitFor(() => {
      const avatars = screen.getAllByAltText('Verified Cocoa Company company logo');
      expect(avatars).toHaveLength(2);
      expect(
        avatars.every((avatar) => avatar.getAttribute('src') === 'blob:new-company-logo'),
      ).toBe(true);
    });
    expect(api.media).toHaveBeenCalledWith('/branding/company/logo', 1);

    finishOldMedia?.(new Blob(['old-logo'], { type: 'image/webp' }));
    await Promise.resolve();
    expect(
      screen
        .getAllByAltText('Verified Cocoa Company company logo')
        .every((avatar) => avatar.getAttribute('src') === 'blob:new-company-logo'),
    ).toBe(true);
  });
});

function BrandingHarness() {
  useCompanyBrandingState();
  const branding = selectCompanyBranding(wallet);
  return (
    <WorkspaceLayout
      role="manufacturer"
      page="credentials"
      pathForPage={(page) => `/manufacturer/${page}`}
      status="Wallet authorized"
      identity={{
        companyName: branding.branding?.companyName ?? 'Verified Cocoa Company',
        credentialStatus: 'AUTHORIZED',
        logoPath: branding.branding?.logoPath,
        logoRevision: branding.revision,
        role: CompanyRole.MANUFACTURER,
        walletAddress: wallet,
      }}
    >
      <CompanyBrandingPanel walletAddress={wallet} />
    </WorkspaceLayout>
  );
}
