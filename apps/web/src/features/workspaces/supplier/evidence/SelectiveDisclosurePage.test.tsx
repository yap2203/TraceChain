// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  details: vi.fn(),
  prepare: vi.fn(),
  claims: vi.fn(),
  sign: vi.fn(),
  walletSign: vi.fn(),
  sent: vi.fn(),
  identity: vi.fn(),
}));
vi.mock('../../../production-flow/production-flow.api', () => ({
  getEvidenceDetails: mocks.details,
  prepareEvidenceResponse: mocks.prepare,
  getCompanyIdentityProofStatus: mocks.identity,
  prepareEvidenceClose: vi.fn(),
}));
vi.mock('../../../production-flow/production-flow.transaction', () => ({
  completePreparedWorkflow: async (prepare: () => Promise<unknown>) => prepare(),
}));
vi.mock('../../../didcomm/didcomm-agent', () => ({
  getActiveMessagingAgent: () => ({ did: 'did:key:holder' }),
  readSelectiveIngredientClaims: mocks.claims,
  createSelectiveIngredientPresentation: mocks.sign,
}));
vi.mock('../../../production-flow/wallet-presentation', () => ({
  createWalletPresentation: mocks.walletSign,
  createFullWalletPresentation: vi.fn(),
}));
import { SelectiveDisclosure } from './SelectiveDisclosurePage';
const request = {
  requestId: 'request',
  ingredientBatchId: 'batch',
  manufacturerName: 'Requesting manufacturer',
  dueAt: 2000000000,
  status: 1,
  requester: 'manufacturer',
} as any;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ status: 'NOT_REQUESTED' });
  mocks.sent.mockResolvedValue(undefined);
  mocks.sign.mockResolvedValue('signed selective presentation');
});
afterEach(cleanup);
it('previews legacy full disclosure read-only, then shares only after explicit approval', async () => {
  const details = {
    ...request,
    batchId: 'batch',
    claims: ['countryOfOrigin'],
    requiredClaims: ['countryOfOrigin'],
    reason: 'Legacy proof',
    credentialFormat: 'JWT_VC',
    legacyClaims: {
      origin: 'Legacy source value',
      certifications: ['Organic'],
      allergenInformation: 'None',
    },
  };
  mocks.details.mockResolvedValue(details);
  mocks.prepare.mockResolvedValue({ state: 'COMPLETE' });
  const back = vi.fn();
  render(<SelectiveDisclosure request={request} onBack={back} />);
  fireEvent.click(await screen.findByText('Review values to share'));
  await screen.findByText('Legacy source value');
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
  // Approval is the review dialog, as for company identity: nothing is signed before it.
  fireEvent.click(screen.getByRole('button', { name: 'Review and sign proof' }));
  expect(screen.getByText(/authorizes full disclosure/)).toBeTruthy();
  expect(mocks.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Share full credential' }));
  await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  expect(mocks.prepare).toHaveBeenCalledWith('request');
  expect(mocks.sign).not.toHaveBeenCalled();
});
it.each([false, true])(
  'selects one document for legacy/wallet-bound credentials (%s) with its complete certification, leaving another entry and private origin hidden',
  async (walletBound) => {
    const id = '11111111-1111-4111-8111-111111111111',
      key = 'certification_' + id.replaceAll('-', ''),
      other = 'certification_' + '3'.repeat(32),
      file = 'certificationDocuments_' + '2'.repeat(32);
    mocks.details.mockResolvedValue({
      ...request,
      batchId: 'batch',
      claims: ['certifications', 'certificationDocuments'],
      requiredClaims: ['certifications'],
      reason: 'Review certification',
      credentialFormat: 'SD_JWT_VC',
    });
    mocks.prepare.mockResolvedValue({
      state: 'HOLDER_SIGNATURE_REQUIRED',
      holderSigning: {
        credential: 'credential',
        ...(walletBound ? { walletContext: { holder: 'supplier' } } : {}),
        holderDid: 'did:key:holder',
        requiredClaims: ['certifications'],
        audience: 'manufacturer',
        nonce: 'nonce',
      },
    });
    mocks.walletSign.mockResolvedValue('wallet selective presentation');
    mocks.claims.mockResolvedValue({
      ...(walletBound ? { vct: 'urn:tracechain:credential:ingredient:sd-jwt:v3' } : {}),
      [key]: {
        id,
        name: 'Organic',
        issuer: 'Stated organization',
        reference: 'ONE',
        scope: 'This batch',
      },
      [other]: { id: '3', name: 'Halal', reference: 'HIDDEN' },
      [file]: {
        certificationId: id,
        documents: [{ id: 'file', fileName: 'certificate.png', size: 68 }],
      },
      privateOriginAddress: 'Never share this address',
    });
    render(<SelectiveDisclosure request={request} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Review values to share'));
    const documentSwitch = await screen.findByRole('switch', {
      name: /Share Supporting document: certificate.png/,
    });
    // "certifications" is required as a group: sharing one entry meets it, so entries say "Choose one".
    const tag = (name: RegExp) =>
      screen
        .getByRole('switch', { name })
        .closest('.evidence-claim-row')!
        .querySelector('.evidence-claim-row__requirement')!.textContent;
    expect(tag(/Share Supplier-provided certification: Organic/)).toBe('Choose one');
    expect(tag(/Share Supporting document: certificate.png/)).toBe('Optional');
    fireEvent.click(documentSwitch);
    expect(
      screen
        .getByRole('switch', { name: /Share Supplier-provided certification: Organic/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.queryByText('Never share this address')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review and sign proof' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign and share' }));
    await waitFor(() => expect(walletBound ? mocks.walletSign : mocks.sign).toHaveBeenCalled());
    if (walletBound) expect(mocks.sign).not.toHaveBeenCalled();
    const selected = walletBound
      ? mocks.walletSign.mock.calls[0]![1]
      : mocks.sign.mock.calls[0]![2].claims;
    expect(selected).toContain(key);
    expect(selected).toContain(file);
    expect(selected).not.toContain(other);
    expect(selected).not.toContain('privateOriginAddress');
  },
);

it('shows a closed request as closed, with no response actions', async () => {
  mocks.details.mockResolvedValue({
    ...request,
    batchId: 'batch',
    claims: ['countryOfOrigin'],
    requiredClaims: ['countryOfOrigin'],
    reason: 'Origin check',
  });
  render(<SelectiveDisclosure request={{ ...request, status: 3 }} onBack={vi.fn()} />);
  expect(await screen.findByText('The requester accepted the evidence you shared.')).toBeTruthy();
  expect(screen.getByText('Accepted')).toBeTruthy();
  expect(screen.queryByText('Review values to share')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Decline…' })).toBeNull();
});

it('lets the holder withhold a required field, warns, and still shares', async () => {
  mocks.details.mockResolvedValue({
    ...request,
    batchId: 'batch',
    claims: ['countryOfOrigin'],
    requiredClaims: ['countryOfOrigin'],
    reason: 'Origin check',
    credentialFormat: 'SD_JWT_VC',
  });
  mocks.prepare.mockResolvedValue({
    state: 'HOLDER_SIGNATURE_REQUIRED',
    holderSigning: {
      credential: 'credential',
      holderDid: 'did:key:holder',
      requiredClaims: ['countryOfOrigin'],
      audience: 'manufacturer',
      nonce: 'nonce',
    },
  });
  mocks.claims.mockResolvedValue({ countryOfOrigin: 'Ghana' });
  const back = vi.fn();
  render(<SelectiveDisclosure request={request} onBack={back} />);
  fireEvent.click(await screen.findByText('Review values to share'));
  const field = (await screen.findByRole('switch', {
    name: /Share Country of origin/,
  })) as HTMLButtonElement;
  expect(field.getAttribute('aria-checked')).toBe('true');
  expect(field.disabled).toBe(false);
  fireEvent.click(field);
  expect(screen.getByText(/You are not sharing one required item/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review and sign proof' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign and share' }));
  await waitFor(() => expect(back).toHaveBeenCalled());
  expect(mocks.sign.mock.calls[0]![2].claims).not.toContain('countryOfOrigin');
});
