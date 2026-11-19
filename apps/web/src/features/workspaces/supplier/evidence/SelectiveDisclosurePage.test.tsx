// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  details: vi.fn(),
  prepare: vi.fn(),
  claims: vi.fn(),
  sign: vi.fn(),
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
vi.mock('../../../production-flow/evidence-didcomm', () => ({
  sendEvidencePresentationMessage: mocks.sent,
}));
vi.mock('../../../didcomm/didcomm-agent', () => ({
  getActiveMessagingAgent: () => ({ did: 'did:key:holder' }),
  readSelectiveIngredientClaims: mocks.claims,
  createSelectiveIngredientPresentation: mocks.sign,
}));
import { SelectiveDisclosure } from './SelectiveDisclosurePage';
const request = {
  requestId: 'request',
  ingredientBatchId: 'batch',
  manufacturerName: 'Requesting manufacturer',
  dueAt: 2000000000,
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
  fireEvent.click(await screen.findByText('Preview available claim values'));
  await screen.findByText('Legacy source value');
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
  const share = screen.getByRole('button', {
    name: 'Share full legacy credential and confirm',
  }) as HTMLButtonElement;
  expect(share.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: /authorize full disclosure/ }));
  fireEvent.click(share);
  await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  expect(mocks.prepare).toHaveBeenCalledWith('request');
  expect(mocks.sign).not.toHaveBeenCalled();
});
it('selects one document with its complete certification, leaving another entry and private origin hidden', async () => {
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
      holderDid: 'did:key:holder',
      requiredClaims: ['certifications'],
      audience: 'manufacturer',
      nonce: 'nonce',
    },
  });
  mocks.claims.mockResolvedValue({
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
  fireEvent.click(await screen.findByText('Preview available claim values'));
  fireEvent.click(
    await screen.findByRole('checkbox', { name: /Supporting document: certificate.png/ }),
  );
  expect(
    (
      screen.getByRole('checkbox', {
        name: /Supplier-provided certification: Organic/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(screen.queryByText('Never share this address')).toBeNull();
  fireEvent.click(
    screen.getByRole('checkbox', { name: /authorize sharing only these selected claims/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sign selective presentation and confirm' }));
  await waitFor(() => expect(mocks.sign).toHaveBeenCalled());
  const selected = mocks.sign.mock.calls[0]![2].claims;
  expect(selected).toContain(key);
  expect(selected).toContain(file);
  expect(selected).not.toContain(other);
  expect(selected).not.toContain('privateOriginAddress');
});
