// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), selective: vi.fn(), full: vi.fn() }));
vi.mock('./orders.api', () => ({ deliveryIdentity: mocks.identity }));
vi.mock('../didcomm/didcomm-agent', () => ({
  getActiveMessagingAgent: () => ({ did: 'did:key:supplier' }),
  createSelectiveCompanyIdentityPresentation: mocks.selective,
  createCompanyIdentityPresentation: mocks.full,
}));
vi.mock('../didcomm/HolderSigningKeyPanel', () => ({
  PresentationSigningSettingsLink: () => <span>Profile presentation key settings</span>,
}));
import { DeliveryIdentityPanel } from './DeliveryIdentityPanel';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('previews claims first and passes the actual SD-JWT and explicitly selected claims to the holder signer', async () => {
  const material = {
    format: 'COMPANY_IDENTITY_SD_JWT',
    sdJwt: 'issuer-signed-selective-company-material',
    holderDid: 'did:key:supplier',
    audience: 'distributor',
    challenge: 'delivery-challenge',
    purpose: 'Check before collection',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    requiredClaims: ['role'],
    optionalClaims: ['companyName'],
    claims: {
      role: 'SUPPLIER',
      companyName: 'Actual company record',
      companyRegistrationNumber: 'Unselected company field',
    },
  };
  mocks.identity.mockImplementation(async (_order, input) =>
    input.action === 'material' ? material : { status: 'REQUESTED' },
  );
  mocks.selective.mockResolvedValue('holder-approved-presentation');
  render(
    <DeliveryIdentityPanel
      order={{ orderId: 'order', seller: 'supplier', delivery: { identityChallenge: 'challenge' } }}
      data={{
        actor: 'supplier',
        role: 'SUPPLIER',
        orders: [],
        catalogue: [],
        locations: [],
        shipments: [],
      }}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Preview requested company evidence' }),
  );
  await screen.findByText('Actual company record');
  expect(mocks.selective).not.toHaveBeenCalled();
  expect(mocks.identity.mock.calls.some(([, input]) => input.action === 'present')).toBe(false);
  fireEvent.click(screen.getByLabelText('Share companyName'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve & sign Supplier company proof' }));
  await waitFor(() =>
    expect(mocks.selective).toHaveBeenCalledWith(
      expect.objectContaining({ did: material.holderDid }),
      material.sdJwt,
      { audience: material.audience, nonce: material.challenge, claims: ['role', 'companyName'] },
    ),
  );
  expect(mocks.full).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(mocks.identity).toHaveBeenCalledWith('order', {
      action: 'present',
      presentation: 'holder-approved-presentation',
    }),
  );
});
