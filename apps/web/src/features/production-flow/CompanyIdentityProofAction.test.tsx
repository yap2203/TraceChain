// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  status: vi.fn(),
  material: vi.fn(),
  sign: vi.fn(),
  present: vi.fn(),
  submit: vi.fn(),
}));
vi.mock('./production-flow.api', () => ({
  getCompanyIdentityProofStatus: api.status,
  getCompanyIdentityProofMaterial: api.material,
  presentCompanyIdentityProof: api.present,
  declineCompanyIdentityProof: vi.fn(),
}));
vi.mock('./company-presentation', () => ({ signCompanyPresentation: api.sign }));
vi.mock('./production-flow.transaction', () => ({ submitProductionTransaction: api.submit }));
import { CompanyIdentityProofAction } from './CompanyIdentityProofAction';
const material = {
  walletContext: { holder: 'holder' },
  sdJwt: 'actual-issuer-attestation',
  audience: 'verifier',
  purpose: 'Review order company',
  expiresAt: 2000000000,
  requiredClaims: ['companyName', 'role'],
  claims: {
    companyName: 'Actual issuer company',
    role: 'MANUFACTURER',
    companyId: 'Optional private registration',
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  api.status.mockResolvedValue({ status: 'REQUESTED' });
  api.material.mockResolvedValue(material);
  api.sign.mockResolvedValue('metamask-signed-presentation');
  api.present.mockResolvedValue({ actorWallet: 'holder', transaction: { data: '0x1234' } });
  api.submit.mockResolvedValue(undefined);
});
afterEach(cleanup);
it('previews wallet-bound company claims and publishes only after explicit sharing approval', async () => {
  render(<CompanyIdentityProofAction requestId="request" role="manufacturer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Preview Company Role presentation' }));
  await screen.findByText('Actual issuer company');
  expect(api.sign).not.toHaveBeenCalled();
  expect(screen.queryByText('Manage legacy presentation keys')).toBeNull();
  expect((screen.getByRole('checkbox', { name: /companyId/ }) as HTMLInputElement).checked).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve and present' }));
  await waitFor(() => expect(api.submit).toHaveBeenCalledWith({ data: '0x1234' }, 'holder'));
  expect(api.sign).toHaveBeenCalledWith(material, ['companyName', 'role']);
  expect(api.present).toHaveBeenCalledWith('request', 'metamask-signed-presentation');
});
it('does not upload or record a presentation after wallet rejection', async () => {
  api.sign.mockRejectedValue(
    Object.assign(new Error('Sharing signature rejected in MetaMask.'), { code: 4001 }),
  );
  render(<CompanyIdentityProofAction requestId="request" role="retailer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Preview Company Role presentation' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Approve and present' }));
  await screen.findByText('The wallet request was cancelled. You can try again when ready.');
  expect(api.present).not.toHaveBeenCalled();
  expect(api.submit).not.toHaveBeenCalled();
});
